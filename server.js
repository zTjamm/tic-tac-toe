const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cors = require('cors');
const { MatchManager } = require('./match-manager');
const { STRIKE_LIMIT } = require('./match');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true
}));
// Статика React-приложения (собранного в tic-tac-toe-react/dist)
const REACT_DIST = path.join(__dirname, 'tic-tac-toe-react', 'dist');
const REACT_DIST_INDEX = path.join(REACT_DIST, 'index.html');
const hasReactBuild = fs.existsSync(REACT_DIST_INDEX);

if (hasReactBuild) {
    app.use(express.static(REACT_DIST));
} else {
    console.warn('[Server] ВНИМАНИЕ: не найден tic-tac-toe-react/dist/index.html');
    console.warn('[Server] Соберите фронтенд: cd tic-tac-toe-react && npm run build');
}

app.use(express.json());

// Установка кодировки для JSON-ответов API
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    next();
});

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

app.get('/api/chat-history', (req, res) => {
    res.json(chatHistory);
});

app.get('/api/online', (req, res) => {
    const onlineList = Array.from(onlineUsers.values()).map(u => {
        const user = users.get(u.username);
        return {
            username: u.username,
            rating: user?.rating || 1000
        };
    });
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

    console.log('[Server] challenge/send:', { from: session?.username, to: targetUsername });

    if (!session) {
        console.log('[Server] challenge/send: unauthorized');
        return res.status(401).json({ error: 'Не авторизован' });
    }

    if (!onlineUsers.has(targetUsername)) {
        console.log('[Server] challenge/send: target not online');
        return res.status(400).json({ error: 'Пользователь не в сети' });
    }

    // Нельзя вызвать того, кто уже в матче
    if (matchManager.roomOf(targetUsername)) {
        console.log('[Server] challenge/send: target already in match');
        return res.status(400).json({ error: 'Пользователь уже в игре' });
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

    const opponent = challenge.from;
    const roomId = startHumanMatch(opponent, session.username);

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

const chatHistory = [];
const MAX_CHAT_HISTORY = 100;

// Рейтинг по итогам матча: победа +2, поражение -1. Формулу с учётом разницы
// рейтингов участников ещё предстоит обсудить, поэтому пока плоская.
const MATCH_WIN_POINTS = 2;
const MATCH_LOSS_POINTS = -1;

const matchManager = new MatchManager(io, {
    // Финал освобождает игроков - обновляем список онлайна, иначе в нём
    // они останутся занятыми и их нельзя будет вызвать на новую игру
    onFinish: () => broadcastOnline(),
    onResult: (winner, loser, result) => {
        if (winner && !winner.isBot) updatePlayerStats(winner.username, 'win');
        if (loser && !loser.isBot) updatePlayerStats(loser.username, 'loss');
        console.log(`[Match] матч окончен: ${result.reason || 'score'}, победил ${winner ? winner.username : '-'}`);
    }
});

// Ник, объявленный сокетом. Нужен отдельно onlineUsers: там запись может
// ещё не появиться (или уже быть удалена другим сокетом), и обработчики
// матча тогда молча выходили бы.
const socketUsernames = new Map();

function usernameBySocket(socketId) {
    return socketUsernames.get(socketId) || null;
}

// Игрок, с которым сервер реально готов работать: ник известен и существует
function resolvePlayer(socketId) {
    const username = usernameBySocket(socketId);
    if (!username) return null;
    if (!users.has(username)) {
        console.warn(`[Match] неизвестный игрок "${username}" с сокета ${socketId}`);
        return null;
    }
    return username;
}

// Список онлайна с рейтингом и признаком "занят матчем" - панели нужно
// знать, кому можно предлагать игру
function onlineList() {
    const list = [];
    for (const [username] of onlineUsers) {
        const u = users.get(username);
        list.push({
            username,
            rating: u ? u.rating : 1000,
            inMatch: !!matchManager.roomOf(username)
        });
    }
    return list;
}

function broadcastOnline() {
    io.emit('onlineUsersUpdate', { online: onlineList() });
}

// Создаёт матч между двумя людьми, сажает оба сокета в комнату и
// отправляет им состояние. Матч сразу стартует с угадайки 1-го раунда.
// oldRoom - комната предыдущего матча: из неё надо выйти, иначе игрок
// продолжит получать снимки того матча, который уже закончился.
function startHumanMatch(a, b, oldRoom = null) {
    // byPlayer смотрим до dispose: он очищает эти записи
    const leave = new Set();
    if (oldRoom) leave.add(oldRoom);
    for (const name of [a, b]) {
        for (const r of [matchManager.roomOf(name), matchManager.finishedRoomOf(name)]) {
            if (r) leave.add(r);
        }
    }
    if (oldRoom) matchManager.dispose(oldRoom);

    const { roomId } = matchManager.createHumanMatch(a, b);
    for (const name of [a, b]) {
        const sid = onlineUsers.get(name)?.socketId;
        const sock = sid ? io.sockets.sockets.get(sid) : null;
        if (!sock) continue;
        for (const r of leave) sock.leave(r);
        sock.join(roomId);
    }
    const snap = matchManager.snapshotOf(roomId);
    for (const name of [a, b]) {
        const sid = onlineUsers.get(name)?.socketId;
        if (sid && snap) {
            io.to(sid).emit('match:state', { type: 'sync', extra: null, snapshot: snap });
        }
    }
    broadcastOnline();
    return roomId;
}

function updatePlayerStats(username, result) {
    const user = users.get(username);
    if (!user) return;

    if (result === 'win') {
        user.wins++;
        user.streak++;
        user.maxStreak = Math.max(user.maxStreak, user.streak);
        // TODO: здесь будет формула с учётом разницы рейтингов участников
        user.rating += MATCH_WIN_POINTS;
    } else if (result === 'loss') {
        user.losses++;
        user.streak = 0;
        // Дельты складываются: MATCH_LOSS_POINTS = -1, поэтому rating уменьшается
        user.rating = Math.max(0, user.rating + MATCH_LOSS_POINTS);
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

io.on('connection', (socket) => {
    console.log(`Подключился: ${socket.id}`);

    socket.on('userOnline', (data) => {
        const { username } = data;
        if (username) {
            socketUsernames.set(socket.id, username);
        }
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
            broadcastOnline();

            // Вернулся в матч после обрыва: входим в комнату и получаем
            // оставшееся время на ход вместо отмены матча
            const roomId = matchManager.roomOf(username);
            if (roomId) {
                socket.join(roomId);
                matchManager.handleReconnect(username);
            }
        }
    });

    socket.on('userOffline', (data) => {
        const { username } = data;
        if (username && onlineUsers.has(username)) {
            onlineUsers.delete(username);
            broadcastOnline();
        }
    });

    /* ================= матч: создание и действия ================= */

    socket.on('match:startBot', () => {
        const username = resolvePlayer(socket.id);
        if (!username) return;
        // Игрок не может быть в двух матчах одновременно
        const existing = matchManager.roomOf(username);
        if (existing) {
            const snap = matchManager.snapshotOf(existing);
            if (snap && snap.phase !== 'finished') {
                socket.join(existing);
                socket.emit('match:state', { type: 'sync', extra: null, snapshot: snap });
                return;
            }
            matchManager.dispose(existing);
        }

        const { roomId } = matchManager.createBotMatch(username);
        socket.join(roomId);
        // Первое состояние уходит в broadcast до того, как сокет вошёл в
        // комнату, поэтому шлём снимок явно - иначе клиент ничего не увидит
        // до следующего события (через 5 секунд отсчёта).
        const snap = matchManager.snapshotOf(roomId);
        if (snap) socket.emit('match:state', { type: 'sync', extra: null, snapshot: snap });
        console.log(`[Match] бот-матч ${roomId}: ${username}`);
    });

    socket.on('match:pick', (data) => {
        const username = usernameBySocket(socket.id);
        const { roomId, cell } = data || {};
        if (!username || !roomId) return;
        matchManager.pick(roomId, username, cell);
    });

    socket.on('match:role', (data) => {
        const username = usernameBySocket(socket.id);
        const { roomId, attack } = data || {};
        if (!username || !roomId) return;
        matchManager.chooseRole(roomId, username, attack);
    });

    socket.on('match:move', (data) => {
        const username = usernameBySocket(socket.id);
        const { roomId, cell } = data || {};
        if (!username || !roomId) return;
        matchManager.move(roomId, username, cell);
    });

    socket.on('match:sync', () => {
        const username = usernameBySocket(socket.id);
        if (!username) return;
        const roomId = matchManager.roomOf(username);
        if (!roomId) return;
        socket.join(roomId);
        const snap = matchManager.snapshotOf(roomId);
        if (snap) socket.emit('match:state', { type: 'sync', extra: null, snapshot: snap });
    });

    /* ================ сетевой матч: вызов и реванш ================ */

    socket.on('match:rematch', () => {
        const username = usernameBySocket(socket.id);
        if (!username) return;

        // Реванш возможен только по завершённому матчу: в идущем игрок
        // просто играет, а кнопки «Реванш» на экране нет
        const roomId = matchManager.finishedRoomOf(username);
        const snap = roomId ? matchManager.snapshotOf(roomId) : null;
        if (!snap || snap.phase !== 'finished') {
            // матч мог быть уже убран по таймеру очистки - сообщаем, чтобы
            // кнопка не выглядела сломанной
            socket.emit('rematchError', { message: 'Предыдущий матч уже недоступен' });
            return;
        }

        const opponent = snap.players.find(p => p.id !== username && !p.isBot);
        if (!opponent) return;

        if (!onlineUsers.has(opponent.id)) {
            socket.emit('rematchError', { message: 'Соперник не в сети' });
            return;
        }

        const opponentSocket = onlineUsers.get(opponent.id)?.socketId;
        if (opponentSocket) {
            io.to(opponentSocket).emit('rematchRequested', { from: username });
        }
        socket.emit('rematchPending', { to: opponent.id });
    });

    socket.on('match:rematchResponse', (data) => {
        const username = usernameBySocket(socket.id);
        const { from, accept } = data || {};
        if (!username || !from) return;

        if (!accept) {
            const sid = onlineUsers.get(from)?.socketId;
            if (sid) io.to(sid).emit('rematchDeclined', { by: username });
            return;
        }

        // Пока игрок думал над ответом, соперник мог уйти в другой матч
        if (matchManager.roomOf(username) || matchManager.roomOf(from)) {
            socket.emit('rematchError', { message: 'Кто-то уже играет' });
            return;
        }
        if (!onlineUsers.has(from)) {
            socket.emit('rematchError', { message: 'Соперник не в сети' });
            return;
        }

        // Старый матч освобождаем, иначе byPlayer продолжит указывать на него
        const oldRoom = matchManager.roomOf(username) ||
            matchManager.finishedRoomOf(username);

        startHumanMatch(from, username, oldRoom);
        console.log(`[Match] реванш: ${from} и ${username}`);
    });

    /* ============================ чат ============================ */

    // sendChatMessage (комнатный) удалён вместе с комнатами: чат один общий
    socket.on('sendGlobalChat', (data) => {
        const { text } = data;
        const player = Array.from(onlineUsers.values()).find(u => u.socketId === socket.id);
        if (!player) return;

        const message = {
            sender: player.username,
            text: text,
            socketId: socket.id,
            timestamp: Date.now()
        };

        chatHistory.push(message);
        if (chatHistory.length > MAX_CHAT_HISTORY) {
            chatHistory.shift();
        }

        io.emit('globalChatMessage', message);
    });

    socket.on('disconnect', () => {
        console.log(`Отключился: ${socket.id}`);
        const name = socketUsernames.get(socket.id);
        socketUsernames.delete(socket.id);
        if (!name) return;

        // Удаляем из онлайна только если запись всё ещё указывает на этот сокет:
        // игрок мог открыть вторую вкладку и уже перерегистрироваться
        const entry = onlineUsers.get(name);
        if (entry && entry.socketId === socket.id) {
            onlineUsers.delete(name);
        }

        // Матч не отменяется сразу: у игрока есть время на переподключение
        matchManager.handleDisconnect(name);
        broadcastOnline();
    });
});

// SPA fallback: любые не-API маршруты отдают index.html React-приложения
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    // Запрос статического файла (есть расширение), которого нет в dist —
    // отдаём 404, а не index.html. Иначе браузер попытается выполнить
    // HTML как JS и покажет непонятную ошибку вместо ясного 404.
    if (path.extname(req.path)) {
        return next();
    }
    if (!hasReactBuild) {
        return res.status(503).type('text/plain; charset=utf-8')
            .send('Фронтенд не собран. Выполните: cd tic-tac-toe-react && npm run build');
    }
    res.sendFile(REACT_DIST_INDEX);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
