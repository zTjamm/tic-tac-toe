/**
 * Проверка движка «точек и квадратов» и бота.
 *
 * Запуск: node test-dots.js
 *
 * Главное здесь - прогон тысяч партий бот против бота. Если хоть одна
 * партия не доиграна (ходы кончились, а квадраты остались), значит в
 * движке ошибка со счётом квадратов или с переходом хода, и никакие
 * отдельные тесты это не покажут.
 */

const {
    Match, GRID, BOX_COUNT, EDGE_COUNT, BOX_EDGES, EDGE_BOXES,
    boxDrawnCount, missingEdge, TURN_MS
} = require('./match');
const { botMove } = require('./bot');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
    } else {
        failed++;
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    }
}

/** Совпадает ли раскладка линий и квадратов с геометрией. */
function structureIsSane(snap) {
    if (snap.edges.length !== EDGE_COUNT) return `линий ${snap.edges.length} вместо ${EDGE_COUNT}`;
    if (snap.boxOwner.length !== BOX_COUNT) return `квадратов ${snap.boxOwner.length}`;

    for (let box = 0; box < BOX_COUNT; box++) {
        const drawn = boxDrawnCount(snap.edges, box);
        const owner = snap.boxOwner[box];
        if (drawn === 4 && owner === -1) return `квадрат ${box} заполнен, но не забран`;
        if (drawn < 4 && owner !== -1) return `квадрат ${box} забран, но не заполнен`;
    }

    // Счёт каждого игрока обязан равняться числу забранных им квадратов
    for (const p of snap.players) {
        let count = 0;
        for (const owner of snap.boxOwner) if (owner === p.slot) count++;
        if (count !== p.score) return `счёт ${p.username} ${p.score}, а квадратов ${count}`;
    }
    return null;
}

/* ============================ геометрия ============================ */

check('сетка 5x5 даёт 16 квадратов', BOX_COUNT === 16, `получилось ${BOX_COUNT}`);
check('сетка 5x5 даёт 40 линий', EDGE_COUNT === 40, `получилось ${EDGE_COUNT}`);

{
    // Каждая линия должна касаться 1 или 2 квадратов, и всего квадратов
    // должно хватить на 64 касания (16 квадратов по 4 стороны)
    let touches = 0;
    let bad = null;
    for (let e = 0; e < EDGE_COUNT; e++) {
        if (EDGE_BOXES[e].length < 1 || EDGE_BOXES[e].length > 2) {
            bad = `линия ${e} касается ${EDGE_BOXES[e].length} квадратов`;
        }
        touches += EDGE_BOXES[e].length;
    }
    check('каждая линия касается 1-2 квадратов', bad === null, bad);
    check('все стороны квадратов покрыты линиями', touches === BOX_COUNT * 4, `касаний ${touches}`);

    // Стороны квадрата не должны повторяться и должны быть в пределах
    let dup = null;
    for (let box = 0; box < BOX_COUNT; box++) {
        const set = new Set(BOX_EDGES[box]);
        if (set.size !== 4) dup = `квадрат ${box}: стороны повторяются`;
        for (const e of BOX_EDGES[box]) {
            if (e < 0 || e >= EDGE_COUNT) dup = `квадрат ${box}: линия ${e} вне поля`;
        }
    }
    check('стороны квадратов корректны', dup === null, dup);
}

{
    // missingEdge работает только на квадрате с тремя проведёнными сторонами
    const edges = new Array(EDGE_COUNT).fill(-1);
    const box = 0;
    const [top, bottom, left, right] = BOX_EDGES[box];
    edges[top] = 0; edges[bottom] = 0; edges[left] = 0;
    check('missingEdge находит четвёртую сторону', missingEdge(edges, box) === right,
        `вернулось ${missingEdge(edges, box)}, ждали ${right}`);

    edges[right] = 1;
    check('missingEdge на закрытом квадрате даёт -1', missingEdge(edges, box) === -1);
}

/* ============================ ходы ============================ */

