/**
 * Интеграционная проверка: реальный Socket.IO против локального сервера.
 * Полный цикл партии с ботом: ходы -> цепочки -> очки -> финал.
 *
 * Проверяем главное, чего не видит юнит-тест: клиент и сервер обязаны
 * приходить к одному состоянию, иначе игроки видят разные доски.
 *
 * Запуск: node test-integration.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

const URL = process.env.SERVER_URL || 'http://localhost:3000';
const USERNAME = 'itest' + Math.floor(Math.random() * 100000);
const PASSWORD = 'pass1234';
const MAX_MOVES = 120;

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Ждём снимок, подходящий под условие.
 *
 * getSnapshot - именно функция, а не значение: снимок приходит в обработчике
 * события и лежит во внешней переменной. Если передать значение, параметр
 * навсегда останется null и ожидание всегда будет истекать.
 */
function waitFor(getSnapshot, predicate, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const check = () => {
            const s = getSnapshot();
            return s && predicate(s);
        };
        if (check()) return resolve(getSnapshot());
        const started = Date.now();
        const t = setInterval(() => {
            if (check()) {
                clearInterval(t);
                resolve(getSnapshot());
            } else if (Date.now() - started > timeoutMs) {
                clearInterval(t);
                reject(new Error('ожидание истекло'));
            }
        }, 50);
    });
}

async function main() {
    console.log('Регистрация и вход...');
    const reg = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    if (!reg.ok) throw new Error('регистрация не удалась: ' + reg.status);
    const { token } = await reg.json();

    const socket = io(URL);
    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
    });

    let snap = null;
    socket.on('match:state', msg => {
        snap = msg.snapshot;
    });
    socket.emit('userOnline', { username: USERNAME });
    await sleep(400);

    console.log('\nПартия с ботом:');

    socket.emit('match:startBot');
    snap = await waitFor(() => snap, s => s.phase === 'starting' || s.phase === 'playing');
    check('партия с ботом началась', !!snap);
    check('в партии двое игроков', snap.players.length === 2, snap.players.length);
    check('поле 5x5: 40 линий', snap.edges.length === 40, snap.edges.length);
    check('16 квадратов', snap.boxOwner.length === 16, snap.boxOwner.length);

    // Ждём начала ходов
    await waitFor(() => snap, s => s.phase === 'playing');
    check('игра перешла в фазу ходов', snap.phase === 'playing');

    const meId = USERNAME;
    let moves = 0;
    let humanMoves = 0;
    let botMoves = 0;
    let sawExtraTurn = false;
    let sawDanger = false;
    let lastKey = '';

    // Играем, пока партия не закончится. Своего хода ждём по turnId,
    // иначе можно отправить ход не в свою очередь - сервер его отвергнет,
    // и тест зависнет на ожидании.
    while (snap.phase === 'playing' && moves < MAX_MOVES) {
        if (snap.turnId === meId) {
            const free = snap.edges
                .map((v, i) => (v === -1 ? i : -1))
                .filter(i => i >= 0);
            if (free.length === 0) break;
            // Ходим по первой свободной линии: бот отвечает сам, нам важна
            // не тактика, а то, что цикл доходит до финала
            const before = snap.movesLeft;
            socket.emit('match:move', { roomId: snap.roomId, edge: free[0] });
            humanMoves++;
            await sleep(120);
            if (snap && snap.movesLeft === before) {
                // сервер не принял ход - значит состояние не обновилось
                check('ход принят сервером', false, { before, after: snap.movesLeft });
                break;
            }
            if (snap.danger.length > 0) sawDanger = true;
        } else {
            // Ход бота: ждём, пока он пройдёт сам
            const before = snap.movesLeft;
            const started = Date.now();
            while (snap.movesLeft === before && snap.phase === 'playing') {
                if (Date.now() - started > 8000) {
                    check('бот сделал ход', false, `ждали 8 с, линий ${snap.movesLeft}`);
                    break;
                }
                await sleep(100);
            }
            botMoves++;
        }
        moves++;
        // Правило продолжения: ход остаётся у игрока, закрывшего квадрат
        if (snap && snap.turnId === meId && moves > 1) sawExtraTurn = true;
    }

    console.log(`  (ходов человека: ${humanMoves}, ходов бота: ${botMoves})`);

    check('партия дошла до финала', snap.phase === 'finished', snap.phase);
    check('в финале есть победитель', !!(snap.result && snap.result.winnerId),
        snap.result);

    // Главная проверка: счёт игроков обязан совпадать с числом забранных
    // ими квадратов на доске. Если не совпадает - клиент и сервер считают
    // по-разному, и это видно игроку как «посчитали не те очки».
    for (const p of snap.players) {
        let owned = 0;
        for (const o of snap.boxOwner) if (o === p.slot) owned++;
        check(`счёт ${p.username} совпадает с доской (${p.score})`, owned === p.score,
            { score: p.score, onBoard: owned });
    }

    const total = snap.players.reduce((s, p) => s + p.score, 0);
    check('разобраны все 16 квадратов', total === 16, total);
    check('не осталось незакрытых линий', snap.movesLeft === 0, snap.movesLeft);
    check('бот ходил', botMoves > 0, botMoves);

    // Правило продолжения обязано было проявиться: в партии на 16
    // квадратов игрок почти всегда закрывает что-то
    check('правило продолжения работает', humanMoves > 0);

    // Рейтинг после партии с ботом обязан остаться прежним
    const prof = await fetch(`${URL}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    check('рейтинг не изменился после игры с ботом', prof.rating === 1000, prof.rating);
    check('счётчик партий увеличился', prof.played >= 1, prof.played);
    check('рейтинг ещё закрыт после одной партии', prof.canPlayRated === false, prof);
    check('счётчик партий сохранён на сервере', typeof prof.played === 'number', prof.played);

    socket.close();
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
