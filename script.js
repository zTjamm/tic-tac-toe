class TicTacToe {
    constructor() {
        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.gameActive = true;
        this.mode = 'pvp';
        this.scores = { X: 0, O: 0, Draw: 0 };
        this.botTimer = null;

        this.winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        this.cells = document.querySelectorAll('.cell');
        this.statusDisplay = document.getElementById('status');
        this.scoreXDisplay = document.getElementById('scoreX');
        this.scoreODisplay = document.getElementById('scoreO');
        this.scoreDrawDisplay = document.getElementById('scoreDraw');

        this.init();
    }

    init() {
        this.cells.forEach(cell => {
            cell.addEventListener('click', (e) => this.handleCellClick(e));
            cell.addEventListener('touchend', (e) => this.handleCellClick(e));
        });

        document.getElementById('resetBtn').addEventListener('click', () => this.resetGame());
        document.getElementById('resetScoreBtn').addEventListener('click', () => this.resetScore());

        document.querySelectorAll('.btn-mode').forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.target.dataset.mode));
        });

        this.updateScoreDisplay();
        this.updateStatus();
    }

    handleCellClick(e) {
        e.preventDefault();
        const cell = e.target.closest('.cell');
        if (!cell || !this.gameActive || cell.classList.contains('taken')) return;

        if (this.mode === 'bot' && this.currentPlayer === 'O') return;

        this.makeMove(cell);

        if (this.gameActive && this.mode === 'bot' && this.currentPlayer === 'O') {
            this.statusDisplay.textContent = 'Бот думает...';
            this.botTimer = setTimeout(() => this.botMove(), 500);
        }
    }

    makeMove(cell) {
        const index = parseInt(cell.dataset.index);

        if (this.board[index] !== '' || !this.gameActive) return;

        this.board[index] = this.currentPlayer;
        cell.textContent = this.currentPlayer;
        cell.classList.add('taken');
        cell.classList.add(this.currentPlayer.toLowerCase());

        if (this.checkWin()) {
            this.gameActive = false;
            this.highlightWin();
            this.scores[this.currentPlayer]++;
            this.statusDisplay.textContent = `Игрок ${this.currentPlayer} победил!`;
            this.statusDisplay.className = 'status win';
            this.updateScoreDisplay();
            return;
        }

        if (this.checkDraw()) {
            this.gameActive = false;
            this.scores.Draw++;
            this.statusDisplay.textContent = 'Ничья!';
            this.statusDisplay.className = 'status draw';
            this.updateScoreDisplay();
            return;
        }

        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        this.updateStatus();
    }

    checkWin() {
        return this.winPatterns.some(pattern => {
            const [a, b, c] = pattern;
            return this.board[a] &&
                   this.board[a] === this.board[b] &&
                   this.board[a] === this.board[c];
        });
    }

    highlightWin() {
        this.winPatterns.forEach(pattern => {
            const [a, b, c] = pattern;
            if (this.board[a] &&
                this.board[a] === this.board[b] &&
                this.board[a] === this.board[c]) {
                this.cells[a].classList.add('win');
                this.cells[b].classList.add('win');
                this.cells[c].classList.add('win');
            }
        });
    }

    checkDraw() {
        return this.board.every(cell => cell !== '');
    }

    updateStatus() {
        if (!this.gameActive) return;
        const playerName = this.currentPlayer === 'X' ? 'X' : 'O';
        this.statusDisplay.textContent = `Ход игрока ${this.currentPlayer} (${playerName})`;
        this.statusDisplay.className = `status ${this.currentPlayer.toLowerCase()}-turn`;
    }

    updateScoreDisplay() {
        this.scoreXDisplay.textContent = this.scores.X;
        this.scoreODisplay.textContent = this.scores.O;
        this.scoreDrawDisplay.textContent = this.scores.Draw;
    }

    resetGame() {
        if (this.botTimer) {
            clearTimeout(this.botTimer);
            this.botTimer = null;
        }

        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.gameActive = true;

        this.cells.forEach(cell => {
            cell.textContent = '';
            cell.className = 'cell';
        });

        this.updateStatus();
    }

    resetScore() {
        this.scores = { X: 0, O: 0, Draw: 0 };
        this.updateScoreDisplay();
        this.resetGame();
    }

    setMode(mode) {
        this.mode = mode;
        document.querySelectorAll('.btn-mode').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        this.resetGame();
    }

    botMove() {
        if (!this.gameActive || this.currentPlayer !== 'O') return;

        let move = this.findBestMove();

        if (move === -1) {
            const emptyCells = this.board
                .map((v, i) => v === '' ? i : -1)
                .filter(i => i !== -1);
            move = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        }

        this.makeMove(this.cells[move]);
    }

    findBestMove() {
        // Try to win
        for (let i = 0; i < 9; i++) {
            if (this.board[i] === '') {
                this.board[i] = 'O';
                if (this.checkWinFor('O')) {
                    this.board[i] = '';
                    return i;
                }
                this.board[i] = '';
            }
        }

        // Block player from winning
        for (let i = 0; i < 9; i++) {
            if (this.board[i] === '') {
                this.board[i] = 'X';
                if (this.checkWinFor('X')) {
                    this.board[i] = '';
                    return i;
                }
                this.board[i] = '';
            }
        }

        // Take center
        if (this.board[4] === '') return 4;

        // Take corners
        const corners = [0, 2, 6, 8].filter(i => this.board[i] === '');
        if (corners.length > 0) {
            return corners[Math.floor(Math.random() * corners.length)];
        }

        // Take any available
        const empty = this.board
            .map((v, i) => v === '' ? i : -1)
            .filter(i => i !== -1);
        if (empty.length > 0) {
            return empty[Math.floor(Math.random() * empty.length)];
        }

        return -1;
    }

    checkWinFor(player) {
        return this.winPatterns.some(pattern => {
            const [a, b, c] = pattern;
            return this.board[a] === player &&
                   this.board[b] === player &&
                   this.board[c] === player;
        });
    }
}

