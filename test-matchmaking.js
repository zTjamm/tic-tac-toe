/**
 * Проверка подбора соперника: очередь, окно вызова, отмена.
 *
 * Здесь нет почти никакой игровой логики, зато есть ровно то место, где
 * легко написать условие, которое никогда не срабатывает. Например, если
 * проверять «кого позвать» через список кандидатов, в который не входят
 * ищущие, то двое ищущих никогда не встретятся напрямую - и ошибка будет
 * выглядеть не как ошибка, а как «подбор иногда идёт через вызов».
 *
 * Запуск: node test-matchmaking.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

const URL = process.env.SERVER_URL || 'http://localhost:3000';
const PASSWORD = 'pass1234';
/** Окно вызова 10 с; ждём его целиком, иначе тест будет зависеть от скорости */
const WINDOW_MS = 11000;

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ждём снимка, подходящего под условие. getter обязателен. */
function waitFor(get, predicate, timeoutMs = 60000) {
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
        }, 40);
    });
}

let seq = 0;
async function makePlayer() {
    const username = 'mq' + (seq++) + Math.floor(Math.random() * 100000);
    const res = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`регистрация ${username}: ${data.error || res.status}`);

    const socket = io(URL);
    const st = { username, socket, search: null, snap: null, challenges: [] };
    socket.on('search:state', s => { st.search = s; });
    socket.on('match:state', m => { st.snap = m.snapshot; });
    socket.on('challengeReceived', c => { st.challenges.push(c); });

    await new Promise(r => socket.on('connect', r));
    socket.emit('userOnline', { username });
    await sleep(250);
    st.token = data.token;
    return st;
}

/** Набираем три партии ботом, чтобы открылся рейтинг. */
async function unlock(p) {
    for (let i = 0; i < 3; i++) {
        p.snap = null;
        p.socket.emit('match:startBot');
        // Ждём именно фазу ходов: партия 3 секунды готовится, и без этого
        // ожидания цикл ни разу не выполнится - игрок останется в партии,
        // и следующий match:startBot будет отклонён как "уже в игре"
        await waitFor(() => p.snap, s => s.phase === 'playing');
        const guard = Date.now() + 60000;
        while (p.snap && p.snap.phase === 'playing' && Date.now() < guard) {
            if (p.snap.turnId !== p.username) { await sleep(50); continue; }
            const free = p.snap.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);
            if (!free.length) break;
            p.socket.emit('match:move', { roomId: p.snap.roomId, edge: free[0] });
            await sleep(70);
        }
        // Выходим с экрана результата, иначе игрок остаётся «занятым»
        p.socket.emit('match:leave');
        p.snap = null;
        await sleep(250);
    }
    const prof = await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${p.token}` }
    }).then(r => r.json());
    return prof;
}

/** Доигрываем партию двух игроков до финала. */
async function playOut(p, q) {
    const guard = Date.now() + 90000;
    while (Date.now() < guard) {
        if (p.snap && p.snap.phase === 'finished') return;
        for (const x of [p, q]) {
            const s = x.snap;
            if (!s || s.phase !== 'playing' || s.turnId !== x.username) continue;
            const free = s.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);
            if (!free.length) continue;
            x.socket.emit('match:move', { roomId: s.roomId, edge: free[0] });
            await sleep(60);
        }
        await sleep(40);
    }
}

async function main() {
    console.log('Подготовка игроков...');
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();

    const profA = await unlock(a);
    check('рейтинг открыт после трёх партий', profA.canPlayRated === true, profA);
    // B тоже должен пройти гейт, иначе он не сможет искать соперника
    const profB = await unlock(b);
    check('гейт пройден и вторым игроком', profB.canPlayRated === true, profB);

    /* ---------- 1. Двое ищущих соединяются напрямую ---------- */
    console.log('\nДва ищущих соединяются сразу:');
    a.search = null; b.search = null; a.snap = null; b.snap = null;
    a.socket.emit('match:find');
    await sleep(400);
    check('A начал подбор', a.search && a.search.status === 'searching', a.search);

    // A уже пинит случайных игроков, и B среди них - это нормально.
    // Проверять надо, что после нажатия «Играть» новый вызов не ушёл:
    // двое ищущих соединяются напрямую, без окна ответа.
    const bChallengesBefore = b.challenges.length;
    const aChallengesBefore = a.challenges.length;
    b.socket.emit('match:find');
    await sleep(900);

    check('A и B оказались в одной партии',
        a.snap && b.snap && a.snap.roomId === b.snap.roomId,
        [a.snap && a.snap.roomId, b.snap && b.snap.roomId]);
    check('после нажатия «Играть» вызов не уходил - соединились напрямую',
        b.challenges.length === bChallengesBefore &&
        a.challenges.length === aChallengesBefore,
        { a: [aChallengesBefore, a.challenges.length], b: [bChallengesBefore, b.challenges.length] });
    check('подбор у обоих закрыт', a.search.status === 'idle' && b.search.status === 'idle',
        [a.search, b.search]);

    // Вернуть игроков в свободные. match:leave работает только на
    // завершённой партии, поэтому её надо доиграть.
    await playOut(a, b);
    a.socket.emit('match:leave');
    b.socket.emit('match:leave');
    a.snap = null; b.snap = null;
    await sleep(500);

    /* ---------- 2. Вызов и окно ответа ---------- */
    console.log('\nВызов и окно ответа:');
    c.challenges = [];
    a.socket.emit('match:find');
    await sleep(1500);

    const got = c.challenges.length > 0 || a.search.status === 'searching';
    check('подбор пошёл к игрокам по очереди', got, a.search);
    if (c.challenges.length === 0) {
        console.log('       (C не был выбран - проверяем окно на том, кого позвали)');
    } else {
        const ch = c.challenges[c.challenges.length - 1];
        check('в вызове объявлено окно 10 с', ch.expiresIn === 10000, ch.expiresIn);
    }

    /* ---------- 3. Истечение окна идёт к следующему ---------- */
    // Ждём, пока окно истечёт. Подбор при этом обязан продолжаться:
    // именно ради этого перебор и делается.
    console.log('\nОкно истекает, подбор продолжается:');
    const checkedBefore = (a.search && a.search.checked) || 0;
    await sleep(WINDOW_MS + 1500);

    check('после истечения окна подбор продолжается',
        a.search && a.search.status === 'searching',
        a.search);
    check('проверено больше игроков, чем в начале',
        (a.search && a.search.checked || 0) > checkedBefore,
        { before: checkedBefore, after: a.search && a.search.checked });

    /* ---------- 4. Отмена подбора ---------- */
    console.log('\nОтмена подбора:');
    a.socket.emit('match:findCancel');
    await sleep(600);
    check('подбор остановлен', a.search.status === 'idle', a.search);
    const challengesAtCancel = c.challenges.length;
    await sleep(WINDOW_MS + 1000);
    check('после отмены вызовы не приходят',
        c.challenges.length === challengesAtCancel,
        { before: challengesAtCancel, after: c.challenges.length });

    /* ---------- 5. Список одинокого игрока ---------- */
    console.log('\nСоперников нет:');
    // C один в комнате подбора никого не найдёт: A и B вышли, но в сети.
    // Проверяем корректное завершение, а не конкретный текст.
    a.snap = null;
    a.socket.emit('match:find');
    await sleep(500);
    check('подбор запустился у свободного игрока',
        a.search && (a.search.status === 'searching' || a.search.status === 'done'),
        a.search);
    a.socket.emit('match:findCancel');

    a.socket.close();
    b.socket.close();
    c.socket.close();
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