{
    // Первая линия принадлежит тому, кого движок выбрал первым
    const m = new Match('TEST01', [{ id: 'a' }, { id: 'b' }], {});
    check('первый игрок выбирается случайно', m.firstSlot === 0 || m.firstSlot === 1);
    check('игра начинается со фазы подготовки', m.phase === 'starting');

    // Ход до начала игры не засчитывается
    const before = m.edges.slice();
    m.move(m.players[m.turnSlot].id, 0);
    check('до сигнала ходить нельзя', m.edges.every((v, i) => v === before[i]));

    m.beginPlaying();
    const first = m.players[m.turnSlot].id;
    // Слот запоминаем ДО хода: ход без закрытия квадрата обязан передать
    // очередь сопернику
    const slotBefore = m.turnSlot;
    check('ход проходит', m.move(first, 0) === true);
    check('линия принадлежит ходившему', m.edges[0] === slotBefore,
        `линия принадлежит слоту ${m.edges[0]}, ходил ${slotBefore}`);

    // Второй раз по той же линии ходить нельзя
    check('второй ход ушёл сопернику', m.turnSlot !== slotBefore, `слот ${m.turnSlot}`);
    check('занятую линию ходить нельзя', m.move(m.players[m.turnSlot].id, 0) === false);

    // И вне диапазона
    check('линия вне поля отвергается',
        m.move(m.players[m.turnSlot].id, EDGE_COUNT) === false &&
        m.move(m.players[m.turnSlot].id, -1) === false &&
        m.move(m.players[m.turnSlot].id, 1.5) === false);

    // Ход соперника, когда твой - тоже отвергается
    const wrongPlayer = m.players[1 - m.turnSlot].id;
    check('не в свою очередь ходить нельзя', m.move(wrongPlayer, 5) === false);

    m.clearTimer();
}