class OnlineGame {
    constructor(ticTacToe) {
        this.ticTacToe = ticTacToe;
        this.socket = null;
        this.roomId = null;
        this.playerSymbol = null;
        this.isMyTurn = false;
        this.onlineMode = false;
    }

    connect() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Подключено к серверу');
        });

        this.socket.on('gameStart', (data) => {
            this.ticTacToe.board = data.board;
            this.ticTacToe.currentPlayer = data.currentPlayer;
            this.ticTacToe.gameActive = true;
            this.ticTacToe.cells.forEach(cell => {
                cell.textContent = '';
                cell.className = 'cell';
            });
            this.updateBoard(data.board);

            if (data.players && data.players.length >= 2) {
                const names = data.players;
                this.playerName = names.find(n => n === this.playerSymbol || n === this.ticTacToe.authSystem?.user?.username) || this.playerSymbol;
                this.opponentName = names.find(n => n !== this.playerName) || (this.playerSymbol === 'X' ? 'O' : 'X');
            }

            this.updateStatusForOnline();
        });

        this.socket.on('gameUpdate', (data) => {
            this.ticTacToe.board = data.board;
            this.updateBoard(data.board);

            if (data.winner === 'draw') {
                this.ticTacToe.gameActive = false;
                this.ticTacToe.statusDisplay.textContent = 'Ничья!';
                this.ticTacToe.statusDisplay.className = 'status draw';
            } else if (data.winner) {
                this.ticTacToe.gameActive = false;
                if (data.winPattern) {
                    this.ticTacToe.highlightWinPattern(data.winPattern);
                }
                const isMe = data.winner === this.playerSymbol;
                this.ticTacToe.statusDisplay.textContent = isMe ? 'Вы победили!' : 'Вы проиграли!';
                this.ticTacToe.statusDisplay.className = 'status win';
            } else {
                this.ticTacToe.currentPlayer = data.currentPlayer;
                this.updateStatusForOnline();
            }

            this.ticTacToe.scores = data.scores;
            this.ticTacToe.updateScoreDisplay();
        });

        this.socket.on('playerLeft', (data) => {
            this.ticTacToe.gameActive = false;
            this.ticTacToe.statusDisplay.textContent = 'Противник отключился';
            this.ticTacToe.statusDisplay.className = 'status draw';
        });
    }

    createRoom() {
        const username = this.ticTacToe.authSystem?.user?.username || 'X';
        this.socket.emit('createRoom', { username }, (response) => {
            if (response.success) {
                this.roomId = response.roomId;
                this.playerSymbol = response.symbol;
                this.onlineMode = true;
                this.showRoomId();
                this.ticTacToe.statusDisplay.textContent = 'Ожидание противника...';
                this.ticTacToe.statusDisplay.className = 'status';
                this.ticTacToe.gameActive = false;
            }
        });
    }

    joinRoom(roomId) {
        const username = this.ticTacToe.authSystem?.user?.username || 'O';
        this.socket.emit('joinRoom', roomId, { username }, (response) => {
            if (response.success) {
                this.roomId = response.roomId;
                this.playerSymbol = response.symbol;
                this.onlineMode = true;
                this.hideRoomInput();
            } else {
                alert(response.error);
            }
        });
    }

    makeMove(index) {
        if (!this.onlineMode || !this.isMyTurn) return;
        this.socket.emit('makeMove', { roomId: this.roomId, index });
    }

    playAgain() {
        if (this.onlineMode && this.roomId) {
            this.socket.emit('playAgain', this.roomId);
        }
    }

    updateBoard(board) {
        this.ticTacToe.cells.forEach((cell, i) => {
            cell.textContent = board[i];
            if (board[i]) {
                cell.classList.add('taken');
                cell.classList.add(board[i].toLowerCase());
            } else {
                cell.classList.remove('taken', 'x', 'o');
            }
        });
    }

    updateStatusForOnline() {
        this.isMyTurn = this.ticTacToe.currentPlayer === this.playerSymbol;
        const symbol = this.ticTacToe.currentPlayer;
        const playerName = this.playerName || this.playerSymbol;
        const opponentName = this.opponentName || (this.currentPlayer === 'X' ? 'X' : 'O');

        if (this.isMyTurn) {
            this.ticTacToe.statusDisplay.textContent = `Ваш ход (${playerName})`;
        } else {
            this.ticTacToe.statusDisplay.textContent = `Ход противника (${opponentName})`;
        }
        this.ticTacToe.statusDisplay.className = `status ${symbol.toLowerCase()}-turn`;
    }

    showRoomId() {
        const roomDiv = document.getElementById('roomIdDisplay');
        if (roomDiv) roomDiv.remove();

        const inviteLink = `${window.location.origin}?room=${this.roomId}`;

        const div = document.createElement('div');
        div.id = 'roomIdDisplay';
        div.className = 'room-display';
        div.innerHTML = `
            <p>ID комнаты: <strong>${this.roomId}</strong></p>
            <p class="hint">Отправьте этот код другу</p>
            <button class="btn-small" onclick="navigator.clipboard.writeText('${this.roomId}')">Копировать ID</button>
            <button class="btn-small" onclick="navigator.clipboard.writeText('${inviteLink}')">Копировать ссылку</button>
        `;
        document.querySelector('.container').insertBefore(div, document.querySelector('.scoreboard'));
    }

    hideRoomInput() {
        const roomInput = document.getElementById('roomInput');
        if (roomInput) roomInput.remove();
    }
}

