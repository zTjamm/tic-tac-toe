import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { MatchSnapshot, MatchStateMessage, ChatMessage, RoundEndInfo } from '../types';

/**
 * Подписка на матч. Сервер — единственный источник правды по очкам, ролям и
 * таймерам: клиент только отображает снимок и отправляет действия.
 */

export function useMatch(username: string) {
    const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
    const [lastRoundEnd, setLastRoundEnd] = useState<RoundEndInfo | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [connected, setConnected] = useState(false);

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

    return {
        snapshot,
        lastRoundEnd,
        messages,
        connected,
        startBotMatch,
        syncMatch,
        pickNumber,
        chooseRole,
        makeMove,
        sendChat,
        clearMatch
    };
}

function keyOf(m: ChatMessage) {
    return `${m.sender}|${m.text}|${m.timestamp}`;
}
