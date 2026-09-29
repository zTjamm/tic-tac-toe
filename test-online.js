/**
 * Интеграционная проверка сетевой партии между двумя людьми.
 * Полный цикл: подбор соперника -> вызов -> принятие -> ходы -> финал ->
 * реванш. Проверяем главное: оба сокета видят одинаковое состояние.
 *
 * Запуск: node test-online.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

// SERVER_URL позволяет прогнать тот же сценарий против прода:
//   $env:SERVER_URL='https://example.com'; node test-online.js
const URL = process.env.SERVER_URL || 'http://localhost:3000';
const A = 'oa' + Math.floor(Math.random() * 100000);
const B = 'ob' + Math.floor(Math.random() * 100000);
const PASSWORD = 'pass1234';
/**
 * Сколько ждём вызов.
 *
 * Окно ответа на вызов - 10 секунд, и подбор перебирает игроков по очереди.
 * На сервере почти всегда есть кто-то ещё онлайн, и вызов может уйти не
 * сразу на нашего второго игрока: 10 секунд уйдёт на постороннего.
 * Поэтому ждём с запасом на несколько таких окон, иначе тест падал бы
 * от того, что рядом кто-то зашёл в игру.
 */
const WINDOW_MS = 10000;
const ACCEPT_WAIT_MS = WINDOW_MS * 4 + 5000;

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function register(username) {
    const res = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`регистрация ${username}: ${data.error || res.status}`);
    return data.token;
}

async function connect(username, token) {
    const socket = io(URL);
    const state = { snap: null, search: null, challenge: null, notice: null };
    socket.on('match:state', msg => { state.snap = msg.snapshot; });
    socket.on('search:state', s => { state.search = s; });
    socket.on('challengeReceived', c => { state.challenge = c; });
    socket.on('challengeDeclined', d => { state.notice = d; });
    socket.on('rematchRequested', r => { state.rematch = r; });
    socket.on('rematchDeclined', d => { state.notice = d; });

    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
    });
    socket.emit('userOnline', { username });
    await sleep(300);
    return { socket, state, token, username };
}

/** Ждём условия. getter, а не значение: состояние живёт во внешнем объекте. */
function waitFor(get, predicate, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const ok = () => { const v = get(); return v && predicate(v); };
        if (ok()) return resolve(get());
        const started = Date.now();
        const t = setInterval(() => {
            if (ok()) { clearInterval(t); resolve(get()); }
            else if (Date.now() - started > timeoutMs) {
                clearInterval(t);
                reject(new Error('ожидание истекло'));
            }
        }, 50);
    });
}

/** Играем партию до финала, по очереди. Ошибок не ждём: нас интересует,
    что оба видят одно и то же и что партия завершается. */
async function playOut(pa, pb) {
    let moves = 0;
    let mismatch = null;
    const lastEdges = { [pa.username]: '', [pb.username]: '' };

    while (pa.state.snap && pa.state.snap.phase === 'playing' && moves < 120) {
        for (const p of [pa, pb]) {
            const s = p.state.snap;
            if (!s || s.phase !== 'playing') continue;
            if (s.turnId !== p.username) continue;

            const free = s.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);
            if (free.length === 0) continue;
            p.socket.emit('match:move', { roomId: s.roomId, edge: free[0] });
            lastEdges[p.username] = free[0].toString();
            await sleep(90);
        }

        // Ключевая проверка: состояния двух игроков обязаны совпадать
        const sa = pa.state.snap;
        const sb = pb.state.snap;
        if (sa && sb && !mismatch) {
            if (sa.edges.join(',') !== sb.edges.join(',')) {
                mismatch = `после ${moves} ходов поля разошлись`;
            } else if (sa.turnId !== sb.turnId) {
                mismatch = `после ${moves} ходов очередь разошлась`;
            } else {
                for (const pl of sa.players) {
                    const other = sb.players.find(x => x.id === pl.id);
                    if (other && other.score !== pl.score) {
                        mismatch = `счёт ${pl.username}: ${pl.score} против ${other.score}`;
                    }
                }
            }
        }
        moves++;
    }
    return { moves, mismatch };
}