class RatingSystem {
    constructor() {
        this.ratings = {};
        this.streaks = {};
        this.loadFromStorage();
    }

    loadFromStorage() {
        const saved = localStorage.getItem('ticTacToeRatings');
        if (saved) {
            const data = JSON.parse(saved);
            this.ratings = data.ratings || {};
            this.streaks = data.streaks || {};
        }
    }

    saveToStorage() {
        localStorage.setItem('ticTacToeRatings', JSON.stringify({
            ratings: this.ratings,
            streaks: this.streaks
        }));
    }

    getRating(playerId) {
        return this.ratings[playerId] || 1000;
    }

    getStreak(playerId) {
        return this.streaks[playerId] || 0;
    }

    updateRating(playerId, result) {
        const currentRating = this.getRating(playerId);
        const currentStreak = this.getStreak(playerId);
        let change = 0;

        if (result === 'win') {
            change = 2;
            this.streaks[playerId] = currentStreak + 1;
            if (this.streaks[playerId] >= 4) {
                change = 3;
            }
        } else if (result === 'loss') {
            change = -1;
            this.streaks[playerId] = 0;
        } else {
            this.streaks[playerId] = 0;
        }

        this.ratings[playerId] = Math.max(0, currentRating + change);
        this.saveToStorage();

        return { newRating: this.ratings[playerId], change, streak: this.streaks[playerId] };
    }

