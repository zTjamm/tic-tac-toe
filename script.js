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

document.addEventListener('DOMContentLoaded', () => {
    new TicTacToe();
});
