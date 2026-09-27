/**
 * Движок матча «до 5 очков».
 *
 * Правила (утверждены):
 *  - Атакующий всегда ходит первым и играет X, защитник — O.
 *  - Исход раунда: атакующий выиграл -> атакующий +2;
 *    защитник выиграл -> защитник +3; ничья -> защитник +1.
 *  - Матч идёт до 5 очков, максимум 9 раундов.
 *  - Раунд 1 и раунд 9 начинаются с угадайки: оба выбирают число на доске,
 *    система открывает случайное 1..9, кто угадал или ближе - выбирает,
 *    атаковать ему или защищаться.
 *  - Тайминги: 5 с отсчёт, 10 с на выбор числа, 15 с на ход.
 *  - Нарушение (таймаут хода или обрыв связи) в раунде 1 -> отмена матча.
 *    В раунде 2+ -> побеждает ожидающий, но только если он строго лидирует,
 *    иначе отмена.
 *  - Страйки общие на оба типа нарушений и живут между матчами:
 *    3 нарушения суммарно -> в следующем матче первое нарушение = автопроигрыш
 *    с рейтинговым штрафом как за поражение. Сбрасываются после матча без
 *    единого нарушения.
 *
 * Движок не знает про сокеты: во все методы playerId приходит параметром.
 */

const crypto = require('crypto');

const TARGET_SCORE = 5;
const MAX_ROUNDS = 9;

// Тайминги заданы спецификацией, но их можно переопределить переменными
// окружения - удобно для локальной отладки и медленных каналов.
// T_GUESS_COUNTDOWN - отсчёт перед выбором числа (5 с)
// T_GUESS_PICK       - время на выбор числа (10 с)
// T_GUESS_ROLE       - время на выбор роли (15 с)
// T_TURN             - время на ход (15 с)
// T_RECONNECT        - ожидание переподключения (15 с)
const envMs = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

const GUESS_COUNTDOWN_MS = envMs('T_GUESS_COUNTDOWN', 5000);
const GUESS_PICK_MS = envMs('T_GUESS_PICK', 10000);
const GUESS_ROLE_MS = envMs('T_GUESS_ROLE', 15000);
const TURN_MS = envMs('T_TURN', 15000);
const RECONNECT_GRACE_MS = envMs('T_RECONNECT', 15000);

const STRIKE_LIMIT = 3;

const WIN_PATTERNS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

// Числа на доске: 1..9 слева направо, сверху вниз. Фиксированы, чтобы позиции
// можно было запомнить, а не искать глазами в каждой угадайке.
const CELL_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const nowMs = () => Date.now();

function checkWin(board, mark) {
    for (const pattern of WIN_PATTERNS) {
        const [a, b, c] = pattern;
        if (board[a] === mark && board[b] === mark && board[c] === mark) return pattern;
    }
    return null;
}

class Match {
    constructor(roomId, players, hooks = {}) {
        this.roomId = roomId;
        this.hooks = hooks;

        this.players = players.map((p, i) => ({
            id: p.id,
            username: p.username,
            isBot: !!p.isBot,
            mark: i === 0 ? 'X' : 'O',
            score: 0,
            connected: true,
            violations: 0
        }));

        this.round = 1;
        this.phase = 'guessing'; // guessing | roleChoice | playing | finished
        this.guessSub = 'countdown'; // countdown | picking | reveal
        this.board = Array(9).fill('');
        this.currentMark = null;
        this.attackerId = null;
        this.turnDeadline = null;
        this.deadline = null;
        this.timer = null;

        this.picks = new Map(); // playerId -> cellIndex
        this.takenCells = new Set(); // занятые клетки в угадайке
        this.systemNumber = null;
        this.guessWinnerId = null;
        this.result = null;

        this.startGuessing();
    }

    /* ------------------------------ угадайка ------------------------------ */

    startGuessing() {
        this.clearTimer();
        this.phase = 'guessing';
        this.guessSub = 'countdown';
        // Доска очищается сразу: в угадайке клетки показывают числа,
        // старые крестики из прошлого раунда не должны просачиваться в снимок
        this.board = Array(9).fill('');
        this.currentMark = null;
        this.picks = new Map();
        this.takenCells = new Set();
        this.systemNumber = null;
        this.guessWinnerId = null;
        this.deadline = nowMs() + GUESS_COUNTDOWN_MS;
        this.emit('guessStart');
        this.setTimer(GUESS_COUNTDOWN_MS, () => this.openPicking());
    }

    openPicking() {
        if (this.phase !== 'guessing') return;
        this.guessSub = 'picking';
        this.deadline = nowMs() + GUESS_PICK_MS;

        // Бот выбирает мгновенно, чтобы человек не ждал
        const bot = this.players.find(p => p.isBot);
        if (bot) this.applyPick(bot.id, this.randomFreeCell());

        this.emit('guessOpen');

        if (this.picks.size >= this.players.length) {
            this.clearTimer();
            this.revealNumber();
            return;
        }
        this.setTimer(GUESS_PICK_MS, () => this.onGuessTimeout());
    }

