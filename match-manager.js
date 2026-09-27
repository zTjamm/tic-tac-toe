/**
 * Связка движка матча с Socket.IO.
 *
 * Идентификатор игрока внутри матча - ник, а не socket.id: при обрыве связи
 * socket.id меняется, и матч перестал бы узнавать, кто вернулся.
 *
 * Страйки живут между матчами (userStrikes): три нарушения суммарно
 * (таймаут хода + обрыв связи) -> в следующем матче первое нарушение
 * даёт автопроигрыш с рейтинговым штрафом. Сбрасываются после матча,
 * в котором игрок не нарушил ничего.
 */

const { Match, STRIKE_LIMIT } = require('./match');
const { botMove } = require('./bot');

const STRIKE_PUNISH_AT = STRIKE_LIMIT + 1; // 4-е нарушение = автопроигрыш
const BOT_THINK_MS = 700;
const CLEANUP_MS = 120000;

function newRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

class MatchManager {
    constructor(io, hooks = {}) {
        this.io = io;
        this.hooks = hooks;
        this.matches = new Map();     // roomId -> Match
        this.byPlayer = new Map();    // username -> roomId (только идущий матч)
        // username -> roomId последнего завершённого матча. Нужен для реванша:
        // после финала игрок свободен (его можно вызвать заново), но комната
        // предыдущего матча ещё помнит счёт
        this.finishedByPlayer = new Map();
        this.strikes = new Map();     // username -> number of violations
        this.botTimers = new Map();   // roomId -> timeout
    }

    /* ------------------------------ создание ------------------------------ */

    createBotMatch(username) {
        const roomId = newRoomId();
        const match = this.instantiate(roomId, [
            { id: username, username, isBot: false },
            { id: '__bot__', username: 'Бот', isBot: true }
        ]);
        return { roomId, match };
    }

    createHumanMatch(usernameA, usernameB) {
        const roomId = newRoomId();
        const match = this.instantiate(roomId, [
            { id: usernameA, username: usernameA, isBot: false },
            { id: usernameB, username: usernameB, isBot: false }
        ]);
        return { roomId, match };
    }

    instantiate(roomId, players) {
        const match = new Match(roomId, players, {
            onState: (rid, snapshot, type, extra) => {
                this.broadcast(rid, snapshot, type, extra);
                // Бота нужно двигать при ЛЮБОМ изменении состояния, а не только
                // после внешнего действия клиента: переходы между раундами 2..8
                // происходят внутри движка и менеджер их не видит.
                const live = this.matches.get(rid);
                if (live) this.maybeBotMove(live);
            },
            onViolation: (username) => this.registerViolation(username),
            shouldPunish: (username) => this.shouldPunish(username)
        });
        this.matches.set(roomId, match);
        for (const p of players) {
            this.byPlayer.set(p.id, roomId);
            // новый матч вытесняет предыдущий завершённый
            this.finishedByPlayer.delete(p.id);
        }
        return match;
    }

    /* ------------------------------ нарушения ------------------------------ */

    registerViolation(username) {
        const next = (this.strikes.get(username) || 0) + 1;
        this.strikes.set(username, next);
        console.log(`[Match] нарушение ${username}: страйков ${next}`);
    }

    shouldPunish(username) {
        return (this.strikes.get(username) || 0) >= STRIKE_PUNISH_AT;
    }

    clearStrikes(username) {
        if (this.strikes.has(username)) {
            console.log(`[Match] страйки сброшены: ${username}`);
            this.strikes.delete(username);
        }
    }

    /* ------------------------------ действия ------------------------------ */

    pick(roomId, username, cell) {
        const m = this.matches.get(roomId);
        if (!m) return;
        m.pickCell(username, cell);
        this.maybeBotGuess(m);
    }

    chooseRole(roomId, username, attack) {
        const m = this.matches.get(roomId);
        if (!m) return;
        m.chooseRole(username, !!attack);
        this.maybeBotMove(m);
    }

    move(roomId, username, cell) {
        const m = this.matches.get(roomId);
        if (!m) return;
        m.move(username, cell);
        this.maybeBotMove(m);
    }

    /* -------------------------------- бот -------------------------------- */

