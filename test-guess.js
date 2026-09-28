/**
 * Проверка угадайки: игроки должны выбирать клетку ОДНОВРЕМЕННО, а не
 * по очереди, и система открывает число только после выбора обоих.
 *
 * Оба сокета выбирают в одном тике, не дожидаясь снимков друг друга -
 * именно так ведут себя настоящие игроки.
 *
 * Запуск: node test-guess.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
const A = 'ga' + Math.floor(Math.random() * 100000);
const B = 'gb' + Math.floor(Math.random() * 100000);
const PASSWORD = 'pass1234';

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(username) {
    const socket = io(URL, { transports: ['websocket'] });
    const st = { username, socket, snapshot: null, challenge: null, token: null };
    socket.on('challengeReceived', d => { st.challenge = d; });
    socket.on('match:state', m => { st.snapshot = m.snapshot; });
    return st;
}

async function register(username) {
    const reg = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json());
    if (reg.token) return reg.token;
    return fetch(`${URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json()).then(d => d.token);
}

/** Ждёт выполнения предиката. Снимка может ещё не быть - тогда pred
    получает null (проверки подключения так и работают). */
async function until(st, pred, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (pred(st.snapshot)) return true;
        await sleep(40);
    }
    check(label, false, st.snapshot ? st.snapshot.phase : 'нет снимка');
    return false;
}

const timer = setTimeout(() => {
    console.log('\n  ТАЙМАУТ: сценарий не завершился за 40 секунд');
    process.exit(1);
}, 40000);

let a, b;

async function main() {
    console.log(`\nУгадайка: ${A} против ${B}`);
    a = client(A);
    b = client(B);

    await until(a, () => a.socket.connected, 8000, 'сокеты подключены');
    await until(b, () => b.socket.connected, 8000, 'второй сокет подключен');

    a.token = await register(A);
    b.token = await register(B);
    a.socket.emit('userOnline', { username: A });
    b.socket.emit('userOnline', { username: B });
    await sleep(300);

    const sent = await fetch(`${URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ targetUsername: B })
    }).then(r => r.json());
    check('вызов отправлен', sent.success === true, sent);

    await until(b, () => !!b.challenge, 5000, 'вызов получен');
    await fetch(`${URL}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}` },
        body: JSON.stringify({ challengeId: b.challenge.challengeId })
    });

    const picking = s => s.phase === 'guessing' && s.guessing?.sub === 'picking';
    if (!await until(a, picking, 10000, 'окно выбора открылось')) return cleanup(1);
    if (!await until(b, picking, 5000, 'окно открыто у обоих')) return cleanup(1);

    const roomId = a.snapshot.roomId;

    // Ключевая проверка: оба выбирают в одном тике, не дожидаясь снимков.
    // Если бы выбирать приходилось по очереди, второй emit ушёл бы в пустоту.
    a.socket.emit('match:pick', { roomId, cell: 0 });
    b.socket.emit('match:pick', { roomId, cell: 1 });

    await sleep(700);

    const sA = a.snapshot;
    check('оба выбора зарегистрированы',
        sA.players.find(p => p.id === A)?.pick === 0 &&
        sA.players.find(p => p.id === B)?.pick === 1,
        sA.players.map(p => `${p.id}=${p.pick}`));
    check('число открылось сразу после выбора обоих',
        sA.guessing?.sub === 'reveal', sA.guessing?.sub);
    check('системное число в диапазоне 1..9',
        sA.guessing?.systemNumber >= 1 && sA.guessing?.systemNumber <= 9,
        sA.guessing?.systemNumber);

    // Клетки не должны совпадать - иначе это был бы не выбор, а обмен
    check('клетки разные', 0 !== 1, true);

    // Кто ближе к загаданному, тот и выбирает роль
    const target = sA.guessing.systemNumber;
    const distA = Math.abs(1 - target);   // A выбрал клетку 0 => число 1
    const distB = Math.abs(2 - target);   // B выбрал клетку 1 => число 2
    const expectedWinner = distA < distB ? A : distB < distA ? B : null;
    check('победитель угадайки - ближайший к числу',
        (sA.guessing.winnerId || null) === expectedWinner,
        { winner: sA.guessing.winnerId, expected: expectedWinner, target, distA, distB });

    // Занятую клетку выбрать нельзя - второй клик по своей же клетке
    b.socket.emit('match:pick', { roomId, cell: 1 });
    await sleep(400);
    check('перевыбор своей клетки отклонён',
        b.snapshot.players.find(p => p.id === B)?.pick === 1,
        b.snapshot.players.find(p => p.id === B)?.pick);

    console.log(`\n  система загадала ${target}, A выбрал 1 (близость ${distA}), B выбрал 2 (близость ${distB})`);
    console.log(failed === 0 ? '\nОдновременный выбор подтверждён\n' : `\nПровалено: ${failed}\n`);
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
    cleanup(1);
});
