/**
 * Интеграционная проверка сетевого матча между двумя людьми.
 * Полный цикл: вызов -> принятие -> угадайка -> роли -> ходы -> очки ->
 * финал -> реванш. Проверяем главное: оба сокета видят одинаковое состояние.
 *
 * Запуск: node test-online.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

// SERVER_URL позволяет прогнать тот же сценарий против прода:
//   $env:SERVER_URL='https://mypoddomenjm.mooo.com'; node test-online.js
const URL = process.env.SERVER_URL || 'http://localhost:3000';
const A = 'oa' + Math.floor(Math.random() * 100000);
const B = 'ob' + Math.floor(Math.random() * 100000);
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

/** Снимок в сравнимом виде: всё, что должно совпадать у обоих игроков. */
function shape(s) {
    if (!s) return null;
    return JSON.stringify({
        roomId: s.roomId,
        phase: s.phase,
        round: s.round,
        board: s.board,
        scores: s.players.map(p => `${p.username}:${p.score}:${p.mark}:${p.isAttacker}`),
        currentMark: s.currentMark,
        result: s.result || null
    });
}

function makeClient(username) {
    const sock = io(URL, { transports: ['websocket'] });
    const state = {
        username,
        token: null,
        socket: sock,
        snapshot: null,
        lastMessage: null,
        challenge: null,
        rematchFrom: null,
        online: null,
        // захват первого снимка после запроса capture
        capture: false,
        captured: null,
        // состояние для сравнения сокета с соперником
        diff: null,
        error: null
    };

    sock.on('connect_error', e => { state.error = 'connect_error: ' + e.message; });

    sock.on('onlineUsersUpdate', data => { state.online = data.online; });

    sock.on('challengeReceived', data => { state.challenge = data; });

    sock.on('rematchRequested', data => { state.rematchFrom = data.from; });

    sock.on('rematchDeclined', data => { state.rematchDeclined = data.by; });

    sock.on('match:state', msg => {
        state.snapshot = msg.snapshot;
        state.lastMessage = msg;
        // Первый снимок после запроса capture: тест играет мгновенно, и к
        // моменту проверки матч уже успевает уйти вперёд
        if (state.capture) {
            state.captured = shape(msg.snapshot);
            state.capture = false;
        }
        act(state);
    });

    return state;
}

/**
 * Играет за клиента: выбирает число, берёт роль атакующего и ходит.
 * Стратегия: атакующий берёт 0,1,2 - это даёт победу за 3 хода,
 * поэтому матч заканчивается быстро и детерминированно.
 */
function act(state) {
    const s = state.snapshot;
    if (!s) return;
    const me = s.players.find(p => p.id === state.username);
    if (!me) return;

    if (s.phase === 'guessing' && s.guessing?.sub === 'picking' && me.pick === null) {
        const taken = s.players.map(p => p.pick).filter(v => v !== null);
        const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(i => !taken.includes(i));
        if (free !== undefined) state.socket.emit('match:pick', { roomId: s.roomId, cell: free });
        return;
    }

    if (s.phase === 'roleChoice' && s.guessing?.winnerId === state.username) {
        state.socket.emit('match:role', { roomId: s.roomId, attack: true });
        return;
    }

    if (s.phase === 'playing' && s.currentMark === me.mark) {
        // Защитник берёт последнюю свободную клетку и не мешает атакующему
        const free = me.mark === 'X' ? firstFree(s) : lastFree(s);
        if (free >= 0) state.socket.emit('match:move', { roomId: s.roomId, cell: free });
    }
}

const firstFree = s => s.board.findIndex(c => c === '');
const lastFree = s => s.board.reduce((acc, c, i) => (c === '' ? i : acc), -1);

