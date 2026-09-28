import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { MatchSnapshot, MatchStateMessage, ChatMessage, RoundEndInfo, OnlineUser } from '../types';

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
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [connected, setConnected] = useState(false);
    const [online, setOnline] = useState<OnlineUser[]>([]);
    const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
    const [rematchRequest, setRematchRequest] = useState<RematchRequest | null>(null);
    const [pendingTarget, setPendingTarget] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const usernameRef = useRef(username);
    const roomRef = useRef<string | null>(null);

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
            if (msg.type === 'roundEnd' && msg.extra) setLastRoundEnd(msg.extra);
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
    }, []);

    /* ------------------------- вызов на игру ------------------------- */

    const sendChallenge = useCallback(
        async (targetUsername: string) => {
            if (!username || !targetUsername) return;
            const token = localStorage.getItem('token') || '';
            try {
                const res = await fetch('/api/challenge/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ targetUsername })
                });
                const data = await res.json();
                if (!res.ok) {
                    setNotice(data.error || 'Не удалось отправить вызов');
                    return;
                }
                setPendingTarget(targetUsername);
            } catch {
                setNotice('Сеть недоступна');
            }
        },
        [username]
    );

    const respondChallenge = useCallback(
        async (accept: boolean) => {
            if (!incoming) return;
            const token = localStorage.getItem('token') || '';
            const endpoint = accept ? '/api/challenge/accept' : '/api/challenge/decline';
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ challengeId: incoming.challengeId })
                });
                const data = await res.json();
                if (!res.ok) setNotice(data.error || 'Не удалось ответить на вызов');
            } catch {
                setNotice('Сеть недоступна');
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

    return {
        snapshot,
        lastRoundEnd,
        messages,
        connected,
        online,
        incoming,
        rematchRequest,
        pendingTarget,
        notice,
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
        clearNotice
    };
}

function keyOf(m: ChatMessage) {
    return `${m.sender}|${m.text}|${m.timestamp}`;
}
