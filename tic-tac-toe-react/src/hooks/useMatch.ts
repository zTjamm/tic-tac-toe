import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { apiFetch } from '../api';
import { playMyTurn, playBoxTaken, setTitle } from '../signals';
import type {
    MatchSnapshot,
    MatchStateMessage,
    ChatMessage,
    MoveInfo,
    OnlineUser,
    Friend,
    LeaderboardEntry,
    SearchState
} from '../types';

export interface IncomingChallenge {
    challengeId: string;
    from: string;
    /** сколько секунд на ответ; окно считает сервер */
    expiresIn?: number;
}

export interface RematchRequest {
    from: string;
}

/**
 * Подписка на партию. Сервер — единственный источник правды по очкам,
 * таймерам и цепочкам: клиент только отображает снимок и шлёт ходы.
 */
export function useMatch(username: string) {
    const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
    const [lastMove, setLastMove] = useState<MoveInfo | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [connected, setConnected] = useState(false);
    const [online, setOnline] = useState<OnlineUser[]>([]);
    const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
    const [rematchRequest, setRematchRequest] = useState<RematchRequest | null>(null);
    const [pendingTarget, setPendingTarget] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [search, setSearch] = useState<SearchState>({ status: 'idle' });
    /** сколько партий сыграно: три открывают рейтинговую игру */
    const [played, setPlayed] = useState(0);

    const socketRef = useRef<Socket | null>(null);
    const usernameRef = useRef(username);
    const roomRef = useRef<string | null>(null);
    // Обработчики сокета поднимаются один раз, а loadFriends пересоздаётся
    // для каждого рендера - через ref достаём актуальную без переподписки
    const loadFriendsRef = useRef<() => void>(() => {});

    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    // Ник появляется ПОСЛЕ входа, а сокет к этому моменту уже подключён,
    // поэтому событие connect уже прошло. Отправляем ник отдельным эффектом,
    // иначе сервер не узнает игрока и партия не начнётся.
    useEffect(() => {
        if (!username) return;
        const s = socketRef.current;
        if (s && s.connected) {
            s.emit('userOnline', { username });
        }
    }, [username, connected]);

    useEffect(() => {
        // Пустой URL -> текущий origin (тот же сервер, что отдал страницу)
        const socket = io('');
        socketRef.current = socket;

        socket.on('connect', () => {
            setConnected(true);
            socket.emit('userOnline', { username: usernameRef.current });

            fetch('/api/chat-history')
                .then(r => (r.ok ? r.json() : []))
                .then((history: ChatMessage[]) => {
                    if (Array.isArray(history)) setMessages(history);
                })
                .catch(e => console.warn('[Chat] история не загружена:', e));
        });
        socket.on('disconnect', () => setConnected(false));

        socket.on('match:state', (msg: MatchStateMessage) => {
            roomRef.current = msg.snapshot.roomId;
            setSnapshot(msg.snapshot);

            // Партия началась, значит вызов принят. Иначе кнопка «вызвать»
            // навсегда оставалась в состоянии «ждём» до следующей попытки
            if (msg.snapshot.phase !== 'finished') {
                setPendingTarget(null);
                setSearch({ status: 'idle' });
            }

            if (msg.type === 'move' && msg.extra) {
                setLastMove(msg.extra);
                if (msg.extra.gained > 0) playBoxTaken();
            }
            // Каждая партия засчитывается в счётчик, который открывает
            // рейтинговую игру после трёх партий
            if (msg.snapshot.phase === 'finished') {
                setPlayed(p => p + 1);
            }

            announce(msg.snapshot, usernameRef.current);
        });

        socket.on('globalChatMessage', (msg: ChatMessage) => {
            setMessages(prev => {
                const key = keyOf(msg);
                if (prev.some(m => keyOf(m) === key)) return prev;
                return [...prev, msg];
            });
        });

        socket.on('onlineUsersUpdate', (data: { online: OnlineUser[] }) => {
            setOnline(Array.isArray(data.online) ? data.online : []);
        });

        socket.on('challengeReceived', (data: IncomingChallenge) => {
            setIncoming(data);
        });

        // Вызов отозван истёкшим окном или отозванным поиском: окно надо
        // закрыть, иначе игрок будет нажимать «принять» в пустоту
        socket.on('challengeWithdrawn', () => {
            setIncoming(null);
        });

        socket.on('challengeDeclined', (data: { by: string }) => {
            setPendingTarget(null);
            setNotice(`${data.by} отклонил вызов`);
        });

        // Окно ответа истекло - вызов считается отказом
        socket.on('challengeExpired', (data: { challengeId: string; by: string }) => {
            setPendingTarget(prev => (prev === data.by ? null : prev));
            setIncoming(prev => (prev && prev.challengeId === data.challengeId ? null : prev));
        });

        socket.on('search:state', (state: SearchState) => {
            setSearch(state);
        });

        socket.on('rematchRequested', (data: RematchRequest) => {
            setRematchRequest(data);
        });

        socket.on('rematchPending', (data: { to: string }) => {
            setPendingTarget(data.to);
        });

        socket.on('rematchDeclined', (data: { by: string }) => {
            setPendingTarget(null);
            setNotice(`${data.by} отказался от реванша`);
        });

        socket.on('rematchError', (data: { message: string }) => {
            setPendingTarget(null);
            setNotice(data.message);
        });

        // Дружба взаимная: изменил список один - обновиться должны оба
        socket.on('friends:changed', () => loadFriendsRef.current());

        // Соперник вышел из завершённого матча - его больше нет, ждать
        // реванша бессмысленно, поэтому тоже уходим в меню
        socket.on('match:exit', (data: { by: string }) => {
            setSnapshot(null);
            setLastMove(null);
            setRematchRequest(null);
            setPendingTarget(null);
            setNotice(`${data.by} вышел из партии`);
            resetSignals();
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, []);

    const emitMatch = useCallback((event: string, payload: Record<string, unknown>) => {
        const s = socketRef.current;
        if (!s || !roomRef.current) return;
        s.emit(event, { roomId: roomRef.current, ...payload });
    }, []);

    /** Партия с ботом. Кнопка доступна всегда, даже во время подбора. */
    const startBotMatch = useCallback(() => {
        setSnapshot(null);
        setLastMove(null);
        roomRef.current = null;
        setSearch({ status: 'idle' });
        socketRef.current?.emit('match:startBot');
    }, []);

    /** Поиск живого соперника: вызовы случайным игрокам по очереди. */
    const findMatch = useCallback(() => {
        setSnapshot(null);
        setLastMove(null);
        roomRef.current = null;
        socketRef.current?.emit('match:find');
    }, []);

    const cancelSearch = useCallback(() => {
        socketRef.current?.emit('match:findCancel');
        setSearch({ status: 'idle' });
    }, []);

    const syncMatch = useCallback(() => {
        socketRef.current?.emit('match:sync', {});
    }, []);

    const makeMove = useCallback(
        (edge: number) => emitMatch('match:move', { edge }),
        [emitMatch]
    );

    const sendChat = useCallback((text: string) => {
        socketRef.current?.emit('sendGlobalChat', { text });
    }, []);

    // Закрыть партию на экране (сервер продолжает помнить её для реванша)
    const clearMatch = useCallback(() => {
        setSnapshot(null);
        setLastMove(null);
        resetSignals();
    }, []);

    /* ------------------------ выход из партии ------------------------ */

    // Игрок нажал «В меню»: сервер выведет и соперника, чтобы тот не
    // остался один на экране законченной партии
    const leaveMatch = useCallback(() => {
        socketRef.current?.emit('match:leave');
        setSnapshot(null);
        setLastMove(null);
        setPendingTarget(null);
        resetSignals();
    }, []);

    /* ------------------------- вызов на игру ------------------------- */

    const sendChallenge = useCallback(
        async (targetUsername: string) => {
            if (!username || !targetUsername) return;
            try {
                await apiFetch('/api/challenge/send', {
                    method: 'POST',
                    body: { targetUsername }
                });
                setPendingTarget(targetUsername);
            } catch (e) {
                setNotice(e instanceof Error ? e.message : 'Сеть недоступна');
            }
        },
        [username]
    );

    const respondChallenge = useCallback(
        async (accept: boolean) => {
            if (!incoming) return;
            const endpoint = accept ? '/api/challenge/accept' : '/api/challenge/decline';
            try {
                await apiFetch(endpoint, {
                    method: 'POST',
                    body: { challengeId: incoming.challengeId }
                });
            } catch (e) {
                setNotice(e instanceof Error ? e.message : 'Не удалось ответить на вызов');
            } finally {
                setIncoming(null);
            }
        },
        [incoming]
    );

    /**
     * Отзыв отправленного вызова. Раньше его было некуда отозвать: кнопка
     * висела в «ждём» до следующей попытки вызвать кого-то другого.
     */
    const cancelChallenge = useCallback(() => {
        if (!pendingTarget) return;
        setNotice(`Вызов ${pendingTarget} отозван`);
        setPendingTarget(null);
    }, [pendingTarget]);

    /* --------------------------- реванш --------------------------- */

    const requestRematch = useCallback(() => {
        socketRef.current?.emit('match:rematch');
    }, []);

    const respondRematch = useCallback((accept: boolean) => {
        const from = rematchRequest ? rematchRequest.from : null;
        if (!from) return;
        socketRef.current?.emit('match:rematchResponse', { from, accept });
        setRematchRequest(null);
    }, [rematchRequest]);

    const clearNotice = useCallback(() => setNotice(null), []);

    /* ---------------------- друзья и таблица лидеров ---------------------- */

    const loadFriends = useCallback(async () => {
        try {
            const data = await apiFetch<Friend[]>('/api/friends');
            if (Array.isArray(data)) setFriends(data);
        } catch {
            // Протухший токен уже сообщён через auth:expired, сеть - просто
            // оставляем показывать то, что есть
        }
    }, []);

    const loadLeaderboard = useCallback(async () => {
        try {
            const data = await apiFetch<LeaderboardEntry[]>('/api/leaderboard');
            if (Array.isArray(data)) setLeaderboard(data);
        } catch {
            /* сеть недоступна - показываем то, что уже есть */
        }
    }, []);

    // Счётчик партий нужен для гейта: пока их меньше трёх, рейтинговая
    // кнопка заблокирована
    const loadProfile = useCallback(async () => {
        try {
            const data = await apiFetch<{ played?: number }>('/api/profile');
            if (typeof data.played === 'number') setPlayed(data.played);
        } catch {
            /* сеть недоступна - оставляем как есть */
        }
    }, []);

    // Дружба взаимная, поэтому после любого изменения перечитываем список:
    // у соперника тоже могла появиться или исчезнуть
    const addFriend = useCallback(
        async (name: string) => {
            try {
                await apiFetch('/api/friends/add', {
                    method: 'POST',
                    body: { friendUsername: name }
                });
                await loadFriends();
            } catch (e) {
                setNotice(e instanceof Error ? e.message : 'Сеть недоступна');
            }
        },
        [loadFriends]
    );

    const removeFriend = useCallback(
        async (name: string) => {
            try {
                await apiFetch('/api/friends/remove', {
                    method: 'POST',
                    body: { friendUsername: name }
                });
                await loadFriends();
            } catch (e) {
                setNotice(e instanceof Error ? e.message : 'Сеть недоступна');
            }
        },
        [loadFriends]
    );

    // Список онлайна меняет и статусы друзей, поэтому перечитываем его
    // вместе с обновлением онлайна
    useEffect(() => {
        loadFriendsRef.current = loadFriends;
        if (username) loadFriends();
    }, [username, online, loadFriends]);

    useEffect(() => {
        if (username) loadProfile();
    }, [username, loadProfile]);

    return {
        snapshot,
        lastMove,
        messages,
        connected,
        online,
        incoming,
        rematchRequest,
        pendingTarget,
        notice,
        friends,
        leaderboard,
        search,
        played,
        startBotMatch,
        findMatch,
        cancelSearch,
        syncMatch,
        makeMove,
        sendChat,
        clearMatch,
        sendChallenge,
        respondChallenge,
        requestRematch,
        respondRematch,
        leaveMatch,
        cancelChallenge,
        loadFriends,
        loadLeaderboard,
        addFriend,
        removeFriend,
        clearNotice
    };
}

function keyOf(m: ChatMessage) {
    return `${m.sender}|${m.text}|${m.timestamp}`;
}

/** Ключ последнего сигнала «ваш ход», чтобы не пищать на каждом снимке */
let lastMyTurnKey = '';

function resetSignals() {
    lastMyTurnKey = '';
    setTitle('menu');
}

/**
 * Ставит заголовок вкладки и пищит, когда очередь перешла к игроку.
 * Отслеживаем именно переход, а не сам факт: иначе сигнал повторялся бы
 * на каждом снимке, то есть несколько раз в секунду.
 */
function announce(snapshot: MatchSnapshot, myId: string) {
    if (snapshot.phase === 'finished') {
        setTitle('finished');
        return;
    }
    const myTurn = snapshot.phase === 'playing' && snapshot.turnId === myId;

    setTitle(myTurn ? 'myTurn' : 'playing');

    if (myTurn) {
        // Ключ включает число оставшихся линий: после закрытия квадрата
        // игрок ходит снова, и это разные ходы при одном turnId
        const key = `${snapshot.roomId}:${snapshot.movesLeft}`;
        if (key !== lastMyTurnKey) {
            lastMyTurnKey = key;
            playMyTurn();
        }
    } else {
        lastMyTurnKey = '';
    }
}