async function register(username) {
    const res = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json());
    if (res.token) return res.token;
    // Уже существует - логинимся
    const login = await fetch(`${URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    }).then(r => r.json());
    return login.token;
}

const timer = setTimeout(() => {
    console.log('\n  ТАЙМАУТ: сценарий не завершился за 60 секунд');
    console.log('  alpha: ' + shape(a.snapshot));
    console.log('  beta:  ' + shape(b.snapshot));
    a.socket.close();
    b.socket.close();
    process.exit(1);
}, 60000);

let a, b;

async function waitFor(fn, ms, label) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await sleep(50);
    }
    check(label, false, 'не дождались');
    return false;
}

async function main() {
    console.log(`\nСетевой матч: ${A} против ${B}`);

    a = makeClient(A);
    b = makeClient(B);
    await waitFor(() => a.snapshot === null && a.socket.connected && b.socket.connected, 8000,
        'оба сокета подключены');

    a.token = await register(A);
    b.token = await register(B);
    a.socket.emit('userOnline', { username: A });
    b.socket.emit('userOnline', { username: B });

    // --- список онлайна ---
    await waitFor(() => a.online && b.online, 5000, 'список онлайна получен');
    check('alpha видит бета в онлайне',
        a.online.some(u => u.username === B), a.online);
    check('beta видит alpha в онлайне',
        b.online.some(u => u.username === A), b.online);
    check('у игроков есть рейтинг',
        a.online.every(u => typeof u.rating === 'number'));
    check('никто не в матче', a.online.every(u => !u.inMatch), a.online);

    // --- вызов ---
    const sent = await fetch(`${URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ targetUsername: B })
    }).then(r => r.json());
    check('вызов принят сервером', sent.success === true, sent);

    await waitFor(() => b.challenge, 5000, 'beta получил вызов');
    check('в вызове указан alpha', b.challenge && b.challenge.from === A, b.challenge);

    // --- принятие запускает матч у обоих ---
    const accepted = await fetch(`${URL}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}` },
        body: JSON.stringify({ challengeId: b.challenge.challengeId })
    }).then(r => r.json());
    check('принятие вернуло roomId', !!accepted.roomId, accepted);

    await waitFor(() => a.snapshot && b.snapshot &&
        a.snapshot.phase !== 'finished' && b.snapshot.phase !== 'finished', 8000,
        'матч начался у обоих');

    check('у обоих одна комната', a.snapshot.roomId === b.snapshot.roomId,
        { a: a.snapshot.roomId, b: b.snapshot.roomId });
    check('в матче двое людей',
        a.snapshot.players.length === 2 && a.snapshot.players.every(p => !p.isBot),
        a.snapshot.players);
    check('сокеты видят одинаковое состояние', shape(a.snapshot) === shape(b.snapshot),
        { a: shape(a.snapshot), b: shape(b.snapshot) });

    // --- матч доигрывается сам ---
    const done = await waitFor(() =>
        a.snapshot?.phase === 'finished' && b.snapshot?.phase === 'finished', 40000,
        'матч доигран до финала');
    if (!done) { cleanup(); return; }

    check('оба видят один результат', shape(a.snapshot) === shape(b.snapshot),
        { a: shape(a.snapshot), b: shape(b.snapshot) });
    check('победитель определён', !!a.snapshot.result?.winnerId ||
        a.snapshot.result?.type === 'cancelled', a.snapshot.result);
    check('у кого-то 5 очков',
        Math.max(...a.snapshot.players.map(p => p.score)) >= 5,
        a.snapshot.players.map(p => p.username + '=' + p.score));
    check('очки совпадают у обоих',
        a.snapshot.players.map(p => p.score).join() ===
        b.snapshot.players.map(p => p.score).join());

    console.log('  счёт: ' + a.snapshot.players.map(p => `${p.username}=${p.score}`).join('  '));
    console.log('  результат: ' + JSON.stringify(a.snapshot.result));

    // --- после финала игроки свободны для вызова ---
    await waitFor(() => a.online && a.online.every(u => !u.inMatch), 5000,
        'после финала оба свободны');

    // --- реванш ---
    const oldRoom = a.snapshot.roomId;
    a.socket.emit('match:rematch');
    await waitFor(() => b.rematchFrom, 5000, 'beta получил предложение реванша');
    check('реванш предложен от alpha', b.rematchFrom === A, b.rematchFrom);

    // --- отказ от реванша: проверяем ДО успешного, иначе новый матч
    //     успевает доиграться и запрос уйдёт уже не туда
    b.socket.emit('match:rematch');
    await waitFor(() => a.rematchFrom, 5000, 'alpha получил запрос реванша');
    a.socket.emit('match:rematchResponse', { from: B, accept: false });
    await waitFor(() => b.rematchDeclined, 5000, 'beta получил отказ');
    check('отказ дошёл до инициатора', b.rematchDeclined === A, b.rematchDeclined);
    check('после отказа матч не изменился',
        a.snapshot.roomId === oldRoom && b.snapshot.roomId === oldRoom,
        { a: a.snapshot.roomId, b: b.snapshot.roomId });

    // --- принятый реванш ---
    a.socket.emit('match:rematch');
    await waitFor(() => b.rematchFrom && b.rematchFrom === A, 5000,
        'beta получил предложение реванша');

    // Ловим именно первый снимок нового матча: дальше тест играет мгновенно
    a.capture = true;
    b.capture = true;
    b.socket.emit('match:rematchResponse', { from: A, accept: true });
    await waitFor(() => a.captured && b.captured, 8000, 'новый матч начался');

    const A0 = JSON.parse(a.captured);
    const B0 = JSON.parse(b.captured);
    check('реванш создал новую комнату', A0.roomId !== oldRoom, { old: oldRoom, now: A0.roomId });
    check('после реванша сокеты синхронны', a.captured === b.captured,
        { a: a.captured, b: b.captured });
    check('после реванша счёт обнулён', A0.scores.every(s => s.split(':')[1] === '0'), A0.scores);
    check('после реванша раунд 1 и угадайка',
        A0.round === 1 && A0.phase === 'guessing', { round: A0.round, phase: A0.phase });
    check('доска чистая', A0.board.every(c => c === ''), A0.board);

    console.log(failed === 0 ? '\nСетевой матч пройден\n' : `\nПровалено: ${failed}\n`);
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