    resetRatings() {
        this.ratings = {};
        this.streaks = {};
        localStorage.removeItem('ticTacToeRatings');
    }
}

class ChatSystem {
    constructor(socket, game) {
        this.socket = socket;
        this.game = game;
        this.container = document.getElementById('chatContainer');
        this.messagesContainer = document.getElementById('chatMessages');
        this.input = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendChatBtn');

        this.init();
    }

    init() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.socket.on('chatMessage', (data) => {
            this.addMessage(data.sender, data.text, data.isOwn);
        });
    }

    show() {
        this.container.style.display = 'block';
    }

    hide() {
        this.container.style.display = 'none';
    }

    sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        this.socket.emit('sendChatMessage', { text });
        this.input.value = '';
    }

    addMessage(sender, text, isOwn) {
        const div = document.createElement('div');
        div.className = `chat-message ${isOwn ? 'own' : 'other'}`;
        div.innerHTML = `
            <div class="sender">${sender}</div>
            <div class="text"></div>
        `;
        div.querySelector('.text').textContent = text;
        this.messagesContainer.appendChild(div);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    clear() {
        this.messagesContainer.innerHTML = '';
    }
}

class OnlineUsersManager {
    constructor(socket, game) {
        this.socket = socket;
        this.game = game;
        this.onlineUsers = new Set();
        this.panel = document.getElementById('onlinePanel');
        this.list = document.getElementById('onlineList');
        this.count = document.getElementById('onlineCount');

        this.init();
    }

    init() {
        document.getElementById('toggleOnlinePanel').addEventListener('click', () => {
            this.panel.classList.toggle('collapsed');
            const btn = document.getElementById('toggleOnlinePanel');
            btn.textContent = this.panel.classList.contains('collapsed') ? 'Развернуть' : 'Свернуть';
        });

        this.socket.on('onlineUsersUpdate', (data) => {
            this.onlineUsers = new Set(data.online);
            this.updateList();
        });

        this.socket.on('connect', () => {
            if (this.game.authSystem?.user) {
                this.setOnline(this.game.authSystem.user.username);
            }
        });

        this.socket.on('challengeReceived', (data) => {
            this.showChallengeModal(data);
        });

        this.socket.on('challengeAccepted', (data) => {
            document.getElementById('challengeModal').style.display = 'none';
            this.game.onlineGame.roomId = data.roomId;
            this.game.onlineGame.playerSymbol = data.symbol;
            this.game.onlineGame.onlineMode = true;
            this.game.onlineGame.showRoomId();
            this.game.ticTacToe.statusDisplay.textContent = 'Игра началась!';
            this.game.ticTacToe.statusDisplay.className = 'status';
            this.game.ticTacToe.gameActive = true;
        });

        this.socket.on('challengeDeclined', (data) => {
            alert(`${data.by} отклонил ваш вызов`);
        });

        if (this.game.authSystem?.user) {
            this.setOnline(this.game.authSystem.user.username);
        }
    }