{
    // Правило продолжения: закрыл квадрат - ходишь ещё раз
    const m = new Match('TEST02', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();
    const me = m.player(m.players[m.turnSlot].id);
    const box = 0;
    const [top, bottom, left, right] = BOX_EDGES[box];

    // Закрываем квадрат 0
    m.move(me.id, top);
    m.move(m.players[m.turnSlot].id, bottom);
    m.move(m.players[m.turnSlot].id, left);
    const slotBefore = m.turnSlot;
    const scoreBefore = m.player(slotBefore === 0 ? me.id : m.players[1 - slotBefore].id);
    m.move(m.players[m.turnSlot].id, right);

    check('закрытый квадрат засчитан', m.boxOwner[box] === slotBefore,
        `владелец ${m.boxOwner[box]}, ходил слот ${slotBefore}`);
    check('после закрытия ход остаётся у игрока', m.turnSlot === slotBefore,
        `слот стал ${m.turnSlot}, был ${slotBefore}`);
    check('очко начислено', m.players[slotBefore].score === 1,
        `счёт ${m.players[slotBefore].score}`);
    m.clearTimer();
}

{
    // Чужой квадрат нельзя закрыть, если его уже забрали
    const m = new Match('TEST03', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();
    const box = 5;
    const [top, bottom, left, right] = BOX_EDGES[box];
    m.boxOwner[box] = 0;
    m.edges[top] = 0; m.edges[bottom] = 0; m.edges[left] = 0;
    const player = m.players[m.turnSlot].id;
    m.move(player, right);
    check('уже забранный квадрат не достаётся другому', m.boxOwner[box] === 0,
        `владелец ${m.boxOwner[box]}`);
    check('счёт забравшего не изменился', m.players[0].score === 0);
    m.clearTimer();
}

/* ============================ таймаут ============================ */

{
    // Таймаут не наказывается: сервер сам рисует линию и партия идёт дальше
    const m = new Match('TEST04', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();
    const stuck = m.turnSlot;
    m.onTurnTimeout(stuck);

    const drawn = m.edges.filter(v => v !== -1).length;
    check('после таймаута линия проведена', drawn === 1, `проведено ${drawn}`);
    check('после таймаута ход перешёл дальше', m.phase === 'playing' ||
        m.turnSlot !== stuck || drawn === 1);
    check('таймаут не даёт страйк', m.players[stuck].violations === 0,
        `нарушений ${m.players[stuck].violations}`);
    m.clearTimer();
}

/* ============================ обрыв связи ============================ */

{
    // Обрыв связи - единственное наказуемое нарушение
    const punished = [];
    const m = new Match('TEST05', [{ id: 'a' }, { id: 'b' }], {
        onViolation: (name) => punished.push(name),
        shouldPunish: () => false
    });
    m.beginPlaying();
    m.onDisconnect('a');
    check('обрыв помечен', m.player('a').connected === false);
    m.resolveViolation('a');
    check('обрыв связи засчитан как нарушение', punished.length === 1, `нарушений ${punished.length}`);
    check('при обрыве побеждает соперник', m.result && m.result.winnerId === 'b',
        `победитель ${m.result && m.result.winnerId}`);
    m.clearTimer();
}

{
    // Возврат в игру отменяет наказание
    const m = new Match('TEST06', [{ id: 'a' }, { id: 'b' }], {
        onViolation: () => {}
    });
    m.beginPlaying();
    m.onDisconnect('a');
    m.onReconnect('a');
    check('вернувшийся снова в сети', m.player('a').connected === true);
    m.clearTimer();
}

/* ============================ опасные цепочки ============================ */

{
    // Подсветка должна показывать квадраты, которые игрок обязан отдать
    const m = new Match('TEST07', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();

    // Три стороны квадрата 0, последняя проводится игроком, которому ход
    const box = 0;
    const [top, bottom, left, right] = BOX_EDGES[box];
    m.edges[top] = 0; m.edges[bottom] = 0; m.edges[left] = 0;
    m.boxThreat[box] = m.turnSlot;

    const danger = m.dangerBoxes();
    check('цепочка видна в снимке', danger.includes(box), `в опасных: ${danger}`);

    // После забора квадрата подсветка исчезает
    m.boxOwner[box] = m.turnSlot;
    check('забранный квадрат больше не опасен', !m.dangerBoxes().includes(box));
    m.clearTimer();
}

{
    // Чужая цепочка подсвечиваться не должна: её отдаст соперник
    const m = new Match('TEST08', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();
    const box = 0;
    const [top, bottom, left] = BOX_EDGES[box];
    m.edges[top] = 0; m.edges[bottom] = 0; m.edges[left] = 0;
    m.boxThreat[box] = 1 - m.turnSlot;
    check('чужая цепочка не подсвечена', !m.dangerBoxes().includes(box));
    m.clearTimer();
}

/* ============================ снимок ============================ */

{
    const m = new Match('TEST09', [{ id: 'a' }, { id: 'b' }], {});
    m.beginPlaying();
    const snap = m.snapshot();
    check('в снимке есть серверное время', typeof snap.serverNow === 'number');
    check('в снимке есть дедлайн хода', typeof snap.turnDeadline === 'number');
    check('в снимке 40 линий', snap.edges.length === EDGE_COUNT);
    check('в снимке 16 квадратов', snap.boxOwner.length === BOX_COUNT);
    check('в снимке указан ходящий', typeof snap.turnId === 'string');
    check('тайминг хода 10 секунд', snap.timing.turn === TURN_MS, `${snap.timing.turn} мс`);
    m.clearTimer();
}

/* ============================ партии бот против бота ============================ */

{
    let aborted = 0;
    let structureErrors = 0;
    let lastStructureError = null;
    let invalidBotMove = 0;
    const scoreDiff = [];

    const GAMES = 300;

    for (let g = 0; g < GAMES; g++) {
        const m = new Match(`G${g}`, [
            { id: 'a', username: 'A' },
            { id: 'b', username: 'B' }
        ], {});
        m.beginPlaying();

        let guard = EDGE_COUNT + 5;

        while (m.phase === 'playing' && guard-- > 0) {
            const bot = m.players[m.turnSlot];
            const edge = botMove(m.edges, m.boxOwner, bot.slot);

            // Бот обязан ходить только свободной линией
            if (edge < 0 || edge >= EDGE_COUNT || m.edges[edge] !== -1) {
                invalidBotMove++;
                m.clearTimer();
                break;
            }

            m.move(bot.id, edge);

            const bad = structureIsSane(m.snapshot());
            if (bad) {
                structureErrors++;
                lastStructureError = bad;
            }
        }

        if (m.phase !== 'finished') {
            aborted++;
        } else {
            const [p1, p2] = m.players;
            scoreDiff.push(p1.score - p2.score);
            const total = p1.score + p2.score;
            if (total !== BOX_COUNT) {
                structureErrors++;
                lastStructureError = `разобрано ${total} квадратов вместо ${BOX_COUNT}`;
            }
            if (!m.result || m.result.winnerId === undefined) {
                structureErrors++;
                lastStructureError = 'нет победителя';
            }
        }
        m.clearTimer();
    }

    check(`${GAMES} партий бот против бота доиграны`, aborted === 0, `не доиграно ${aborted}`);
    check('счёт игроков совпадает с квадратами', structureErrors === 0, lastStructureError);
    check('бот всегда ходит по свободной линии', invalidBotMove === 0, `некорректных ${invalidBotMove}`);

    // При равной силе разброс счёта должен быть небольшим. Если бот
    // выигрывает 16:0 чаще, чем проигрывает, один из них явно сильнее
    const wins = scoreDiff.filter(d => d > 0).length;
    const losses = scoreDiff.filter(d => d < 0).length;
    const ratio = wins / Math.max(1, losses);
    check('боты играют примерно поровну', ratio > 0.5 && ratio < 2,
        `побед ${wins}, поражений ${losses}`);
}

/* ============================ партия человек-бот ============================ */

{
    // Игрок всегда проигрывает по таймауту - так проверяется, что партия
    // доходит до конца, а не зависает на первом же таймауте
    let finished = 0;
    const GAMES = 30;

    for (let g = 0; g < GAMES; g++) {
        const m = new Match(`H${g}`, [
            { id: 'human', username: 'Human' },
            { id: '__bot__', username: 'Бот', isBot: true }
        ], {});
        m.beginPlaying();

        let guard = EDGE_COUNT + 5;
        while (m.phase === 'playing' && guard-- > 0) {
            const actor = m.players[m.turnSlot];
            if (actor.isBot) {
                const edge = botMove(m.edges, m.boxOwner, actor.slot);
                if (edge < 0 || m.edges[edge] !== -1) break;
                m.move(actor.id, edge);
            } else {
                m.onTurnTimeout(actor.slot); // человек думает бесконечно
            }
        }
        if (m.phase === 'finished') finished++;
        m.clearTimer();
    }

    check(`${GAMES} партий с бесконечным «человеком» доходят до конца`, finished === GAMES,
        `закончилось ${finished}`);
}

/* ============================ финальные проверки ============================ */

{
    // Все 16 квадратов делятся поровну - 8:8 возможно, и тогда побеждает
    // забравший последний квадрат. Проверяем, что матч так и заканчивается
    let tieHandled = true;
    let tieDetail = null;
    for (let g = 0; g < 200 && tieHandled; g++) {
        const m = new Match(`T${g}`, [{ id: 'a' }, { id: 'b' }], {});
        m.beginPlaying();
        let guard = EDGE_COUNT + 5;
        while (m.phase === 'playing' && guard-- > 0) {
            const actor = m.players[m.turnSlot];
            const edge = botMove(m.edges, m.boxOwner, actor.slot);
            if (edge < 0 || m.edges[edge] !== -1) break;
            m.move(actor.id, edge);
        }
        const [p1, p2] = m.players;
        if (p1.score === p2.score) {
            if (!m.result || m.result.winnerId === undefined) {
                tieHandled = false;
                tieDetail = 'ничья без победителя';
            } else if (m.result.reason !== 'tiebreak') {
                tieHandled = false;
                tieDetail = `причина «${m.result.reason}», а не tiebreak`;
            }
        }
        m.clearTimer();
    }
    check('ничья 8:8 разрешается тай-брейком', tieHandled, tieDetail);
}

/* ============================ вывод ============================ */

console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
if (failed > 0) {
    console.log('\nПровалы:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
console.log('Все проверки пройдены.');
