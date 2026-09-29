/**
 * Движок партии «Точки и квадраты».
 *
 * Правила (утверждены):
 *  - Сетка 5x5 точек, то есть 16 квадратов и 40 линий между точками.
 *    Партия длится около трёх минут: 40 ходов, на ход 15 секунд.
 *  - Игроки по очереди проводят линию между соседними точками.
 *  - Если ход закрывает хотя бы один квадрат, игрок забирает эти квадраты
 *    и ходит ещё раз (правило продолжения). Иначе ход переходит к сопернику.
 *  - Матч заканчивается, когда разобраны все 16 квадратов. Больше квадратов -
 *    победил.
 *  - Ролей нет: кто ходит первым, определяется случайно.
 *  - Таймаут хода - НЕ нарушение. В партии сорок ходов четвёртое «нарушение»
 *    наказало бы новичка за обычное размышление, поэтому сервер рисует за
 *    него случайную свободную линию. Нарушением считается только обрыв связи.
 *  - Обрыв связи: 15 секунд на возврат, потом соперник выигрывает матч.
 *    Четыре обрыва суммарно - автопроигрыш с рейтинговым штрафом.
 *
 * Движок не знает про сокеты: во все методы playerId приходит параметром.
 *
 * Геометрия. Точки нумеруются по строкам, квадраты - тоже. Линии двух типов,
 * и у каждой свой индекс в общем массиве edges:
 *   горизонтальная h(r,c) = r * SPAN + c          - 20 штук
 *   вертикальная   v(r,c) = H_COUNT + c * SPAN + r - 20 штук
 * У квадрата (r,c) стороны: верх h(r,c), низ h(r+1,c),
 * лево v(r,c), право v(r,c+1).
 */

const crypto = require('crypto');

const GRID = 5;                  // точек по стороне
const SPAN = GRID - 1;           // 4
const BOX_COUNT = SPAN * SPAN;   // 16 квадратов
const H_COUNT = GRID * SPAN;     // 20 горизонтальных линий
const EDGE_COUNT = H_COUNT * 2;  // 40 линий всего
const V_BASE = H_COUNT;          // с этого индекса начинаются вертикальные

// Тайминги заданы спецификацией, но их можно переопределить переменными
// окружения - удобно для локальной отладки и медленных каналов.
// T_START      - подготовка к матчу, чтобы игрок успел посмотреть на поле (3 с)
// T_TURN       - время на ход (15 с)
// T_RECONNECT  - ожидание переподключения (15 с)
const envMs = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

const START_MS = envMs('T_START', 3000);
const TURN_MS = envMs('T_TURN', 15000);
const RECONNECT_GRACE_MS = envMs('T_RECONNECT', 15000);

const STRIKE_LIMIT = 3;

/* ------------------------------ геометрия ------------------------------ */

const hIndex = (r, c) => r * SPAN + c;
const vIndex = (r, c) => V_BASE + c * SPAN + r;
const boxIndex = (r, c) => r * SPAN + c;

/** Четыре стороны квадрата в порядке: верх, низ, лево, право. */
const BOX_EDGES = [];
for (let r = 0; r < SPAN; r++) {
    for (let c = 0; c < SPAN; c++) {
        BOX_EDGES.push([hIndex(r, c), hIndex(r + 1, c), vIndex(r, c), vIndex(r, c + 1)]);
    }
}

/** Какие квадраты касаются каждой линии. Считается один раз при загрузке. */
const EDGE_BOXES = [];
for (let i = 0; i < EDGE_COUNT; i++) EDGE_BOXES.push([]);

for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < SPAN; c++) {
        const h = hIndex(r, c);
        if (r > 0) EDGE_BOXES[h].push(boxIndex(r - 1, c));
        if (r < SPAN) EDGE_BOXES[h].push(boxIndex(r, c));
    }
}
for (let c = 0; c < GRID; c++) {
    for (let r = 0; r < SPAN; r++) {
        const v = vIndex(r, c);
        if (c > 0) EDGE_BOXES[v].push(boxIndex(r, c - 1));
        if (c < SPAN) EDGE_BOXES[v].push(boxIndex(r, c));
    }
}

/** Сколько сторон квадрата уже проведено. */
function boxDrawnCount(edges, box) {
    let n = 0;
    for (const e of BOX_EDGES[box]) if (edges[e] !== -1) n++;
    return n;
}

/** Индекс единственной непроведённой стороны квадрата; -1, если их не одна. */
function missingEdge(edges, box) {
    let found = -1;
    for (const e of BOX_EDGES[box]) {
        if (edges[e] === -1) {
            if (found !== -1) return -1;
            found = e;
        }
    }
    return found;
}

const nowMs = () => Date.now();