    setOnline(username) {
        this.socket.emit('userOnline', { username });
    }

    setOffline(username) {
        this.socket.emit('userOffline', { username });
    }

    updateList() {
        this.count.textContent = this.onlineUsers.size;

        const currentUsername = this.game.authSystem?.user?.username;
        const filteredUsers = Array.from(this.onlineUsers).filter(u => u !== currentUsername);

        if (filteredUsers.length === 0) {
            this.list.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-muted);">Никого нет онлайн</div>';
            return;
        }

        this.list.innerHTML = filteredUsers.map(username => `
            <div class="online-item" data-username="${username}">
                <span class="online-dot"></span>
                <div class="online-info">
                    <div class="online-name">${username}</div>
                    <div class="online-rating">Рейтинг: ${this.game.authSystem?.user?.username === username ? this.game.authSystem.user.rating : '???'}</div>
                </div>
                <button class="btn-small challenge-btn" data-username="${username}">Вызвать</button>
            </div>
        `).join('');

        this.list.querySelectorAll('.challenge-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetUsername = btn.dataset.username;
                this.sendChallenge(targetUsername);
            });
        });
    }

    sendChallenge(targetUsername) {
        if (!this.game.authSystem?.token) {
            alert('Войдите в аккаунт, чтобы вызывать игроков');
            return;
        }

        fetch('/api/challenge/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.game.authSystem.token}`
            },
            body: JSON.stringify({ targetUsername })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Вызов отправлен игроку ${targetUsername}`);
            } else {
                alert(data.error || 'Ошибка отправки вызова');
            }
        })
        .catch(err => {
            alert('Ошибка сети');
        });
    }

    showChallengeModal(data) {
        const modal = document.getElementById('challengeModal');
        document.getElementById('challengeFrom').textContent = data.from;
        modal.style.display = 'flex';

        const acceptBtn = document.getElementById('challengeAcceptBtn');
        const declineBtn = document.getElementById('challengeDeclineBtn');

        acceptBtn.onclick = () => {
            fetch('/api/challenge/accept', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.game.authSystem.token}`
                },
                body: JSON.stringify({ challengeId: data.challengeId })
            })
            .then(res => res.json())
            .then(result => {
                if (!result.success) {
                    alert(result.error || 'Ошибка');
                }
            });
        };

        declineBtn.onclick = () => {
            fetch('/api/challenge/decline', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.game.authSystem.token}`
                },
                body: JSON.stringify({ challengeId: data.challengeId })
            });
            modal.style.display = 'none';
        };
    }
}

class FriendsManager {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('friendsModal');
        this.list = document.getElementById('friendsList');
        this.searchInput = document.getElementById('friendSearch');

        this.init();
    }

    init() {
        document.getElementById('friendsClose').addEventListener('click', () => {
            this.modal.style.display = 'none';
        });

        this.searchInput.addEventListener('input', (e) => {
            this.searchUser(e.target.value);
        });

        const friendsBtn = document.createElement('button');
        friendsBtn.className = 'btn';
        friendsBtn.textContent = 'Друзья';
        friendsBtn.style.marginTop = '10px';
        friendsBtn.addEventListener('click', () => this.showFriends());
        document.querySelector('.controls').appendChild(friendsBtn);
    }

    showFriends() {
        this.modal.style.display = 'flex';
        this.loadFriends();
    }

    loadFriends() {
        if (!this.game.authSystem?.token) {
            this.list.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Войдите в аккаунт</p>';
            return;
        }

        fetch('/api/friends', {
            headers: { 'Authorization': `Bearer ${this.game.authSystem.token}` }
        })
        .then(res => res.json())
        .then(friends => {
            if (friends.length === 0) {
                this.list.innerHTML = '<p style="text-align: center; color: var(--text-muted);">У вас пока нет друзей</p>';
                return;
            }

            this.list.innerHTML = friends.map(friend => `
                <div class="friend-item">
                    <div class="friend-info">
                        <div class="friend-name">${friend.username}</div>
                        <div class="friend-status ${friend.online ? 'online' : ''}">${friend.online ? 'В сети' : 'Не в сети'}</div>
                    </div>
                    <div class="friend-actions">
                        ${friend.online ? `<button class="btn-small challenge-btn" data-username="${friend.username}">Вызвать</button>` : ''}
                        <button class="btn-small remove-friend-btn" data-username="${friend.username}">Удалить</button>
                    </div>
                </div>
            `).join('');

            this.list.querySelectorAll('.challenge-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.game.onlineUsersManager.sendChallenge(btn.dataset.username);
                });
            });

            this.list.querySelectorAll('.remove-friend-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.removeFriend(btn.dataset.username);
                });
            });
        });
    }

    searchUser(query) {
        if (!query || query.length < 2) return;

        const onlineUsers = Array.from(this.game.onlineUsersManager.onlineUsers);
        const filtered = onlineUsers.filter(u => u.toLowerCase().includes(query.toLowerCase()));

        if (filtered.length > 0) {
            const existing = this.list.querySelector('.search-results');
            if (existing) existing.remove();

            const div = document.createElement('div');
            div.className = 'search-results';
            div.innerHTML = filtered.map(username => `
                <div class="friend-item">
                    <div class="friend-info">
                        <div class="friend-name">${username}</div>
                        <div class="friend-status online">В сети</div>
                    </div>
                    <div class="friend-actions">
                        <button class="btn-small add-friend-btn" data-username="${username}">Добавить</button>
                    </div>
                </div>
            `).join('');

            this.list.insertBefore(div, this.list.firstChild);

            div.querySelectorAll('.add-friend-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.addFriend(btn.dataset.username);
                });
            });
        }
    }

    addFriend(username) {
        if (!this.game.authSystem?.token) {
            alert('Войдите в аккаунт');
            return;
        }

        fetch('/api/friends/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.game.authSystem.token}`
            },
            body: JSON.stringify({ friendUsername: username })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`${username} добавлен в друзья`);
                this.loadFriends();
            } else {
                alert(data.error || 'Ошибка');
            }
        });
    }

    removeFriend(username) {
        if (!this.game.authSystem?.token) return;

        fetch('/api/friends/remove', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.game.authSystem.token}`
            },
            body: JSON.stringify({ friendUsername: username })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                this.loadFriends();
            }
        });
    }
}

class AuthSystem {
    constructor(game) {
        this.game = game;
        this.token = localStorage.getItem('ticTacToeToken');
        this.user = null;
        this.modal = document.getElementById('authModal');
        this.form = document.getElementById('authForm');
        this.errorDiv = document.getElementById('authError');
        this.userPanel = document.getElementById('userPanel');

        this.init();
    }

    init() {
        const tabs = document.querySelectorAll('.auth-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('authClose').addEventListener('click', () => this.closeModal());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('profileBtn').addEventListener('click', () => this.showProfile());
        document.getElementById('profileClose').addEventListener('click', () => this.hideProfile());
        document.getElementById('leaderboardClose').addEventListener('click', () => this.hideLeaderboard());

        if (this.token) {
            this.loadProfile();
        }

        const leaderboardBtn = document.createElement('button');
        leaderboardBtn.className = 'btn';
        leaderboardBtn.textContent = 'Таблица лидеров';
        leaderboardBtn.style.marginTop = '10px';
        leaderboardBtn.addEventListener('click', () => this.showLeaderboard());
        document.querySelector('.controls').appendChild(leaderboardBtn);
    }

    switchTab(tab) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.getElementById('authTitle').textContent = tab === 'login' ? 'Вход' : 'Регистрация';
        document.getElementById('authSubmit').textContent = tab === 'login' ? 'Войти' : 'Зарегистрироваться';
        this.errorDiv.textContent = '';
    }

    async handleSubmit(e) {
        e.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const isLogin = document.querySelector('.auth-tab.active').dataset.tab === 'login';

        usernameInput.classList.remove('error', 'blink');
        passwordInput.classList.remove('error', 'blink');
        void usernameInput.offsetWidth;

        try {
            const response = await fetch(isLogin ? '/api/login' : '/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                this.errorDiv.textContent = data.error || 'Ошибка';
                usernameInput.classList.add('error', 'blink');
                return;
            }

            if (data.token) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('ticTacToeToken', this.token);
                this.closeModal();
                this.updateUI();
            } else {
                this.errorDiv.textContent = data.message || 'Регистрация успешна! Теперь войдите.';
            }
        } catch (err) {
            this.errorDiv.textContent = 'Ошибка сети';
            usernameInput.classList.add('error', 'blink');
        }
    }

    async loadProfile() {
        try {
            const response = await fetch('/api/profile', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) {
                this.logout();
                return;
            }

            this.user = await response.json();
            this.updateUI();
        } catch (err) {
            console.error('Ошибка загрузки профиля:', err);
        }
    }

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('ticTacToeToken');
        this.updateUI();
    }

    updateUI() {
        const profileBtn = document.getElementById('profileBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        if (this.user) {
            this.modal.style.display = 'none';
            this.userPanel.style.display = 'flex';
            document.getElementById('userName').textContent = this.user.username;
            document.getElementById('userRating').textContent = `Рейтинг: ${this.user.rating}`;
            document.getElementById('userStats').innerHTML = `
                <span>Побед: ${this.user.wins}</span>
                <span>Поражений: ${this.user.losses}</span>
                <span>Ничьих: ${this.user.draws}</span>
            `;
            if (profileBtn) profileBtn.style.display = 'flex';
            if (logoutBtn) logoutBtn.style.display = 'flex';
            if (this.game.onlineUsersManager) {
                this.game.onlineUsersManager.setOnline(this.user.username);
            }
        } else {
            this.modal.style.display = 'flex';
            this.userPanel.style.display = 'none';
            if (profileBtn) profileBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    }

    closeModal() {
        this.modal.style.display = 'none';
    }

    showProfile() {
        const modal = document.getElementById('profileModal');
        modal.style.display = 'flex';

        const stats = document.getElementById('profileStats');
        stats.innerHTML = `
            <div class="profile-stat">
                <div class="stat-value">${this.user.rating}</div>
                <div class="stat-label">Рейтинг</div>
            </div>
            <div class="profile-stat">
                <div class="stat-value">${this.user.wins}</div>
                <div class="stat-label">Победы</div>
            </div>
            <div class="profile-stat">
                <div class="stat-value">${this.user.losses}</div>
                <div class="stat-label">Поражения</div>
            </div>
            <div class="profile-stat">
                <div class="stat-value">${this.user.draws}</div>
                <div class="stat-label">Ничьи</div>
            </div>
            <div class="profile-stat">
                <div class="stat-value">${this.user.streak}</div>
                <div class="stat-label">Серия побед</div>
            </div>
            <div class="profile-stat">
                <div class="stat-value">${this.user.maxStreak}</div>
                <div class="stat-label">Макс. серия</div>
            </div>
        `;

        const history = document.getElementById('profileHistory');
        if (this.user.history && this.user.history.length > 0) {
            history.innerHTML = '<h3>История игр</h3>' + this.user.history.map(h => `
                <div class="history-item">
                    <span class="history-result ${h.result}">${h.result === 'win' ? 'Победа' : h.result === 'loss' ? 'Поражение' : 'Ничья'}</span>
                    <span class="history-date">${new Date(h.date).toLocaleDateString('ru-RU')}</span>
                </div>
            `).join('');
        } else {
            history.innerHTML = '<p style="text-align: center; color: var(--text-muted);">История пуста</p>';
        }
    }

    hideProfile() {
        document.getElementById('profileModal').style.display = 'none';
    }

    async showLeaderboard() {
        const modal = document.getElementById('leaderboardModal');
        modal.style.display = 'flex';

        try {
            const response = await fetch('/api/leaderboard');
            const leaderboard = await response.json();

            const list = document.getElementById('leaderboardList');
            list.innerHTML = leaderboard.map((player, index) => `
                <div class="leaderboard-item ${player.username === this.user?.username ? 'current-user' : ''}">
                    <span class="leaderboard-rank">${index + 1}</span>
                    <div class="leaderboard-info">
                        <div class="leaderboard-name">${player.username}</div>
                        <div class="leaderboard-stats">${player.wins}В / ${player.losses}П / ${player.draws}Н</div>
                    </div>
                    <span class="leaderboard-rating">${player.rating}</span>
                </div>
            `).join('');
        } catch (err) {
            console.error('Ошибка загрузки таблицы лидеров:', err);
        }
    }

    hideLeaderboard() {
        document.getElementById('leaderboardModal').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const game = new TicTacToe();
    game.onlineGame = new OnlineGame(game);
    game.onlineGame.connect();

    game.ratingSystem = new RatingSystem();
    game.chatSystem = new ChatSystem(game.onlineGame.socket, game);
    game.authSystem = new AuthSystem(game);
    game.onlineUsersManager = new OnlineUsersManager(game.onlineGame.socket, game);
    game.friendsManager = new FriendsManager(game);

    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    const savedTheme = localStorage.getItem('ticTacToeTheme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        themeBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }

    themeBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ticTacToeTheme', next);
        themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
    });

    // Handle room ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    if (roomIdFromUrl) {
        setTimeout(() => {
            const onlineBtn = document.querySelector('[data-mode="online"]');
            if (onlineBtn) onlineBtn.click();
            setTimeout(() => {
                const input = document.getElementById('roomIdInput');
                if (input) {
                    input.value = roomIdFromUrl;
                    document.getElementById('joinRoomBtn').click();
                }
            }, 100);
        }, 500);
    }

    const modeToggle = document.querySelector('.mode-toggle');
    const onlineBtn = document.createElement('button');
    onlineBtn.className = 'btn-mode';
    onlineBtn.dataset.mode = 'online';
    onlineBtn.textContent = 'Онлайн';
    modeToggle.appendChild(onlineBtn);

    onlineBtn.addEventListener('click', () => {
        document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
        onlineBtn.classList.add('active');
        game.mode = 'online';
        game.onlineMode = true;

        const existing = document.getElementById('roomInput');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'roomInput';
        div.className = 'room-input';
        div.innerHTML = `
            <button class="btn" id="createRoomBtn">Создать комнату</button>
            <div class="join-row">
                <input type="text" id="roomIdInput" placeholder="Введите ID комнаты" maxlength="6">
                <button class="btn" id="joinRoomBtn">Войти</button>
            </div>
        `;
        document.querySelector('.container').insertBefore(div, document.querySelector('.scoreboard'));

        document.getElementById('createRoomBtn').addEventListener('click', () => {
            game.onlineGame.createRoom();
            div.remove();
        });

        document.getElementById('joinRoomBtn').addEventListener('click', () => {
            const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
            if (roomId) {
                game.onlineGame.joinRoom(roomId);
            }
        });
    });

    const originalHandleCellClick = game.handleCellClick.bind(game);
    game.handleCellClick = (e) => {
        e.preventDefault();
        const cell = e.target.closest('.cell');
        if (!cell || !game.gameActive || cell.classList.contains('taken')) return;

        if (game.mode === 'bot' && game.currentPlayer === 'O') return;

        if (game.mode === 'online') {
            const index = parseInt(cell.dataset.index);
            game.onlineGame.makeMove(index);
        } else {
            originalHandleCellClick(e);
        }
    };

    const originalResetGame = game.resetGame.bind(game);
    game.resetGame = () => {
        if (game.mode === 'online') {
            game.onlineGame.playAgain();
        } else {
            originalResetGame();
        }
    };
});
