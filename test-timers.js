/**
 * Проверка таймеров матча с секундомером.
 *
 * Не доверяем конфигурации: ждём реального перехода фаз и меряем.
 * Сверяем и с тем, что сервер сам объявляет в snapshot.timing.
 *
 * Запуск:
 *   node test-timers.js
 *   $env:SERVER_URL='https://mypoddomenjm.mooo.com'; node test-timers.js
 */

const { io } = require('socket.io-client');

const URL = process.env.SERVER_URL || 'http://localhost:3000';
const PREFIX = 'tm' + Math.floor(Math.random() * 100000);
const A = PREFIX + 'a';
const B = PREFIX + 'b';
const PASSWORD = 'pass1234';

// Заявленные правилами значения. Снимок отдаёт их в миллисекундах.
const EXPECTED_MS = {
    guessCountdown: 5000,
    guessPick: 10000,
    guessRole: 15000,
    turn: 15000
};

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

function client(username) {
    const socket = io(URL, { transports: ['websocket'] });
    const st = {
        username,
        socket,
        snapshot: null,
        challenge: null,
        token: null,
        // момент последнего снимка и когда он пришёл
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

async function register(username) {
    const reg = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json());
    if (reg.token) return reg.token;
    const login = await fetch(`${URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json()).then(d => d.token);
    return login;
}

async function until(fn, ms, label) {
    const end = now() + ms;
    while (now() < end) {
        if (fn()) return true;
        await sleep(30);
    }
    if (label) check(label, false, 'не дождались');
    return false;
}

const timer = setTimeout(() => {
    console.log('\n  ТАЙМАУТ: сценарий не уложился в 120 секунд');
    process.exit(1);
}, 120000);

let a, b;

/** Разм��ивает комплект текстов о таймерах в снимке. */
function timing(s) {
    return s && s.timing ? s.timing : null;
}

/**
 * Сколько секунд покажет игроку таймер в этот снимок.
 *
 * Клиент считает остаток как deadline минус свои часы, а с поправкой на
 * разницу часов - как deadline минус serverNow. Именно это значение и
 * проверяем: оно не зависит от того, насколько часы машины, с которой
 * идёт тест, отличаются от серверных.
 */
function shown(s) {
    if (!s || typeof s.serverNow !== 'number') return null;
    const deadline = s.phase === 'playing' ? s.turnDeadline : s.guessing ? s.guessing.deadline : null;
    return deadline === null || deadline === undefined ? null : (deadline - s.serverNow) / 1000;
}

function checkShown(name, s, lo, hi) {
    const v = shown(s);
    check(
        name,
        v !== null && v > lo && v < hi,
        v === null ? 'нет serverNow' : Math.round(v * 10) / 10
    );
}

async function main() {
    console.log(`\nТаймеры на ${URL}`);
    a = client(A);
    b = client(B);

    await until(() => a.socket.connected && b.socket.connected, 10000);
    a.token = await register(A);
    b.token = await register(B);
    a.socket.emit('userOnline', { username: A });
    b.socket.emit('userOnline', { username: B });
    await sleep(300);

    // --- объявленные сервером значения ---
    const sent = await fetch(`${URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ targetUsername: B })
    }).then(r => r.json());
    check('вызов принят сервером', sent.success === true, sent);
    await until(() => b.challenge, 8000);
    const accepted = await fetch(`${URL}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}` },
        body: JSON.stringify({ challengeId: b.challenge.challengeId })
    }).then(r => r.json());
    check('матч создан', !!accepted.roomId, accepted);

    // --- 1. тайминги, объявленные сервером ---
    await until(() => a.snapshot && a.snapshot.phase === 'guessing', 8000);
    const guessSeenAt = a.seenAt;
    const t = timing(a.snapshot);
    check('сервер объявляет тайминги', !!t, t);
    if (t) {
        check('отсчёт угадайки = 5000 мс', t.guessCountdown === EXPECTED_MS.guessCountdown, t.guessCountdown);
        check('выбор числа = 10000 мс', t.guessPick === EXPECTED_MS.guessPick, t.guessPick);
        check('выбор роли = 15000 мс', t.guessRole === EXPECTED_MS.guessRole, t.guessRole);
    }
    check('снимок несёт серверное время', typeof a.snapshot?.serverNow === 'number', a.snapshot?.serverNow);
    checkShown('таймер отсчёта показывает около 5 с', a.snapshot, 3.5, 5.5);

    // Замер отсчёта: от первого снимка фазы guessing до подфазы picking
    await until(
        () => a.snapshot?.guessing?.sub === 'picking',
        12000,
        'окно выбора открылось'
    );
    const pickOpenAt = a.seenAt;
    const countdownElapsed = (pickOpenAt - guessSeenAt) / 1000;
    check(
        'отсчёт перед выбором длится около 5 с',
        countdownElapsed > 4 && countdownElapsed < 7,
        Math.round(countdownElapsed * 10) / 10
    );
    checkShown('таймер выбора числа показывает около 10 с', a.snapshot, 8.5, 10.5);

    // --- 2. окно выбора: НИКТО не выбирает, ждём отмены ---
    await until(
        () => a.snapshot?.phase === 'finished',
        16000,
        'матч отменился по таймауту выбора'
    );
    const pickElapsed = (a.seenAt - pickOpenAt) / 1000;
    check(
        'окно выбора длится около 10 с',
        pickElapsed > 8.5 && pickElapsed < 12,
        Math.round(pickElapsed * 10) / 10
    );
    check(
        'причина отмены - не выбрано число',
        a.snapshot?.result?.reason === 'guess-timeout',
        a.snapshot?.result
    );

    // --- 3. таймер хода: матч доигрываем, оба не ходим ---
    const rematch = await fetch(`${URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ targetUsername: B })
    }).then(r => r.json());
    check('повторный вызов принят', rematch.success === true, rematch);
    await until(() => b.challenge && b.challenge.challengeId !== undefined, 8000);
    // Первый вызов мог остаться отменённым; принимаем новый
    await fetch(`${URL}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}` },
        body: JSON.stringify({ challengeId: b.challenge.challengeId })
    }).then(r => r.json());

    // Оба выбирают число, но роль не выбираем - её назначит сервер по таймеру
    await until(
        () => a.snapshot?.guessing?.sub === 'picking',
        15000,
        'окно выбора открылось снова'
    );
    const roomId = a.snapshot.roomId;
    a.socket.emit('match:pick', { roomId, cell: 0 });
    b.socket.emit('match:pick', { roomId, cell: 1 });
    await until(() => a.snapshot?.phase === 'roleChoice', 8000, 'фаза выбора роли');
    checkShown('таймер выбора роли показывает около 15 с', a.snapshot, 13.5, 15.5);

    // Замер окна выбора роли: оба молчат, сервер назначит роль по таймауту
    const roleStart = now();
    await until(
        () => a.snapshot?.phase === 'playing',
        25000,
        'роль назначена автоматически'
    );
    const roleElapsed = (now() - roleStart) / 1000;
    check(
        'роль назначается примерно через 15 с',
        roleElapsed > 13.5 && roleElapsed < 18.5,
        Math.round(roleElapsed * 10) / 10
    );

    // --- 4. таймер хода: никто не ходит ---
    checkShown('таймер хода показывает около 15 с', a.snapshot, 13.5, 15.5);
    const turnStart = now();
    await until(
        () => a.snapshot?.phase === 'finished',
        25000,
        'матч завершился по таймауту хода'
    );
    const turnElapsed = (now() - turnStart) / 1000;
    check(
        'ход отнимает примерно 15 с',
        turnElapsed > 13.5 && turnElapsed < 18.5,
        Math.round(turnElapsed * 10) / 10
    );
    check(
        'причина - пропущенный ход',
        a.snapshot?.result?.reason === 'timeout',
        a.snapshot?.result
    );

    console.log(failed === 0 ? '\nТаймеры в порядке\n' : `\nПровалено: ${failed}\n`);
    cleanup(failed === 0 ? 0 : 1);
}

function cleanup(code) {
    clearTimeout(timer);
    if (a) a.socket.close();
    if (b) b.socket.close();
    process.exit(code);
}

main().catch(e => {
    console.log('\n  FAIL исключение: ' + e.message);
    console.log(e.stack);
    cleanup(1);
});