    randomFreeCell() {
        const free = [];
        for (let i = 0; i < 9; i++) if (!this.takenCells.has(i)) free.push(i);
        if (free.length === 0) return 0;
        return free[crypto.randomInt(0, free.length)];
    }

    applyPick(playerId, cellIndex) {
        if (this.phase !== 'guessing' || this.guessSub !== 'picking') return false;
        if (!this.players.some(p => p.id === playerId)) return false;
        if (this.picks.has(playerId)) return false; // перевыбор запрещён
        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) return false;
        if (this.takenCells.has(cellIndex)) return false; // клетка уже занята соперником
        this.picks.set(playerId, cellIndex);
        this.takenCells.add(cellIndex);
        return true;
    }

    pickCell(playerId, cellIndex) {
        if (!this.applyPick(playerId, cellIndex)) return;
        this.emit('guessPick');
        if (this.picks.size >= this.players.length) {
            this.clearTimer();
            this.revealNumber();
        }
    }

    onGuessTimeout() {
        if (this.phase !== 'guessing' || this.guessSub !== 'picking') return;
        // Не выбрал число за 10 секунд -> отмена матча
        this.finish({ type: 'cancelled', reason: 'guess-timeout' });
    }

    revealNumber() {
        if (this.phase !== 'guessing') return;
        this.guessSub = 'reveal';

        const target = crypto.randomInt(1, 10);
        this.systemNumber = target;

        const ranked = this.players
            .map(p => {
                const cell = this.picks.get(p.id);
                const guess = cell === undefined ? null : CELL_NUMBERS[cell];
                return {
                    id: p.id,
                    guess,
                    distance: guess === null ? Infinity : Math.abs(guess - target)
                };
            })
            .sort((a, b) => a.distance - b.distance);

        const [first, second] = ranked;

        if (!first || !second || first.distance === second.distance) {
            // Оба угадали или равно близко -> открываем новое число
            this.guessWinnerId = null;
            this.emit('guessReveal');
            this.setTimer(2500, () => this.revealNumber());
            return;
        }

        this.guessWinnerId = first.id;
        this.phase = 'roleChoice';
        this.deadline = nowMs() + GUESS_ROLE_MS;
        this.emit('guessReveal');
        this.setTimer(GUESS_ROLE_MS, () => this.chooseRole(this.guessWinnerId, false));
    }

    // Победитель угадайки выбирает роль. По умолчанию (таймаут) - защита.
    chooseRole(playerId, wantsToAttack) {
        if (this.phase !== 'roleChoice') return;
        if (playerId !== this.guessWinnerId) return;
        const attackerId = wantsToAttack ? playerId : this.otherId(playerId);
        this.beginRound(attackerId);
    }

    otherId(playerId) {
        return playerId === this.players[0].id ? this.players[1].id : this.players[0].id;
    }

    /* -------------------------------- раунд -------------------------------- */

    beginRound(attackerId) {
        this.clearTimer();
        this.attackerId = attackerId;
        const attacker = this.player(attackerId);
        const defender = this.player(this.otherId(attackerId));

        // Атакующий играет X, защитник O
        attacker.mark = 'X';
        defender.mark = 'O';

        this.board = Array(9).fill('');
        this.currentMark = 'X';
        this.phase = 'playing';
        this.turnDeadline = nowMs() + TURN_MS;
        this.emit('roundStart');
        this.setTimer(TURN_MS, () => this.onTurnTimeout(attackerId));
    }

    move(playerId, cellIndex) {
        if (this.phase !== 'playing') return;
        const p = this.player(playerId);
        if (!p || p.mark !== this.currentMark) return;
        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) return;
        if (this.board[cellIndex] !== '') return;

        this.clearTimer();
        this.board[cellIndex] = p.mark;

        const pattern = checkWin(this.board, p.mark);
        const full = this.board.every(c => c !== '');

        if (!pattern && !full) {
            this.currentMark = this.currentMark === 'X' ? 'O' : 'X';
            this.turnDeadline = nowMs() + TURN_MS;
            this.emit('move');
            this.setTimer(TURN_MS, () => this.onTurnTimeout(this.idOfMark(this.currentMark)));
            return;
        }

        this.finishRound({ winnerId: pattern ? p.id : null, winPattern: pattern });
    }

    finishRound({ winnerId, winPattern }) {
        this.clearTimer();
        const attacker = this.player(this.attackerId);
        const defender = this.player(this.otherId(this.attackerId));

        let gainA = 0;
        let gainD = 0;
        let outcome;
        if (winnerId === attacker.id) {
            gainA = 2; outcome = 'attacker';
        } else if (winnerId === defender.id) {
            gainD = 3; outcome = 'defender';
        } else {
            gainD = 1; outcome = 'draw';
        }

        attacker.score += gainA;
        defender.score += gainD;

        this.emit('roundEnd', { outcome, gainA, gainD, winPattern });

        if (attacker.score >= TARGET_SCORE || defender.score >= TARGET_SCORE) {
            this.finish({
                type: 'finished',
                winnerId: attacker.score >= defender.score ? attacker.id : defender.id,
                reason: 'score'
            });
            return;
        }

        this.round += 1;
        if (this.round > MAX_ROUNDS) {
            this.finish({
                type: 'finished',
                winnerId: attacker.score >= defender.score ? attacker.id : defender.id,
                reason: 'score'
            });
            return;
        }

        // Раунд 9 начинается с угадайки, в остальных роли просто меняются
        if (this.round === 9) this.startGuessing();
        else this.beginRound(this.otherId(this.attackerId));
    }

    /* ------------------------------ нарушения ------------------------------ */

    onTurnTimeout(playerId) {
        if (this.phase !== 'playing') return;
        this.resolveViolation(playerId, 'timeout');
    }

    resolveViolation(playerId, kind) {
        const p = this.player(playerId);
        if (!p) return;

        // Бот управляется сервером и ходит вовремя: страйки ему не положены
        if (!p.isBot) {
            p.violations++;
            if (this.hooks.onViolation) {
                this.hooks.onViolation(p.username, p.violations, kind);
            }
        }

        // Страйки исчерпаны -> автопроигрыш с рейтинговым штрафом
        if (this.hooks.shouldPunish && this.hooks.shouldPunish(p.username)) {
            this.finish({ type: 'finished', winnerId: this.otherId(playerId), reason: 'strike' });
            return;
        }

        const opponent = this.player(this.otherId(playerId));
        const strictLead = opponent.score > p.score;

        if (this.round === 1 || !strictLead) {
            this.finish({ type: 'cancelled', reason: kind });
            return;
        }
        this.finish({ type: 'finished', winnerId: opponent.id, reason: kind });
    }

    onDisconnect(playerId) {
        if (this.phase === 'finished') return;
        const p = this.player(playerId);
        if (!p || !p.connected) return;

        p.connected = false;
        this.emit('disconnect');
        this.setTimer(RECONNECT_GRACE_MS, () => {
            if (!p.connected) this.resolveViolation(playerId, 'disconnect');
        });
    }

    onReconnect(playerId) {
        const p = this.player(playerId);
        if (!p) return;
        p.connected = true;
        this.clearTimer();

        if (this.phase === 'playing') {
            // После переподключения даём остаток времени на ход
            const rest = this.turnDeadline && this.turnDeadline > nowMs()
                ? this.turnDeadline - nowMs()
                : TURN_MS;
            this.turnDeadline = nowMs() + rest;
            this.setTimer(rest, () => this.onTurnTimeout(this.idOfMark(this.currentMark)));
        }
        this.emit('reconnect');
    }

    /* -------------------------------- финал -------------------------------- */

    finish(result) {
        this.clearTimer();
        this.phase = 'finished';
        this.result = result;
        this.emit('finish');
    }

    /* ------------------------------ состояние ------------------------------ */

    player(id) {
        return this.players.find(p => p.id === id) || null;
    }

    idOfMark(mark) {
        const p = this.players.find(x => x.mark === mark);
        return p ? p.id : null;
    }

    snapshot() {
        return {
            roomId: this.roomId,
            phase: this.phase,
            round: this.round,
            maxRounds: MAX_ROUNDS,
            targetScore: TARGET_SCORE,
            board: this.board,
            currentMark: this.currentMark,
            attackerId: this.attackerId,
            turnDeadline: this.turnDeadline,
            deadline: this.deadline,
            result: this.result,
            cellNumbers: CELL_NUMBERS,
            players: this.players.map(p => ({
                id: p.id,
                username: p.username,
                mark: p.mark,
                score: p.score,
                isBot: p.isBot,
                connected: p.connected,
                pick: this.picks.has(p.id) ? this.picks.get(p.id) : null,
                isAttacker: p.id === this.attackerId,
                isGuessWinner: p.id === this.guessWinnerId
            })),
            guessing: this.phase === 'guessing' || this.phase === 'roleChoice'
                ? {
                    sub: this.guessSub,
                    systemNumber: this.systemNumber,
                    winnerId: this.guessWinnerId,
                    deadline: this.deadline
                }
                : null,
            timing: {
                guessCountdown: GUESS_COUNTDOWN_MS,
                guessPick: GUESS_PICK_MS,
                guessRole: GUESS_ROLE_MS,
                turn: TURN_MS
            }
        };
    }

    setTimer(ms, fn) {
        this.clearTimer();
        this.timer = setTimeout(fn, ms);
    }

    clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    emit(type, extra) {
        if (this.hooks.onState) this.hooks.onState(this.roomId, this.snapshot(), type, extra);
    }
}

module.exports = {
    Match,
    TARGET_SCORE,
    MAX_ROUNDS,
    STRIKE_LIMIT,
    WIN_PATTERNS,
    CELL_NUMBERS,
    TURN_MS,
    GUESS_COUNTDOWN_MS,
    GUESS_PICK_MS,
    GUESS_ROLE_MS,
    RECONNECT_GRACE_MS
};
