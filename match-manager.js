/**
 * Связка движка матча с Socket.IO.
 *
 * Идентификатор игрока внутри матча - ник, а не socket.id: при обрыве связи
 * socket.id меняется, и матч перестал бы узнавать, кто вернулся.
 *
 * Страйки живут между матчами (userStrikes): три обрыва связи суммарно ->
 * в следующем матче следующий обрыв даёт автопроигрыш с рейтинговым
 * штрафом. Сбрасываются после матча, в котором игрок не нарушил ничего.
 * Пропуск хода по таймеру страйком НЕ считается: в партии сорок ходов
 * четвёртое «нарушение» наказало бы новичка за обычное размышление, и в
 * движке вместо этого рисуется случайная линия.
 */

const { Match, STRIKE_LIMIT } = require('./match');
const { botMove } = require('./bot');

const STRIKE_PUNISH_AT = STRIKE_LIMIT + 1; // 4-е нарушение = автопроигрыш
const BOT_THINK_MS = 700;
const CLEANUP_MS = 120000;

/** Рейтинг бота. Стоит 1000, как у новичка, поэтому игра с ботом
    не двигает рейтинг: иначе новичок разгонялся бы слишком быстро. */
const BOT_RATING = 1000;

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
        // roomId -> { winnerId: дельта, loserId: дельта }. Живёт до конца
        // матча в памяти, чтобы экран итогов объяснил изменение рейтинга
        this.ratingDeltas = new Map();
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
                // после внешнего действия клиента: смена хода происходит внутри
                // движка, и менеджер её не видит.
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

    /** Сколько нарушений накоплено. Показываем игроку, иначе наказание
        за четвёртое выглядит как произвол сервера. */
    strikesOf(username) {
        return this.strikes.get(username) || 0;
    }

    clearStrikes(username) {
        if (this.strikes.has(username)) {
            console.log(`[Match] страйки сброшены: ${username}`);
            this.strikes.delete(username);
        }
    }

    /* ------------------------------ действия ------------------------------ */

    move(roomId, username, edge) {
        const m = this.matches.get(roomId);
        if (!m) return;
        m.move(username, edge);
        this.maybeBotMove(m);
    }

    /* -------------------------------- бот -------------------------------- */

    botOf(match) {
        return match.players.find(p => p.isBot) || null;
    }

    // Ход бота с небольшой задержкой, чтобы выглядел естественно.
    maybeBotMove(match) {
        if (match.phase !== 'playing') return;
        const bot = this.botOf(match);
        if (!bot) return;
        if (bot.slot !== match.turnSlot) return;
        if (this.botTimers.has(match.roomId)) return;

        const timer = setTimeout(() => {
            this.botTimers.delete(match.roomId);
            if (match.phase !== 'playing') return;
            const botNow = this.botOf(match);
            if (!botNow || botNow.slot !== match.turnSlot) return;
            const edge = botMove(match.edges, match.boxOwner, botNow.slot);
            if (edge >= 0) match.move(botNow.id, edge);
        }, BOT_THINK_MS);
        this.botTimers.set(match.roomId, timer);
    }

    /* ------------------------------ состояние ------------------------------ */

    broadcast(roomId, snapshot, type, extra) {
        // Финал разбираем ДО рассылки: хук onResult пересчитывает рейтинг,
        // и клиенту нужны дельты в том же сообщении. Иначе экран итогов
        // показывал бы счёт, но не изменение рейтинга.
        if (type === 'finish') this.onFinish(roomId, snapshot);

        this.io.to(roomId).emit('match:state', {
            type: type || 'sync',
            extra: extra || null,
            snapshot: this.decorate(roomId, snapshot)
        });
    }

    /**
     * Дополняет снимок данными, которых нет в движке матча: рейтингом и
     * числом страйков. Рейтинг нужен, чтобы объяснить игроку, почему за
     * эту победу дали не два очка, а три; страйки - чтобы наказание за
     * четвёртое нарушение не выглядело капризом сервера.
     */
    decorate(roomId, snapshot) {
        if (!this.hooks.ratingOf) return snapshot;
        return {
            ...snapshot,
            players: snapshot.players.map(p => ({
                ...p,
                rating: p.isBot ? BOT_RATING : this.hooks.ratingOf(p.id),
                strikes: p.isBot ? 0 : (this.strikes.get(p.id) || 0)
            })),
            ratingDelta: this.ratingDeltas.get(roomId) || null
        };
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
            // Хук возвращает дельты, чтобы decorate() показал их игроку
            this.ratingDeltas.set(roomId, this.hooks.onResult(winner, loser, snapshot.result) || null);
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
        this.ratingDeltas.delete(roomId);
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

module.exports = { MatchManager, newRoomId, BOT_RATING };
