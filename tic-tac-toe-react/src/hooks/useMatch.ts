import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { apiFetch } from '../api';
import type {
    MatchSnapshot,
    MatchStateMessage,
    ChatMessage,
    RoundEndInfo,
    OnlineUser,
    Friend,
    LeaderboardEntry
} from '../types';

export interface IncomingChallenge {
    challengeId: string;
    from: string;
}

export interface RematchRequest {
    from: string;
}

/**
 * Подписка на матч. Сервер — единственный источник правды по очкам, ролям и
 * таймерам: клиент только отображает снимок и отправляет действия.
 */

export function useMatch(username: string) {
    const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
    const [lastRoundEnd, setLastRoundEnd] = useState<RoundEndInfo | null>(null);
    /** клетки выигрышной линии последнего раунда; null если линии нет */
    const [winPattern, setWinPattern] = useState<number[] | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [connected, setConnected] = useState(false);
    const [online, setOnline] = useState<OnlineUser[]>([]);
    const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
    const [rematchRequest, setRematchRequest] = useState<RematchRequest | null>(null);
    const [pendingTarget, setPendingTarget] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

    const socketRef = useRef<Socket | null>(null);
    const usernameRef = useRef(username);
    const roomRef = useRef<string | null>(null);
    // Обработчики сокета поднимаются один раз, а loadFriends пересоздаётся
    // на каждый рендер - через ref достаём актуальную без переподписки
    const loadFriendsRef = useRef<() => void>(() => {});

    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    // Ник появляется ПОСЛЕ входа, а сокет к этому моменту уже подключён,
    // поэтому событие connect уже прошло. Отправляем ник отдельным эффектом,
    // иначе сервер не узнает игрока и матч не создастся.
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

            // Вернулись в матч после обрыва - забираем состояние
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
            // Матч начался, значит вызов принят. Иначе кнопка «вызвать»
            // навсегда оставалась в состоянии «ждём» до следующей попытки
            if (msg.snapshot.phase !== 'finished') setPendingTarget(null);
            if (msg.type === 'roundEnd' && msg.extra) {
                setLastRoundEnd(msg.extra);
                // Сервер отдаёт клетки выигрышной линии - доска их подсветит.
                // При ничьей winPattern равен null
                setWinPattern(msg.extra.winPattern);
            }
            // Начался новый раунд - линии прошлого на доске уже нет
            if (msg.type === 'roundStart' || msg.type === 'guessStart') {
                setLastRoundEnd(null);
                setWinPattern(null);
            }
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

        socket.on('challengeDeclined', (data: { by: string }) => {
            setPendingTarget(null);
            setNotice(`${data.by} отклонил вызов`);
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
            setLastRoundEnd(null);
            setRematchRequest(null);
            setPendingTarget(null);
            setNotice(`${data.by} вышел из матча`);
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

    const startBotMatch = useCallback(() => {
        setSnapshot(null);
        setLastRoundEnd(null);
        roomRef.current = null;
        socketRef.current?.emit('match:startBot');
    }, []);

    const syncMatch = useCallback(() => {
        socketRef.current?.emit('match:sync', {});
    }, []);

    const pickNumber = useCallback(
        (cell: number) => emitMatch('match:pick', { cell }),
        [emitMatch]
    );

    const chooseRole = useCallback(
        (attack: boolean) => emitMatch('match:role', { attack }),
        [emitMatch]
    );

    const makeMove = useCallback(
        (cell: number) => emitMatch('match:move', { cell }),
        [emitMatch]
    );

    const sendChat = useCallback((text: string) => {
        socketRef.current?.emit('sendGlobalChat', { text });
    }, []);

    // Закрыть матч на экране (сервер продолжает помнить его для реванша)
    const clearMatch = useCallback(() => {
        setSnapshot(null);
        setLastRoundEnd(null);
        setWinPattern(null);
    }, []);

    /* ------------------------ выход из матча ------------------------ */

    // Игрок нажал «В меню»: сервер выведет и соперника, чтобы тот не
    // остался один на экране законченного матча
    const leaveMatch = useCallback(() => {
        socketRef.current?.emit('match:leave');
        setSnapshot(null);
        setLastRoundEnd(null);
        setWinPattern(null);
        setPendingTarget(null);
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

    return {
        snapshot,
        lastRoundEnd,
        winPattern,
        messages,
        connected,
        online,
        incoming,
        rematchRequest,
        pendingTarget,
        notice,
        friends,
        leaderboard,
        startBotMatch,
        syncMatch,
        pickNumber,
        chooseRole,
        makeMove,
        sendChat,
        clearMatch,
        sendChallenge,
        respondChallenge,
        requestRematch,
        respondRematch,
        leaveMatch,
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
