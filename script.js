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
        this.statusDisplay.textContent = `Ход игрока ${this.currentPlayer}`;
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
        this.socket.emit('createRoom', (response) => {
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
        this.socket.emit('joinRoom', roomId, (response) => {
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
        this.ticTacToe.statusDisplay.textContent = this.isMyTurn
            ? `Ваш ход (${this.playerSymbol})`
            : `Ход противника (${symbol})`;
        this.ticTacToe.statusDisplay.className = `status ${symbol.toLowerCase()}-turn`;
    }

    showRoomId() {
        const roomDiv = document.getElementById('roomIdDisplay');
        if (roomDiv) roomDiv.remove();

        const div = document.createElement('div');
        div.id = 'roomIdDisplay';
        div.className = 'room-display';
        div.innerHTML = `
            <p>ID комнаты: <strong>${this.roomId}</strong></p>
            <p class="hint">Отправьте этот код другу</p>
            <button class="btn-small" onclick="navigator.clipboard.writeText('${this.roomId}')">Копировать</button>
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

document.addEventListener('DOMContentLoaded', () => {
    const game = new TicTacToe();
    game.onlineGame = new OnlineGame(game);
    game.onlineGame.connect();

    game.ratingSystem = new RatingSystem();
    game.chatSystem = new ChatSystem(game.onlineGame.socket, game);

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