async function main() {
    console.log('Подготовка двух игроков...');
    const tokenA = await register(A);
    const tokenB = await register(B);
    const pa = await connect(A, tokenA);
    const pb = await connect(B, tokenB);

    /* ---------- 1. Рейтинг закрыт до трёх партий ---------- */
    console.log('\nГейт рейтинга:');
    pa.socket.emit('match:find');
    await sleep(600);
    check(
        'поиск не запускается без трёх партий',
        pa.state.search && pa.state.search.status === 'done' &&
            pa.state.search.reason === 'locked',
        pa.state.search
    );

    /* ---------- 2. Ручной вызов тоже закрыт ---------- */
    const chk = await fetch(`${URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ targetUsername: B })
    });
    check('вызов на рейтинг отклонён до трёх партий', chk.status === 400, chk.status);

    /* ---------- 3. Набираем три партии ботом ---------- */
    console.log('\nГейт набирается партиями с ботом:');
    for (let i = 1; i <= 3; i++) {
        pa.state.snap = null;
        pa.socket.emit('match:startBot');
        await waitFor(() => pa.state.snap, s => s.phase === 'playing');
        // Быстро доигрываем: ходим всегда, пока партия жива
        const guard = Date.now() + 60000;
        while (pa.state.snap.phase === 'playing' && Date.now() < guard) {
            const s = pa.state.snap;
            if (s.turnId !== pa.username) { await sleep(60); continue; }
            const free = s.edges.map((v, x) => (v === -1 ? x : -1)).filter(x => x >= 0);
            if (!free.length) break;
            pa.socket.emit('match:move', { roomId: s.roomId, edge: free[0] });
            await sleep(80);
        }
        check(`партия с ботом ${i} доиграна`, pa.state.snap.phase === 'finished',
            pa.state.snap.phase);
        pa.state.snap = null;
    }

    const profA = await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${tokenA}` }
    }).then(r => r.json());
    check('после трёх партий рейтинг открыт', profA.canPlayRated === true, profA);
    check('рейтинг не сдвинулся от игр с ботом', profA.rating === 1000, profA.rating);

    /* ---------- 4. Подбор: B принимает вызов A ---------- */
    console.log('\nПодбор соперника:');
    pa.socket.emit('match:find');
    const incoming = await waitFor(() => pb.state.challenge, c => !!c, ACCEPT_WAIT_MS);
    check('B получил вызов', !!incoming, incoming);
    check('в вызове указан отправитель', incoming.from === A, incoming.from);
    check('окно ответа объявлено', typeof incoming.expiresIn === 'number', incoming);

    const acc = await fetch(`${URL}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ challengeId: incoming.challengeId })
    });
    check('вызов принят', acc.ok, acc.status);
    pb.state.challenge = null;

    await waitFor(() => pa.state.snap, s => s && s.phase === 'playing');
    await waitFor(() => pb.state.snap, s => s && s.phase === 'playing');
    check('оба игрока в одной партии',
        pa.state.snap.roomId === pb.state.snap.roomId,
        [pa.state.snap.roomId, pb.state.snap.roomId]);
    check('у обоих одинаковое поле',
        pa.state.snap.edges.join() === pb.state.snap.edges.join());
    check('поиск у A остановлен', pa.state.search.status === 'idle', pa.state.search);

    /* ---------- 5. Играем партию ---------- */
    console.log('\nСетевая партия:');
    const ratedBefore = (await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${tokenA}` }
    }).then(r => r.json())).rating;

    const { moves, mismatch } = await playOut(pa, pb);
    console.log(`  (ходов: ${moves})`);

    check('оба сокета видели одинаковую партию', mismatch === null, mismatch);
    check('партия дошла до финала',
        pa.state.snap.phase === 'finished' && pb.state.snap.phase === 'finished',
        [pa.state.snap.phase, pb.state.snap.phase]);
    check('победитель один и тот же у обоих',
        pa.state.snap.result.winnerId === pb.state.snap.result.winnerId,
        [pa.state.snap.result.winnerId, pb.state.snap.result.winnerId]);
    check('все 16 квадратов разобраны',
        pa.state.snap.players.reduce((s, p) => s + p.score, 0) === 16,
        pa.state.snap.players.map(p => p.score));

    /* ---------- 6. Рейтинг двигается в сетевой игре ---------- */
    const profA2 = await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${tokenA}` }
    }).then(r => r.json());
    const profB2 = await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${tokenB}` }
    }).then(r => r.json());
    const ratedTotal = profA2.rating + profB2.rating;
    check('рейтинг изменился у участников сетевой игры',
        profA2.rating !== ratedBefore || profB2.rating !== 1000,
        [ratedBefore, profA2.rating, profB2.rating]);
    check('у обоих учтена партия', profA2.played >= 4 && profB2.played >= 1,
        [profA2.played, profB2.played]);

    /* ---------- 7. Реванш ---------- */
    console.log('\nРеванш:');
    pa.socket.rematch = null;
    pa.socket.emit('match:rematch');
    await waitFor(() => pb.state.rematch, r => !!r);
    check('B получил предложение реванша', pb.state.rematch.from === A, pb.state.rematch);

    pb.socket.emit('match:rematchResponse', { from: A, accept: true });
    await waitFor(() => pa.state.snap, s => s && s.phase === 'playing');
    await waitFor(() => pb.state.snap, s => s && s.phase === 'playing');
    check('реванш начался', pa.state.snap.roomId !== pb.state.snap.roomId ||
        pa.state.snap.phase === 'playing');
    check('поле реванша пустое',
        pa.state.snap.edges.every(v => v === -1));

    pa.socket.close();
    pb.socket.close();
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
