/**
 * Интеграционная проверка: реальный Socket.IO против локального сервера.
 * Полный цикл матча с ботом: угадайка -> роли -> ходы -> очки -> финал.
 * Запуск: node test-integration.js   (сервер должен быть запущен на :3000)
 */

const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
const USERNAME = 'itest' + Math.floor(Math.random() * 100000);
const MAX_MOVES = 60;

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const socket = io(URL, { transports: ['websocket'] });
let snapshot = null;
let moveCount = 0;
const seenTypes = new Set();
let finished = false;

const timer = setTimeout(() => {
    console.log('\n  ТАЙМАУТ: матч не завершился за 40 секунд');
    console.log('  последняя фаза: ' + (snapshot ? snapshot.phase : 'нет данных'));
    socket.close();
    process.exit(1);
}, 40000);

function me() {
    return snapshot ? snapshot.players.find(p => !p.isBot) : null;
}

function freeCell() {
    return snapshot.board.findIndex(c => c === '');
}

// Ходим, если очередь наша
function playIfMyTurn() {
    if (!snapshot || snapshot.phase !== 'playing') return;
    const m = me();
    if (!m || snapshot.currentMark !== m.mark) return;
    const cell = freeCell();
    if (cell < 0) return;
    moveCount++;
    if (moveCount > MAX_MOVES) return;
    socket.emit('match:move', { roomId: snapshot.roomId, cell });
}

socket.on('connect', async () => {
    console.log(`\nСокет подключён. Тестовый игрок: ${USERNAME}`);
    const reg = await fetch(`${URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: 'pass1234' })
    }).then(r => r.json());

    if (!reg.token) {
        console.log('  FAIL регистрация не удалась: ' + JSON.stringify(reg));
        process.exit(1);
    }
    console.log('  зарегистрирован');
    socket.emit('userOnline', { username: USERNAME });
    await sleep(300);
    socket.emit('match:startBot');
});

socket.on('match:state', async (msg) => {
    snapshot = msg.snapshot;
    seenTypes.add(msg.type);
    const g = snapshot.guessing;

    switch (msg.type) {
        case 'guessStart':
            check('угадайка в 1 раунде', snapshot.phase === 'guessing' && snapshot.round === 1);
            check('доска чистая', snapshot.board.every(c => c === ''));
            check('числа 1..9', snapshot.cellNumbers.join(',') === '1,2,3,4,5,6,7,8,9');
            check('счёт 0:0', snapshot.players.every(p => p.score === 0));
            break;

        case 'guessOpen':
            check('окно выбора открыто', g.sub === 'picking');
            check('бот выбрал мгновенно',
                snapshot.players.find(p => p.isBot).pick !== null);
            {
                const taken = snapshot.players.map(p => p.pick).filter(v => v !== null);
                const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(i => !taken.includes(i));
                socket.emit('match:pick', { roomId: snapshot.roomId, cell: free });
            }
            break;

        case 'guessReveal':
            check('число в диапазоне 1..9',
                g.systemNumber >= 1 && g.systemNumber <= 9, g.systemNumber);
            if (g.winnerId) {
                check('победитель угадайки есть', !!g.winnerId);
                if (g.winnerId === me().id) {
                    socket.emit('match:role', { roomId: snapshot.roomId, attack: true });
                }
                // иначе сервер сам выберет роль по таймауту (15 сек)
            }
            break;

        case 'roundStart':
            check('фаза playing', snapshot.phase === 'playing');
            check('атакующий играет X', me().isAttacker === (me().mark === 'X'));
            playIfMyTurn();
            break;

        case 'move':
            playIfMyTurn();
            break;

        case 'roundEnd': {
            const gain = msg.extra.gainA + msg.extra.gainD;
            check('очки начислены за раунд', gain > 0, msg.extra);
            const expected = msg.extra.outcome === 'attacker' ? 2
                : msg.extra.outcome === 'defender' ? 3 : 1;
            check(`очки по правилу (${msg.extra.outcome}) = ${expected}`, gain === expected);
            break;
        }

        case 'finish':
            finish();
            break;
    }
});

function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);

    check('матч завершён', snapshot.phase === 'finished');
    check('результат есть', !!snapshot.result);
    check('победитель определён',
        snapshot.result.type === 'cancelled' || !!snapshot.result.winnerId, snapshot.result);
    check('у кого-то есть 5 очков',
        Math.max(...snapshot.players.map(p => p.score)) >= 5,
        snapshot.players.map(p => p.score));

    console.log('\nСобытия: ' + [...seenTypes].join(', '));
    console.log('Результат: ' + JSON.stringify(snapshot.result));
    console.log('Счёт: ' + snapshot.players.map(p => `${p.username}=${p.score}(${p.mark})`).join('  '));
    console.log(failed === 0 ? '\nИнтеграция пройдена\n' : `\nПровалено: ${failed}\n`);
    socket.close();
    process.exit(failed === 0 ? 0 : 1);
}

socket.on('connect_error', e => {
    console.log('\n  FAIL не удалось подключиться: ' + e.message);
    clearTimeout(timer);
    process.exit(1);
});
