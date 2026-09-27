import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { CellValue, PlayerSymbol, ChatMessage } from '../types';

interface OnlineGameState {
    isConnected: boolean;
    isMyTurn: boolean;
    playerSymbol: PlayerSymbol;
    opponentName: string;
    roomId: string | null;
    messages: ChatMessage[];
}

export const useOnlineGame = (
    serverUrl: string,
    username: string
) => {
    const [state, setState] = useState<OnlineGameState>({
        isConnected: false,
        isMyTurn: false,
        playerSymbol: 'X',
        opponentName: '',
        roomId: null,
        messages: []
    });
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        // Пустой URL -> подключение к текущему origin (тот же сервер, что отдал страницу)
        const socket = io(serverUrl || undefined);
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('[Socket] Подключено к серверу');
            setState(prev => ({ ...prev, isConnected: true }));
            socket.emit('userOnline', { username });
        });

        socket.on('disconnect', () => {
            console.log('[Socket] Отключено от сервера');
            setState(prev => ({ ...prev, isConnected: false }));
        });

        socket.on('onlineUsersUpdate', (data: { online: string[] }) => {
            console.log('[Socket] onlineUsersUpdate:', data.online);
        });

        socket.on('gameStart', (data: { board: CellValue[]; currentPlayer: PlayerSymbol; players: string[] }) => {
            console.log('[Socket] gameStart:', data);
            const myName = data.players.find((p: string) => p === username) || username;
            const opponent = data.players.find((p: string) => p !== username) || 'Соперник';
            setState(prev => ({
                ...prev,
                playerSymbol: myName === username ? 'X' : 'O',
                opponentName: opponent,
                isMyTurn: (myName === username ? 'X' : 'O') === data.currentPlayer
            }));
        });

        socket.on('gameUpdate', (data: { board: CellValue[]; currentPlayer: PlayerSymbol; winner: PlayerSymbol | 'draw' | null; players: { symbol: PlayerSymbol; username: string }[] }) => {
            console.log('[Socket] gameUpdate:', data);
            setState(prev => ({
                ...prev,
                isMyTurn: data.currentPlayer === prev.playerSymbol
            }));
        });

        socket.on('challengeReceived', (data: { challengeId: string; from: string }) => {
            console.log('[Socket] challengeReceived:', data);
            alert(`${data.from} вызывает вас на игру!`);
        });

        socket.on('challengeAccepted', (data: { roomId: string; symbol: PlayerSymbol; opponent: string }) => {
            console.log('[Socket] challengeAccepted:', data);
            setState(prev => ({
                ...prev,
                roomId: data.roomId,
                playerSymbol: data.symbol,
                opponentName: data.opponent,
                isMyTurn: data.symbol === 'X'
            }));
        });

        socket.on('challengeDeclined', (data: { by: string }) => {
            console.log('[Socket] challengeDeclined:', data);
            alert(`${data.by} отклонил ваш вызов`);
        });

        socket.on('playerLeft', (data: { symbol: PlayerSymbol }) => {
            console.log('[Socket] playerLeft:', data);
            setState(prev => ({
                ...prev,
                isMyTurn: false,
                opponentName: ''
            }));
        });

        socket.on('globalChatMessage', (msg: ChatMessage) => {
            console.log('[Socket] globalChatMessage:', msg);
            setState(prev => ({
                ...prev,
                messages: [...prev.messages, msg]
            }));
        });

        return () => {
            socket.disconnect();
        };
    }, [serverUrl, username]);

    const createRoom = useCallback(() => {
        if (!socketRef.current) return;
        console.log('[Socket] createRoom');
        socketRef.current.emit('createRoom', { username }, (response: { success: boolean; roomId: string; symbol: PlayerSymbol; username: string }) => {
            console.log('[Socket] createRoom response:', response);
            if (response.success) {
                setState(prev => ({
                    ...prev,
                    roomId: response.roomId,
                    playerSymbol: response.symbol,
                    opponentName: '',
                    isMyTurn: true
                }));
            }
        });
    }, [username]);

    const joinRoom = useCallback((roomId: string) => {
        if (!socketRef.current) return;
        console.log('[Socket] joinRoom:', roomId);
        socketRef.current.emit('joinRoom', roomId, { username }, (response: { success: boolean; roomId: string; symbol: PlayerSymbol; username: string }) => {
            console.log('[Socket] joinRoom response:', response);
            if (response.success) {
                setState(prev => ({
                    ...prev,
                    roomId: response.roomId,
                    playerSymbol: response.symbol,
                    opponentName: '',
                    isMyTurn: response.symbol === 'X'
                }));
            }
        });
    }, [username]);

    const makeMove = useCallback((index: number) => {
        console.log('[OnlineGame] makeMove called, index:', index, 'isMyTurn:', state.isMyTurn, 'onlineMode:', state.roomId !== null);
        if (!socketRef.current || !state.roomId || !state.isMyTurn) {
            console.log('[OnlineGame] makeMove blocked - not my turn or not online');
            return;
        }
        console.log('[Socket] makeMove:', { roomId: state.roomId, index });
        socketRef.current.emit('makeMove', { roomId: state.roomId, index });
    }, [state.roomId, state.isMyTurn]);

    const playAgain = useCallback(() => {
        if (!socketRef.current || !state.roomId) return;
        console.log('[Socket] playAgain:', state.roomId);
        socketRef.current.emit('playAgain', state.roomId);
    }, [state.roomId]);

    const sendChatMessage = useCallback((text: string) => {
        if (!socketRef.current) return;
        console.log('[Socket] sendChatMessage:', text);
        socketRef.current.emit('sendGlobalChat', { text });
    }, []);

    const sendChallenge = useCallback((targetUsername: string) => {
        if (!socketRef.current) return;
        console.log('[Socket] sendChallenge:', targetUsername);
        socketRef.current.emit('sendChallenge', { targetUsername });
    }, []);

    return {
        ...state,
        createRoom,
        joinRoom,
        makeMove,
        playAgain,
        sendChatMessage,
        sendChallenge
    };
};
