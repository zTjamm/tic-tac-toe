/**
 * Проверка таймеров партии секундомером.
 *
 * Не доверяем конфигурации: ждём реального перехода фаз и меряем.
 * Сверяем и с тем, что сервер сам объявляет в snapshot.timing.
 *
 * В новой игре фазы две: подготовка к партии и ход. Проверяем обе, плюс
 * что ход по таймеру не наказывается и партия продолжается.
 *
 * Запуск:
 *   node test-timers.js
 *   $env:SERVER_URL='https://example.com'; node test-timers.js
 */

const { io } = require('socket.io-client');

const URL = process.env.SERVER_URL || 'http://localhost:3000';
const PREFIX = 'tm' + Math.floor(Math.random() * 100000);
const A = PREFIX + 'a';
const B = PREFIX + 'b';
const PASSWORD = 'pass1234';

/** Сколько ждём на каждый таймер: ожидаемое + запас на сеть */
const SLACK = 4000;

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

function client(username, token) {
    const socket = io(URL, { transports: ['websocket'] });
    const st = {
        username,
        socket,
        snapshot: null,
        challenge: null,
        token,
        // момент получения последнего снимка от сервера
        seenAt: 0,
        lastType: null
    };
    socket.on('challengeReceived', d => { st.challenge = d; });
    socket.on('match:state', m => {
        st.snapshot = m.snapshot;
        st.lastType = m.type;
        st.seenAt = now();
    });
    return st;
}

/** Ждём снимка, подходящего под условие. getter обязателен: состояние
    живёт во внешнем объекте и передать его значением нельзя. */
function waitFor(get, predicate, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
        const ok = () => { const v = get(); return v && predicate(v); };
        if (ok()) return resolve(get());
        const started = now();
        const t = setInterval(() => {
            if (ok()) { clearInterval(t); resolve(get()); }
            else if (now() - started > timeoutMs) {
                clearInterval(t);
                reject(new Error('ожидание истекло'));
            }
        }, 25);
    });
}

async function register(username) {
    const res = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    });
    if (!res.ok) throw new Error(`регистрация ${username}: ${res.status}`);
    const data = await res.json();
    return data.token;
}

async function main() {
    // Регистрируем ДО создания сокетов. io() начинает подключаться сразу,
    // и если сначала дождаться регистрации (сетевой запрос), событие connect
    // успеет произойти до подписки на него - и ожидание зависнет навсегда.
    const tokenA = await register(A);
    const tokenB = await register(B);

    const ca = client(A, tokenA);
    const cb = client(B, tokenB);

    await Promise.all([
        new Promise(r => ca.socket.on('connect', r)),
        new Promise(r => cb.socket.on('connect', r))
    ]);
    ca.socket.emit('userOnline', { username: A });
    cb.socket.emit('userOnline', { username: B });
    await sleep(400);

    /* ---------- Подготовка к партии ---------- */
    console.log('\nТаймер подготовки:');
    cb.snapshot = null;
    const startBotAt = now();
    ca.socket.emit('match:startBot');

    await waitFor(() => ca.snapshot, s => s.phase === 'starting');
    check('пришла фаза подготовки', ca.snapshot.phase === 'starting');
    check('сервер объявил время подготовки',
        typeof ca.snapshot.timing.start === 'number' && ca.snapshot.timing.start > 0,
        ca.snapshot.timing.start);

    const startMs = ca.snapshot.timing.start;
    const playedAt = await waitFor(() => ca.snapshot, s => s.phase === 'playing');
    const startMeasured = now() - startBotAt;
    check(
        `подготовка длится около ${startMs / 1000} с`,
        startMeasured >= startMs * 0.6 && startMeasured <= startMs + SLACK,
        { measured: startMeasured, expected: startMs }
    );
    check('в начале ходов есть дедлайн хода',
        typeof playedAt.turnDeadline === 'number' && playedAt.turnDeadline > 0);

    /* ---------- Таймер хода ---------- */
    console.log('\nТаймер хода:');
    check('сервер объявил время хода',
        typeof playedAt.timing.turn === 'number' && playedAt.timing.turn > 0,
        playedAt.timing.turn);

    const turnMs = playedAt.timing.turn;
    // Замерять надо очередь ИГРОКА, а не первый ход партии: кто ходит
    // первым, решает жеребьёвка, и если первым окажется бот, он сделает
    // ход через 700 мс - это не таймаут, и проверка была бы нестабильной.
    const beforeMyTurn = ca.snapshot;
    await waitFor(
        () => ca.snapshot,
        s => s.phase === 'finished' || s.turnId === A || s.movesLeft < beforeMyTurn.movesLeft,
        turnMs + SLACK + 4000
    );
    await waitFor(() => ca.snapshot, s => s.phase === 'playing' && s.turnId === A,
        turnMs + SLACK + 4000);
    const myTurnMovesLeft = ca.snapshot.movesLeft;

    const turnStartAt = now();
    // Ждём, пока сервер сам сделает ход по таймеру за игрока
    const afterTimeout = await waitFor(
        () => ca.snapshot,
        s => s.phase === 'finished' || s.movesLeft < myTurnMovesLeft,
        turnMs + SLACK + 4000
    );
    const turnMeasured = now() - turnStartAt;

    check(
        `ход по таймауту случился около ${turnMs / 1000} с`,
        turnMeasured >= turnMs * 0.6 && turnMeasured <= turnMs + SLACK,
        { measured: turnMeasured, expected: turnMs }
    );
    check('после таймаута линий стало меньше',
        afterTimeout.movesLeft < myTurnMovesLeft,
        { before: myTurnMovesLeft, after: afterTimeout.movesLeft });

    /* ---------- Таймаут не наказывается и партия продолжается ---------- */
    console.log('\nТаймаут хода не наказывается:');
    check('партия после таймаута не отменена',
        afterTimeout.phase !== 'finished' || afterTimeout.result.type === 'finished',
        afterTimeout.phase);
    check('счётчик обрывов у игрока нулевой',
        afterTimeout.players.every(p => p.strikes === 0),
        afterTimeout.players.map(p => p.strikes));

    // Доигрываем партию до финала: она обязана завершиться, а не зависнуть
    const guard = now() + 90000;
    while (ca.snapshot && ca.snapshot.phase === 'playing' && now() < guard) {
        const s = ca.snapshot;
        if (s.turnId === A) {
            const free = s.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);
            if (free.length === 0) break;
            ca.socket.emit('match:move', { roomId: s.roomId, edge: free[0] });
        }
        await sleep(80);
    }
    check('партия доигралась после таймаутов',
        ca.snapshot && ca.snapshot.phase === 'finished', ca.snapshot && ca.snapshot.phase);
    check('таймаут не оборвал партию досрочно',
        ca.snapshot && ca.snapshot.result.reason === 'score',
        ca.snapshot && ca.snapshot.result.reason);

    ca.socket.close();
    cb.socket.close();
}

main()
    .then(() => {
        console.log(failed === 0 ? '\nВсе проверки пройдены' : `\nПровалено: ${failed}`);
        process.exit(failed === 0 ? 0 : 1);
    })
    .catch(e => {
        console.error('\nОшибка теста:', e.message);
        process.exit(1);
    });
