const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const users = new Map();
const sessions = new Map();
const onlineUsers = new Map();
const friends = new Map();
const pendingChallenges = new Map();

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            for (const [username, userData] of Object.entries(data)) {
                users.set(username, userData);
                if (userData.friends) {
                    friends.set(username, new Set(userData.friends));
                }
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки пользователей:', e);
    }
}

function saveUsers() {
    try {
        const data = {};
        for (const [username, userData] of users) {
            data[username] = {
                ...userData,
                friends: friends.has(username) ? Array.from(friends.get(username)) : []
            };
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Ошибка сохранения пользователей:', e);
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

loadUsers();

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Логин от 3 до 20 символов' });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    }

    if (users.has(username)) {
        return res.status(409).json({ error: 'Пользователь уже существует' });
    }

    const userData = {
        username,
        password: hashPassword(password),
        rating: 1000,
        wins: 0,
        losses: 0,
        draws: 0,
        streak: 0,
        maxStreak: 0,
        history: [],
        createdAt: new Date().toISOString()
    };

    users.set(username, userData);
    saveUsers();

    const token = generateToken();
    sessions.set(token, {
        username,
        socketId: null
    });

    res.json({
        success: true,
        token,
        user: {
            username: userData.username,
            rating: userData.rating,
            wins: userData.wins,
            losses: userData.losses,
            draws: userData.draws,
            streak: userData.streak,
            maxStreak: userData.maxStreak
        }
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const user = users.get(username);
    if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const token = generateToken();
    sessions.set(token, {
        username,
        socketId: null
    });

    res.json({
        success: true,
        token,
        user: {
            username: user.username,
            rating: user.rating,
            wins: user.wins,
            losses: user.losses,
            draws: user.draws,
            streak: user.streak,
            maxStreak: user.maxStreak
        }
    });
});

app.get('/api/profile', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const user = users.get(session.username);
    if (!user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
    }

    res.json({
        username: user.username,
        rating: user.rating,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        streak: user.streak,
        maxStreak: user.maxStreak,
        history: user.history.slice(-10)
    });
});

app.get('/api/leaderboard', (req, res) => {
    const leaderboard = Array.from(users.values())
        .map(u => ({
            username: u.username,
            rating: u.rating,
            wins: u.wins,
            losses: u.losses,
            draws: u.draws,
            streak: u.streak,
            maxStreak: u.maxStreak
        }))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 10);

    res.json(leaderboard);
});

app.get('/api/online', (req, res) => {
    const onlineList = Array.from(onlineUsers.values()).map(u => ({
        username: u.username,
        rating: u.rating
    }));
    res.json(onlineList);
});

app.get('/api/friends', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const userFriends = friends.get(session.username) || new Set();
    const friendsList = Array.from(userFriends).map(username => {
        const user = users.get(username);
        return {
            username,
            rating: user?.rating || 1000,
            online: onlineUsers.has(username)
        };
    });

    res.json(friendsList);
});

app.post('/api/friends/add', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);
    const { friendUsername } = req.body;

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    if (!users.has(friendUsername)) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (session.username === friendUsername) {
        return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
    }

    if (!friends.has(session.username)) {
        friends.set(session.username, new Set());
    }

    friends.get(session.username).add(friendUsername);

    if (!friends.has(friendUsername)) {
        friends.set(friendUsername, new Set());
    }
    friends.get(friendUsername).add(session.username);

    saveUsers();

    res.json({ success: true, message: 'Друг добавлен' });
});

app.post('/api/friends/remove', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);
    const { friendUsername } = req.body;

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    if (friends.has(session.username)) {
        friends.get(session.username).delete(friendUsername);
    }
    if (friends.has(friendUsername)) {
        friends.get(friendUsername).delete(session.username);
    }

    saveUsers();

    res.json({ success: true, message: 'Друг удалён' });
});

app.post('/api/challenge/send', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);
    const { targetUsername } = req.body;

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    if (!onlineUsers.has(targetUsername)) {
        return res.status(400).json({ error: 'Пользователь не в сети' });
    }

    for (const [roomId, room] of rooms.entries()) {
        if (room.players.some(p => p.username === targetUsername)) {
            return res.status(400).json({ error: 'Пользователь уже в игре' });
        }
    }

    const challengeId = generateToken();
    pendingChallenges.set(challengeId, {
        from: session.username,
        to: targetUsername,
        createdAt: Date.now()
    });

    const targetSocket = onlineUsers.get(targetUsername)?.socketId;
    if (targetSocket) {
        io.to(targetSocket).emit('challengeReceived', {
            challengeId,
            from: session.username
        });
    }

    res.json({ success: true, challengeId });
});

app.post('/api/challenge/accept', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);
    const { challengeId } = req.body;

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const challenge = pendingChallenges.get(challengeId);
    if (!challenge || challenge.to !== session.username) {
        return res.status(400).json({ error: 'Вызов не найден' });
    }

    pendingChallenges.delete(challengeId);

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = createRoom(roomId);
    room.players.push(
        { id: onlineUsers.get(challenge.from)?.socketId, symbol: 'X', username: challenge.from },
        { id: onlineUsers.get(challenge.to)?.socketId, symbol: 'O', username: session.username }
    );
    rooms.set(roomId, room);

    const fromSocket = onlineUsers.get(challenge.from)?.socketId;
    const toSocket = onlineUsers.get(challenge.to)?.socketId;

    if (fromSocket) {
        io.sockets.sockets.get(fromSocket)?.join(roomId);
        io.to(fromSocket).emit('challengeAccepted', { roomId, symbol: 'X', opponent: session.username });
    }
    if (toSocket) {
        io.sockets.sockets.get(toSocket)?.join(roomId);
        io.to(toSocket).emit('challengeAccepted', { roomId, symbol: 'O', opponent: challenge.from });
    }

    res.json({ success: true, roomId });
});