    botOf(match) {
        return match.players.find(p => p.isBot) || null;
    }

    // Бот выбирает число мгновенно, чтобы человек не ждал.
    maybeBotGuess(match) {
        if (match.phase !== 'guessing' || match.guessSub !== 'picking') return;
        const bot = this.botOf(match);
        if (!bot || match.picks.has(bot.id)) return;
        match.pickCell(bot.id, match.randomFreeCell());
    }

    // Ход бота с небольшой задержкой, чтобы выглядел естественно.
    maybeBotMove(match) {
        if (match.phase !== 'playing') return;
        const bot = this.botOf(match);
        if (!bot) return;
        if (bot.mark !== match.currentMark) return;
        if (this.botTimers.has(match.roomId)) return;

        const timer = setTimeout(() => {
            this.botTimers.delete(match.roomId);
            if (match.phase !== 'playing') return;
            if (bot.mark !== match.currentMark) return;
            const cell = botMove(match.board, bot.mark);
            if (cell >= 0) match.move(bot.id, cell);
        }, BOT_THINK_MS);
        this.botTimers.set(match.roomId, timer);
    }

    /* ------------------------------ состояние ------------------------------ */

    broadcast(roomId, snapshot, type, extra) {
        this.io.to(roomId).emit('match:state', {
            type: type || 'sync',
            extra: extra || null,
            snapshot
        });
        if (type === 'finish') this.onFinish(roomId, snapshot);
    }

    onFinish(roomId, snapshot) {
        const match = this.matches.get(roomId);
        if (!match) return;

        const players = match.players;
        const hadViolation = players.some(p => p.violations > 0);

        for (const p of players) {
            if (p.isBot) continue;
            if (!hadViolation) this.clearStrikes(p.id);
        }

        if (snapshot.result && snapshot.result.type === 'finished' && this.hooks.onResult) {
            const winner = players.find(p => p.id === snapshot.result.winnerId);
            const loser = players.find(p => p.id !== snapshot.result.winnerId);
            this.hooks.onResult(winner, loser, snapshot.result);
        }

        // Любой финал (в том числе отмена) освобождает игроков: список онлайна
        // не должен показывать их занятыми, иначе их нельзя вызвать на игру.
        // Матч при этом остаётся в памяти - из него делается реванш
        for (const p of players) {
            if (p.isBot) continue;
            this.byPlayer.delete(p.id);
            this.finishedByPlayer.set(p.id, roomId);
        }

        if (this.hooks.onFinish) this.hooks.onFinish(roomId, snapshot);

        const timer = setTimeout(() => this.dispose(roomId), CLEANUP_MS);
        if (timer.unref) timer.unref();
    }

    dispose(roomId) {
        const match = this.matches.get(roomId);
        if (!match) return;
        for (const p of match.players) {
            this.byPlayer.delete(p.id);
            this.finishedByPlayer.delete(p.id);
        }
        this.matches.delete(roomId);
        const t = this.botTimers.get(roomId);
        if (t) clearTimeout(t);
        this.botTimers.delete(roomId);
        console.log(`[Match] матч ${roomId} удалён`);
    }

    /* ------------------------------ обрывы ------------------------------ */

    handleDisconnect(username) {
        const roomId = this.byPlayer.get(username);
        if (!roomId) return;
        const m = this.matches.get(roomId);
        if (m) m.onDisconnect(username);
    }

    handleReconnect(username) {
        const roomId = this.byPlayer.get(username);
        if (!roomId) return;
        const m = this.matches.get(roomId);
        if (m) m.onReconnect(username);
    }

    /** Комната идущего матча. null, если игрок свободен (в т.ч. после финала). */
    roomOf(username) {
        return this.byPlayer.get(username) || null;
    }

    /** Комната последнего завершённого матча - нужна для реванша. */
    finishedRoomOf(username) {
        const roomId = this.finishedByPlayer.get(username);
        if (!roomId) return null;
        // матч мог быть уже убран по таймеру - тогда реванш невозможен
        return this.matches.has(roomId) ? roomId : null;
    }

    snapshotOf(roomId) {
        const m = this.matches.get(roomId);
        return m ? m.snapshot() : null;
    }
}

module.exports = { MatchManager, newRoomId };
