/**
 * Запись партии по шагам - сырьё для визуализации.
 *
 * Играет настоящую партию и после каждого хода сохраняет полный снимок
 * состояния. Из этих снимков потом собирается разбор: кто какую линию
 * провёл, какие квадраты взял, где был обязан отдать и когда игрок получал
 * право ходить дальше.
 *
 * Запись идёт против локального сервера, чтобы не мусорить на боевом:
 *   node tools/record-game.js
 *   node tools/record-game.js --url http://localhost:3000 --games 3
 *
 * Результат: tools/game-replay.json
 */
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};

const URL = getArg('--url') || 'http://localhost:3000';
const GAMES = Number(getArg('--games') || 1);
const OUT = path.join(__dirname, 'game-replay.json');
const PREFIX = 'rec';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const freeEdges = snap => snap.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);

/** Сколько квадратов закроет линия - чтобы ходить осмысленно, а не наугад. */
function closesBox(snap, edge) {
    const SPAN = 4, H = 20;
    let row, col;
    if (edge < H) { row = Math.floor(edge / SPAN); col = edge % SPAN; }
    else { const v = edge - H; col = Math.floor(v / SPAN); row = v % SPAN; }
    const boxes = edge < H ? [[row, col], [row - 1, col]] : [[row, col], [row, col - 1]];
    let n = 0;
    for (const [br, bc] of boxes) {
        if (br < 0 || br > 3 || bc < 0 || bc > 3) continue;
        if (snap.boxOwner[br * SPAN + bc] !== -1) continue;
        const sides = [br * SPAN + bc, (br + 1) * SPAN + bc, H + bc * SPAN + br, H + (bc + 1) * SPAN + br];
        if (sides.filter(s => s !== edge && snap.edges[s] !== -1).length === 3) n++;
    }
    return n;
}

function chooseEdge(snap) {
    const free = freeEdges(snap);
    if (!free.length) return null;
    // Сначала закрываем квадраты: так правило продолжения срабатывает
    // чаще, и в разборе есть что показывать
    const scoring = free.filter(e => closesBox(snap, e) > 0);
    return scoring.length ? scoring[0] : free[Math.floor(Math.random() * free.length)];
}

async function register(username) {
    const r = await fetch(URL + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'pass1234' })
    }).then(x => x.json());
    if (!r.token) throw new Error('регистрация не удалась: ' + username);
    return { username, token: r.token };
}

/** Снимок, пригодный для показа: только то, что нужно для отрисовки. */
function slim(snap, extra) {
    return {
        phase: snap.phase,
        edges: snap.edges.slice(),
        boxOwner: snap.boxOwner.slice(),
        boxesLeft: snap.boxesLeft,
        danger: (snap.danger || []).slice(),
        turnId: snap.turnId,
        lastGainedBoxes: (snap.lastGainedBoxes || []).slice(),
        movesLeft: snap.movesLeft,
        scores: snap.players.map(p => ({ id: p.id, username: p.username, slot: p.slot, score: p.score })),
        result: snap.result || null,
        ...extra
    };
}

async function playOne(tag) {
    const me = await register(`${PREFIX}${tag}`);
    const socket = io(URL, { transports: ['websocket', 'polling'] });
    const state = { snap: null, roomId: null };
    await new Promise((res, rej) => {
        socket.on('connect', res);
        socket.on('connect_error', rej);
        setTimeout(() => rej(new Error('не подключился')), 15000);
    });
    socket.on('match:state', m => {
        state.snap = m.snapshot;
        if (m.snapshot && m.snapshot.roomId) state.roomId = m.snapshot.roomId;
    });
    socket.emit('userOnline', { username: me.username });
    await sleep(700);
    socket.emit('match:startBot');

    const frames = [];
    let guard = 0, prevCount = -1, room = null;
    let lastPhase = null;
    const timing = [];

    while (guard++ < 900) {
        const s = state.snap;
        if (!s) { await sleep(90); continue; }
        if (!room && s.roomId) { room = s.roomId; }
        if (!room) { await sleep(90); continue; }
        if (s.phase === 'finished') {
            frames.push(slim(s, { move: frames.length }));
            break;
        }
        const count = s.edges.filter(v => v !== -1).length;
        if (count === prevCount) { await sleep(90); continue; }

        // Вот прирост - это ход, который мы только что отправили.
        // lastGainedBoxes и turnId позволяют понять, было ли право ходить дальше
        if (frames.length) {
            const prev = frames[frames.length - 1];
            const gained = (s.lastGainedBoxes || []).length;
            const mine = s.turnId === me.username;
            frames[frames.length - 1] = {
                ...prev,
                gainedBoxes: (s.lastGainedBoxes || []).slice(),
                dangerAtMove: (prev.danger || []).slice(),
                keptTurn: !!gained && mine,
                endedWith: mine ? 'player' : 'bot'
            };
        }
        frames.push(slim(s, { move: frames.length }));
        prevCount = count;
        lastPhase = s.phase;

        if (s.phase === 'playing' && s.turnId === me.username) {
            const e = chooseEdge(s);
            if (e !== null) {
                const t0 = Date.now();
                socket.emit('match:move', { roomId: s.roomId, edge: e });
                timing.push(Date.now() - t0);
                await sleep(80);
            }
        }
        await sleep(85);
    }

    socket.close();
    const final = frames[frames.length - 1];
    const captures = frames.filter(f => f.gainedBoxes && f.gainedBoxes.length).length;
    const continuations = frames.filter(f => f.keptTurn).length;
    return {
        ok: !!final && final.phase === 'finished',
        room,
        username: me.username,
        frames,
        summary: {
            moves: frames.length,
            captures,
            continuations,
            dangerSeen: frames.some(f => (f.danger || []).length > 0),
            score: final && final.result ? final.scores : null,
            result: final && final.result
        }
    };
}

(async () => {
    console.log('сервер: ' + URL);
    const games = [];
    for (let i = 0; i < GAMES; i++) {
        const g = await playOne(String(Date.now()).slice(-6) + i);
        const s = g.summary;
        console.log(`  партия ${i + 1}: ${g.ok ? 'доиграна' : 'НЕ доиграна'}, ` +
            `ходов ${s.moves}, взятий ${s.captures}, продолжений ${s.continuations}, ` +
            `цепочки ${s.dangerSeen ? 'были' : 'не было'}` +
            (s.result ? `, исход ${s.result.reason}` : ''));
        if (g.ok) games.push(g);
    }

    if (!games.length) {
        console.error('ни одна партия не доиграна - визуализировать нечего');
        process.exit(1);
    }

    // Берём самую показательную: больше всего взятий, и чтобы цепочка была
    const best = games.sort((a, b) => {
        const score = g => g.summary.captures * 2 + g.summary.continuations
            + (g.summary.dangerSeen ? 3 : 0);
        return score(b) - score(a);
    })[0];

    const payload = {
        recordedAt: new Date().toISOString(),
        server: URL,
        game: best
    };
    fs.writeFileSync(OUT, JSON.stringify(payload));
    console.log();
    console.log('записано в ' + OUT);
    console.log(`  взятий ${best.summary.captures}, продолжений ${best.summary.continuations}, ` +
        `ходов ${best.summary.moves}`);
    process.exit(0);
})().catch(e => { console.error('ОШИБКА:', e && e.message ? e.message : e); process.exit(3); });