class Match {
    constructor(roomId, players, hooks = {}) {
        this.roomId = roomId;
        this.hooks = hooks;

        // slot - это номер игрока в массиве players. В edges и boxOwner
        // хранятся именно слоты, а не ники: снимок уходит обоим участникам
        // и не должен зависеть от длинных строк
        this.players = players.map((p, i) => ({
            slot: i,
            id: p.id,
            username: p.username,
            isBot: !!p.isBot,
            score: 0,
            connected: true,
            violations: 0
        }));

        this.edges = new Array(EDGE_COUNT).fill(-1);
        this.boxOwner = new Array(BOX_COUNT).fill(-1);
        // Кто провёл третью сторону незабранного квадрата. По этому признаку
        // определяется, кому придётся отдавать цепочку, и подсвечивается
        // опасность на доске. При заборе квадрата обнуляется
        this.boxThreat = new Array(BOX_COUNT).fill(-1);

        // Ролей нет, поэтому первый ход - случайный. Иначе всегда выигрывает
        // тот, кто сидит в левом верхнем углу списка
        this.firstSlot = crypto.randomInt(this.players.length);
        this.turnSlot = this.firstSlot;
        this.phase = 'starting'; // starting | playing | finished
        this.startDeadline = nowMs() + START_MS;
        this.turnDeadline = null;
        this.movesLeft = EDGE_COUNT;
        this.result = null;
        this.lastClaimSlot = null;
        this.lastGainedBoxes = [];
        this.timer = null;

        this.emit('start');
        this.setTimer(START_MS, () => this.beginPlaying());
    }

    /* -------------------------------- ход -------------------------------- */

    beginPlaying() {
        this.phase = 'playing';
        this.turnDeadline = nowMs() + TURN_MS;
        this.emit('playBegin');
        this.setTimer(TURN_MS, () => this.onTurnTimeout(this.turnSlot));
    }

    move(playerId, edgeIndex, opts = {}) {
        if (this.phase !== 'playing') return false;
        const p = this.player(playerId);
        if (!p || p.slot !== this.turnSlot) return false;
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= EDGE_COUNT) return false;
        if (this.edges[edgeIndex] !== -1) return false;

        this.clearTimer();
        this.edges[edgeIndex] = p.slot;
        this.movesLeft--;

        const gained = this.updateBoxes(edgeIndex, p.slot);
        p.score += gained.length;
        if (gained.length > 0) this.lastClaimSlot = p.slot;
        // Какие именно квадраты закрыл этот ход: клиент мигает ими, и игрок
        // видит, куда ушло его очко
        this.lastGainedBoxes = gained;

        const extraTurn = gained.length > 0;
        const boxesLeft = this.boxesLeft();

        if (boxesLeft === 0) {
            this.lastMove = {
                edge: edgeIndex,
                playerId,
                gained: gained.length,
                extraTurn: true,
                auto: !!opts.auto
            };
            this.emit('move', this.lastMove);
            this.finishByBoxes();
            return true;
        }

        if (!extraTurn) this.turnSlot = 1 - p.slot;
        this.turnDeadline = nowMs() + TURN_MS;

