const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = new Map();

function createRoom(roomId) {
    return {
        id: roomId,
        board: Array(9).fill(''),
        players: [],
        currentPlayer: 'X',
        gameActive: true,
        scores: { X: 0, O: 0, Draw: 0 },
        winPatterns: [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ]
    };
}

function checkWinFor(board, player, winPatterns) {
    return winPatterns.some(pattern => {
        const [a, b, c] = pattern;
        return board[a] === player &&
               board[b] === player &&
               board[c] === player;
    });
}

function getWinPattern(board, player, winPatterns) {
    return winPatterns.find(pattern => {
        const [a, b, c] = pattern;
        return board[a] === player &&
               board[b] === player &&
               board[c] === player;
    });
}

io.on('connection', (socket) => {
    console.log(`Подключился: ${socket.id}`);

    socket.on('createRoom', (callback) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const room = createRoom(roomId);
        room.players.push({ id: socket.id, symbol: 'X' });
        rooms.set(roomId, room);
        socket.join(roomId);
        callback({ success: true, roomId, symbol: 'X' });
        console.log(`Комната создана: ${roomId}`);
    });

    socket.on('joinRoom', (roomId, callback) => {
        const room = rooms.get(roomId);

        if (!room) {
            callback({ success: false, error: 'Комната не найдена' });
            return;
        }

        if (room.players.length >= 2) {
            callback({ success: false, error: 'Комната заполнена' });
            return;
        }

        room.players.push({ id: socket.id, symbol: 'O' });
        socket.join(roomId);
        callback({ success: true, roomId, symbol: 'O' });

        io.to(roomId).emit('gameStart', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            players: room.players.map(p => p.symbol)
        });

        console.log(`Игрок присоединился к ${roomId}`);
    });

    socket.on('makeMove', (data) => {
        const { roomId, index } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameActive) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.symbol !== room.currentPlayer) return;
        if (room.board[index] !== '') return;

        room.board[index] = room.currentPlayer;

        const winPattern = checkWinFor(room.board, room.currentPlayer, room.winPatterns);

        if (winPattern) {
            room.gameActive = false;
            room.scores[room.currentPlayer]++;
            io.to(roomId).emit('gameUpdate', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                winPattern,
                winner: room.currentPlayer,
                scores: room.scores
            });
            return;
        }

        if (room.board.every(c => c !== '')) {
            room.gameActive = false;
            room.scores.Draw++;
            io.to(roomId).emit('gameUpdate', {
                board: room.board,
                currentPlayer: null,
                winPattern: null,
                winner: 'draw',
                scores: room.scores
            });
            return;
        }

        room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';

        io.to(roomId).emit('gameUpdate', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            winPattern: null,
            winner: null,
            scores: room.scores
        });
    });

    socket.on('playAgain', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.board = Array(9).fill('');
        room.currentPlayer = 'X';
        room.gameActive = true;

        io.to(roomId).emit('gameUpdate', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            winPattern: null,
            winner: null,
            scores: room.scores
        });
    });

    socket.on('sendChatMessage', (data) => {
        const { roomId, text } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        io.to(roomId).emit('chatMessage', {
            sender: player.symbol,
            text: text,
            isOwn: false,
            socketId: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log(`Отключился: ${socket.id}`);

        for (const [roomId, room] of rooms.entries()) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const symbol = room.players[playerIndex].symbol;
                room.players.splice(playerIndex, 1);

                if (room.players.length === 0) {
                    rooms.delete(roomId);
                    console.log(`Комната удалена: ${roomId}`);
                } else {
                    io.to(roomId).emit('playerLeft', { symbol });
                    room.board = Array(9).fill('');
                    room.currentPlayer = 'X';
                    room.gameActive = false;
                    io.to(roomId).emit('gameUpdate', {
                        board: room.board,
                        currentPlayer: null,
                        winPattern: null,
                        winner: null,
                        scores: room.scores
                    });
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
