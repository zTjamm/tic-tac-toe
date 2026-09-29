/**
 * Бот для «Точек и квадратов».
 *
 * Работает на сервере и видит ровно то же, что и человек: массивы линий и
 * забранных квадратов. Правила игры выводятся из них, отдельно не передаются.
 *
 * Стратегия - это учебная схема «точек и квадратов», а не перебор ходов:
 *   1. Забрать квадрат, если это возможно. Всегда выгодно: очко и лишний ход.
 *   2. Если безопасного хода нет - отдать самую короткую цепочку. Именно
 *      этот выбор отличает игрока от новичка, поэтому бот обязан его уметь:
 *      иначе новичок проигрывает, не поняв ни одной идеи игры.
 *   3. Случайность в оценке, чтобы бот не был предсказуем на равных ходах.
 *
 * Оптимального бота сознательно нет: он выигрывает у новичка в первые
 * секунды, и игра перестаёт быть интересной.
 */

const { EDGE_COUNT, EDGE_BOXES, boxDrawnCount } = require('./match');

/** Случайный элемент массива. */
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/** Линии, по которым ещё никто не ходил. */
function freeEdges(edges) {
    const out = [];
    for (let i = 0; i < EDGE_COUNT; i++) if (edges[i] === -1) out.push(i);
    return out;
}

/**
 * Закроет ли эта линия какой-нибудь квадрат? Квадрат считается закрытым,
 * когда проведены три его стороны, а четвёртая - как раз эта линия.
 */
function closesBox(edges, edge) {
    for (const box of EDGE_BOXES[edge]) {
        if (boxDrawnCount(edges, box) === 3) return true;
    }
    return false;
}

function cloneState(edges, boxOwner) {
    return { edges: edges.slice(), boxOwner: boxOwner.slice() };
}

function applyMove(state, edge, slot) {
    state.edges[edge] = slot;
    for (const box of EDGE_BOXES[edge]) {
        if (boxDrawnCount(state.edges, box) === 4) state.boxOwner[box] = slot;
    }
}

/** Сколько квадратов заберет игрок, если проведёт эту линию. */
function boxesGained(edges, boxOwner, edge, slot) {
    let n = 0;
    for (const box of EDGE_BOXES[edge]) {
        if (boxOwner[box] === -1 && boxDrawnCount(edges, box) === 3) n++;
    }
    return n;
}

/**
 * Сколько квадратов соперник заберёт подряд, если сейчас открыть цепочку.
 *
 * Соперник закрывает любой доступный квадрат и ходит снова, поэтому цепочка
 * длины N - это ровно N квадратов, забранных подряд. Считаем жадно: берём
 * любой доступный и смотрим, что откроется дальше. Точная длина цепочки для
 * выбора хода не нужна, важно лишь не отдать больше, чем необходимо.
 */
function chainLength(edges, boxOwner, edge, slot) {
    const state = cloneState(edges, boxOwner);
    applyMove(state, edge, slot);

    const foe = 1 - slot;
    let taken = 0;
    let guard = EDGE_COUNT + 2;

    while (guard-- > 0) {
        const closing = freeEdges(state.edges).filter(e => closesBox(state.edges, e));
        if (closing.length === 0) break;
        applyMove(state, pick(closing), foe);
        taken++;
    }
    return taken;
}

/**
 * Оценка хода: меньше - лучше.
 *   -1000  ход забирает квадрат
 *   -N     ход отдаёт сопернику цепочку длины N
 *   0      безопасный ход: цепочки не возникает
 */
function score(edges, boxOwner, edge, slot) {
    if (boxesGained(edges, boxOwner, edge, slot) > 0) return -1000;

    const length = chainLength(edges, boxOwner, edge, slot);
    return length + Math.random() * 0.5;
}

/**
 * Выбор хода бота.
 * @param {number[]} edges    -1 или номер слота игрока
 * @param {number[]} boxOwner -1 или номер слота игрока
 * @param {number} slot       - слот бота
 * @returns {number} индекс линии или -1, если ходить некуда
 */
function botMove(edges, boxOwner, slot) {
    const free = freeEdges(edges);
    if (free.length === 0) return -1;

    let bestEdge = free[0];
    let bestScore = Infinity;
    for (const edge of free) {
        const s = score(edges, boxOwner, edge, slot);
        if (s < bestScore) {
            bestScore = s;
            bestEdge = edge;
        }
    }
    return bestEdge;
}

module.exports = { botMove };