        this.lastMove = {
            edge: edgeIndex,
            playerId,
            gained: gained.length,
            extraTurn,
            auto: !!opts.auto
        };
        this.emit('move', this.lastMove);
        this.setTimer(TURN_MS, () => this.onTurnTimeout(this.turnSlot));
        return true;
    }

    /**
     * Пересчитывает квадраты, которых коснулась только что проведённая линия.
     * Возвращает список квадратов, забранных этим ходом, - их ноль, один
     * или два (одна линия закрывает не больше двух квадратов).
     */
    updateBoxes(edgeIndex, slot) {
        const gained = [];
        for (const box of EDGE_BOXES[edgeIndex]) {
            if (this.boxOwner[box] !== -1) continue;
            const drawn = boxDrawnCount(this.edges, box);
            if (drawn === 4) {
                this.boxOwner[box] = slot;
                this.boxThreat[box] = -1;
                gained.push(box);
            } else if (drawn === 3) {
                this.boxThreat[box] = slot;
            } else {
                this.boxThreat[box] = -1;
            }
        }
        return gained;
    }

    boxesLeft() {
        let n = 0;
        for (const owner of this.boxOwner) if (owner === -1) n++;
        return n;
    }

    /* ------------------------------ финал ------------------------------ */

    /**
     * 16 квадратов делятся поровну 8:8, поэтому ничья в принципе возможна.
     * Разыгрывать её нечем, и реванш после 8:8 никому не нужен: побеждает
     * тот, кто забрал последний квадрат. Разрыв в счёте тогда не спасает -
     * здесь это осознанное правило, а не ошибка.
     */
    finishByBoxes() {
        const [a, b] = this.players;
        const tie = a.score === b.score;
        const winner = tie
            ? this.players[this.lastClaimSlot !== null ? this.lastClaimSlot : a.slot]
            : (a.score > b.score ? a : b);
        this.finish({
            type: 'finished',
            winnerId: winner.id,
            reason: tie ? 'tiebreak' : 'score'
        });
    }

    finish(result) {
        this.clearTimer();
        this.phase = 'finished';
        this.result = result;
        this.emit('finish');
    }

    /* ---------------------------- таймаут хода ---------------------------- */

    /**
     * Таймаут хода не наказывается страйком: партия короткая, ходов сорок,
     * и четвёртое «нарушение» наказало бы новичка за размышление. Вместо
     * этого сервер рисует за него случайную свободную линию, и партия
     * продолжается. Ограничение - чтобы бесконечный рандом не съел партию.
     */
    onTurnTimeout(slot) {
        if (this.phase !== 'playing' || this.turnSlot !== slot) return;
        const free = [];
        for (let i = 0; i < EDGE_COUNT; i++) if (this.edges[i] === -1) free.push(i);
        if (free.length === 0) return;
        const p = this.players[slot];
        this.move(p.id, free[crypto.randomInt(0, free.length)], { auto: true });
    }

    /* ------------------------------ нарушения ------------------------------ */

    onDisconnect(playerId) {
        if (this.phase === 'finished') return;
        const p = this.player(playerId);
        if (!p || !p.connected) return;

        p.connected = false;
        this.emit('disconnect');
        this.setTimer(RECONNECT_GRACE_MS, () => {
            if (!p.connected) this.resolveViolation(playerId);
        });
    }

    onReconnect(playerId) {
        const p = this.player(playerId);
        if (!p) return;
        p.connected = true;
        this.clearTimer();

        if (this.phase === 'playing') {
            // Возвратившемуся даём полный ход: остаток считать не от чего,
            // дедлайн мог истечь, пока связи не было
            this.turnDeadline = nowMs() + TURN_MS;
            this.setTimer(TURN_MS, () => this.onTurnTimeout(this.turnSlot));
        }
        this.emit('reconnect');
    }

    /**
     * Единственное наказуемое нарушение - обрыв связи, из которого игрок не
     * вернулся. Соперник выигрывает: он ничего не сделал неправильно, и
     * оставлять его на застывшей доске незачем.
     */
    resolveViolation(playerId) {
        const p = this.player(playerId);
        if (!p) return;
        if (this.hooks.onViolation) this.hooks.onViolation(p.username, 'disconnect');

        const other = this.players[1 - p.slot];
        const punished = this.hooks.shouldPunish && this.hooks.shouldPunish(p.username);
        this.finish({
            type: 'finished',
            winnerId: other ? other.id : null,
            reason: punished ? 'strike' : 'disconnect'
        });
    }

    /* ------------------------------ состояние ------------------------------ */

    player(id) {
        return this.players.find(p => p.id === id) || null;
    }

    playerBySlot(slot) {
        return this.players.find(p => p.slot === slot) || null;
    }

    otherId(playerId) {
        const p = this.player(playerId);
        return p ? this.players[1 - p.slot].id : null;
    }

    /**
     * Квадраты с тремя сторонами, принадлежащие игроку, которому сейчас ход.
     * Он обязан будет их отдать: остальные три линии уже проведены, и чтобы
     * квадрат не достался сопернику, ходить туда нельзя. Именно эти квадраты
     * подсвечиваются на доске - без подсветки цепочка не читается, и первые
     * партии играются вслепую.
     */
    dangerBoxes() {
        if (this.phase !== 'playing') return [];
        const out = [];
        for (let b = 0; b < BOX_COUNT; b++) {
            if (this.boxOwner[b] === -1 && this.boxThreat[b] === this.turnSlot) out.push(b);
        }
        return out;
    }

    snapshot() {
        const toMove = this.playerBySlot(this.turnSlot);
        const first = this.playerBySlot(this.firstSlot);
        return {
            roomId: this.roomId,
            phase: this.phase,
            grid: GRID,
            // -1 - линия не проведена, иначе номер слота игрока
            edges: this.edges.slice(),
            // -1 - квадрат не забран, иначе номер слота игрока
            boxOwner: this.boxOwner.slice(),
            turnId: toMove ? toMove.id : null,
            firstId: first ? first.id : null,
            startDeadline: this.phase === 'starting' ? this.startDeadline : null,
            turnDeadline: this.phase === 'playing' ? this.turnDeadline : null,
            // Дедлайны считаются по часам сервера. Часы игрока могут отличаться
            // на любую величину, поэтому отдаём и текущий момент серверного
            // времени: клиент по нему узнаёт свою поправку.
            serverNow: nowMs(),
            result: this.result,
            totalBoxes: BOX_COUNT,
            totalEdges: EDGE_COUNT,
            boxesLeft: this.boxesLeft(),
            movesLeft: this.movesLeft,
            danger: this.dangerBoxes(),
            lastGainedBoxes: this.lastGainedBoxes,
            players: this.players.map(p => ({
                id: p.id,
                slot: p.slot,
                username: p.username,
                score: p.score,
                isBot: p.isBot,
                connected: p.connected,
                rating: 0,   // проставляется менеджером
                strikes: 0   // проставляется менеджером
            })),
            timing: {
                start: START_MS,
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
    GRID,
    SPAN,
    BOX_COUNT,
    EDGE_COUNT,
    H_COUNT,
    BOX_EDGES,
    EDGE_BOXES,
    hIndex,
    vIndex,
    boxIndex,
    boxDrawnCount,
    missingEdge,
    STRIKE_LIMIT,
    START_MS,
    TURN_MS,
    RECONNECT_GRACE_MS
};