app.post('/api/challenge/decline', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = sessions.get(token);
    const { challengeId } = req.body;

    if (!session) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const challenge = pendingChallenges.get(challengeId);
    if (!challenge || challenge.to !== session.username) {
        return res.status(400).json({ error: 'Вызов не найден' });
    }

    pendingChallenges.delete(challengeId);

    const fromSocket = onlineUsers.get(challenge.from)?.socketId;
    if (fromSocket) {
        io.to(fromSocket).emit('challengeDeclined', { by: session.username });
    }

    res.json({ success: true });
});

const rooms = new Map();

function updatePlayerStats(username, result) {
    const user = users.get(username);
    if (!user) return;

    if (result === 'win') {
        user.wins++;
        user.streak++;
        user.maxStreak = Math.max(user.maxStreak, user.streak);
        user.rating += user.streak >= 4 ? 3 : 2;
    } else if (result === 'loss') {
        user.losses++;
        user.streak = 0;
        user.rating = Math.max(0, user.rating - 1);
    } else {
        user.draws++;
        user.streak = 0;
    }

    user.history.push({
        result,
        date: new Date().toISOString()
    });

    if (user.history.length > 50) {
        user.history = user.history.slice(-50);
    }

    saveUsers();
}

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

    socket.on('userOnline', (data) => {
        const { username } = data;
        if (username && users.has(username)) {
            const user = users.get(username);
            onlineUsers.set(username, {
                username,
                socketId: socket.id,
                rating: user.rating
            });
            sessions.forEach((session, token) => {
                if (session.username === username) {
                    session.socketId = socket.id;
                }
            });
            io.emit('onlineUsersUpdate', {
                online: Array.from(onlineUsers.keys())
            });
        }
    });

    socket.on('userOffline', (data) => {
        const { username } = data;
        if (username && onlineUsers.has(username)) {
            onlineUsers.delete(username);
            io.emit('onlineUsersUpdate', {
                online: Array.from(onlineUsers.keys())
            });
        }
    });

    socket.on('createRoom', (data, callback) => {
        const { username } = data || {};
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const room = createRoom(roomId);
        room.players.push({ id: socket.id, symbol: 'X', username: username || 'X' });
        rooms.set(roomId, room);
        socket.join(roomId);
        callback({ success: true, roomId, symbol: 'X', username: username || 'X' });
        console.log(`Комната создана: ${roomId} пользователем ${username || 'X'}`);
    });

    socket.on('joinRoom', (roomId, data, callback) => {
        const { username } = data || {};
        const room = rooms.get(roomId);

        if (!room) {
            callback({ success: false, error: 'Комната не найдена' });
            return;
        }

        if (room.players.length >= 2) {
            callback({ success: false, error: 'Комната заполнена' });
            return;
        }

        room.players.push({ id: socket.id, symbol: 'O', username: username || 'O' });
        socket.join(roomId);
        callback({ success: true, roomId, symbol: 'O', username: username || 'O' });

        io.to(roomId).emit('gameStart', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            players: room.players.map(p => p.username || p.symbol)
        });

        console.log(`Игрок ${username || 'O'} присоединился к ${roomId}`);
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

            const players = room.players.map(p => ({
                id: p.id,
                symbol: p.symbol,
                username: p.username || p.symbol
            }));

            const winnerPlayer = players.find(p => p.symbol === room.currentPlayer);
            const loserPlayer = players.find(p => p.symbol !== room.currentPlayer);

            if (winnerPlayer && loserPlayer) {
                updatePlayerStats(winnerPlayer.username, 'win');
                updatePlayerStats(loserPlayer.username, 'loss');
            }

            io.to(roomId).emit('gameUpdate', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                winPattern,
                winner: room.currentPlayer,
                scores: room.scores,
                players: players
            });

            setTimeout(() => {
                rooms.delete(roomId);
                console.log(`Комната удалена после игры: ${roomId}`);
            }, 60000);

            return;
        }

        if (room.board.every(c => c !== '')) {
            room.gameActive = false;
            room.scores.Draw++;

            const players = room.players.map(p => ({
                id: p.id,
                symbol: p.symbol,
                username: p.username || p.symbol
            }));

            players.forEach(p => updatePlayerStats(p.username, 'draw'));

            io.to(roomId).emit('gameUpdate', {
                board: room.board,
                currentPlayer: null,
                winPattern: null,
                winner: 'draw',
                scores: room.scores,
                players: players
            });

            setTimeout(() => {
                rooms.delete(roomId);
                console.log(`Комната удалена после игры: ${roomId}`);
            }, 60000);

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
            sender: player.username || player.symbol,
            text: text,
            isOwn: false,
            socketId: socket.id
        });
    });

    socket.on('sendGlobalChat', (data) => {
        const { text } = data;
        const player = Array.from(onlineUsers.values()).find(u => u.socketId === socket.id);
        if (!player) return;

        io.emit('globalChatMessage', {
            sender: player.username,
            text: text,
            socketId: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log(`Отключился: ${socket.id}`);

        for (const [username, data] of onlineUsers.entries()) {
            if (data.socketId === socket.id) {
                onlineUsers.delete(username);
                io.emit('onlineUsersUpdate', {
                    online: Array.from(onlineUsers.keys())
                });
                break;
            }
        }

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
