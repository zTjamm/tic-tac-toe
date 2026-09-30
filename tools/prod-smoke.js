/**
 * Дымовой тест боевого сервера.
 *
 * Проверяет то, чего не видно на локальной копии: что прод отдаёт свежую
 * сборку и что игровая логика работает через nginx и вебсокеты. Каждая
 * часть поднимает настоящих игроков и играет по-настоящему.
 *
 * Запуск:
 *   npm run test:prod              - все части подряд
 *   npm run test:prod -- 2         - только вторая часть
 *   npm run test:prod -- all
 *
 * Части:
 *   1 - доступность и API
 *   2 - партия двух людей: подбор, правило продолжения, итоги, рейтинг
 *   3 - бот и разблокировка рейтинговых игр после трёх партий
 *   4 - таймаут хода: сервер ходит сам и не ставит страйк
 *   5 - чат
 *
 * ВНИМАНИЕ: тест регистрирует настоящие аккаунты на боевом сервере, и они
 * попадают в общий список онлайн, а выигравшие - в таблицу рейтинга.
 * Все имена начинаются с SM_PREFIX, их можно удалить одним движением:
 *
 *   node tools/clean-test-accounts.js --path users.json
 *
 * Список созданных имён пишется в tools/.sm-accounts (в репозиторий не
 * попадает). Свой сервер можно указать переменной SERVER_URL.
 */
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const URL = process.env.SERVER_URL || 'https://mypoddomenjm.mooo.com';
const SM_PREFIX = 'sm_';
const ACCOUNTS_FILE = path.join(__dirname, '.sm-accounts');
const arg = process.argv[2] || 'all';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, info) => {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
};

const created = [];
const uniq = () => SM_PREFIX + Math.floor(Math.random() * 1e6);

async function api(route, body, token) {
    const r = await fetch(URL + route, {
        method: body ? 'POST' : 'GET',
        headers: {
            'Content-Type': 'application/json',
            // Заголовки HTTP - это latin1, кириллица в токене вызывает
            // TypeError на стороне Node, поэтому значения здесь только ASCII
            ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, data: await r.json().catch(() => null) };
}

async function makeUser() {
    const username = uniq();
    let r = await api('/api/register', { username, password: 'pass1234' });
    if (r.status !== 200 || !r.data || !r.data.token) {
        r = await api('/api/login', { username, password: 'pass1234' });
    }
    if (!r.data || !r.data.token) throw new Error('не удалось завести игрока ' + username);
    created.push(username);
    return { username, token: r.data.token, user: r.data.user };
}

/** Подключение игрока: сокет плюс свежий снимок партии. */
async function connect(u) {
    const socket = io(URL, { transports: ['websocket', 'polling'] });
    const state = { snap: null, roomId: null, events: [] };
    await new Promise((res, rej) => {
        socket.on('connect', res);
        socket.on('connect_error', rej);
        setTimeout(() => rej(new Error('не подключился ' + u.username)), 15000);
    });
    socket.on('match:state', m => {
        state.events.push(m.type);
        state.snap = m.snapshot;
        if (!state.roomId && m.snapshot && m.snapshot.roomId) state.roomId = m.snapshot.roomId;
    });
    socket.on('search:state', s => { state.search = s; });
    socket.on('challengeReceived', c => { state.challenge = c; });
    socket.on('challengeExpired', c => { state.expired = c; });
    socket.on('challengeDeclined', c => { state.declined = c; });
    socket.on('challengeWithdrawn', () => { state.withdrawn = true; });
    socket.on('match:exit', c => { state.exited = c; });
    socket.emit('userOnline', { username: u.username });
    await sleep(600);
    socket.emit('match:sync');
    await sleep(600);
    return { socket, state, u };
}

const freeEdges = snap => snap.edges.map((v, i) => (v === -1 ? i : -1)).filter(i => i >= 0);

/** Кто владеет квадратом box - по номеру слота. */
function byIdSlot(snap, slot) {
    if (slot === undefined || slot < 0) return null;
    const p = snap.players.find(x => x.slot === slot);
    return p ? p.id : null;
}

/** Сколько квадратов закроет линия. Нужно, чтобы проверять право ходить дальше. */
function closesBox(snap, edge) {
    const SPAN = 4, H = 20;
    const r = edge < H ? Math.floor(edge / SPAN) : null;
    const c = edge < H ? edge % SPAN : Math.floor((edge - H) / SPAN);
    const rr = edge < H ? r : (edge - H) % SPAN;
    const boxes = edge < H ? [[r, c], [r - 1, c]] : [[rr, c], [rr, c - 1]];
    let n = 0;
    for (const [br, bc] of boxes) {
        if (br < 0 || br > 3 || bc < 0 || bc > 3) continue;
        if (snap.boxOwner[br * SPAN + bc] !== -1) continue;
        const sides = [br * SPAN + bc, (br + 1) * SPAN + bc, H + bc * SPAN + br, H + (bc + 1) * SPAN + br];
        if (sides.filter(s => s !== edge && snap.edges[s] !== -1).length === 3) n++;
    }
    return n;
}

/** Стараемся закрыть квадрат: только так правило продолжения и проверяется. */
function chooseEdge(snap) {
    const free = freeEdges(snap);
    if (!free.length) return null;
    const scoring = free.filter(e => closesBox(snap, e) > 0);
    return scoring.length ? scoring[0] : free[Math.floor(Math.random() * free.length)];
}

/**
 * Одна партия с ботом до финала.
 *
 * Важно: после match:leave сокет остаётся в комнате, и в state.snap ещё
 * лежит снимок только что закончившейся партии. Если просто ждать phase
 * 'finished', цикл сразу найдёт старый снимок и решит, что партия уже
 * кончилась, - новая при этом даже не начнётся. Поэтому партия опознаётся
 * по смене roomId, а не по фазе.
 */
async function playBotGame(c, u, label = '') {
    const prevRoom = c.state.roomId;
    c.state.snap = null;
    c.socket.emit('match:startBot');

    let guard = 0, myRoom = null;
    while (guard++ < 400) {
        const s = c.state.snap;
        if (!s) { await sleep(100); continue; }
        if (!myRoom && s.roomId && s.roomId !== prevRoom) {
            myRoom = s.roomId;
            if (label) console.log(`    ${label}: комната ${myRoom}`);
        }
        if (!myRoom) { await sleep(100); continue; }
        if (s.phase === 'finished') {
            if (label) console.log(`    ${label}: финал ${s.players.map(p => p.score).join(':')}`);
            return true;
        }
        if (s.phase === 'playing' && s.turnId === u.username) {
            const e = chooseEdge(s);
            if (e !== null) c.socket.emit('match:move', { roomId: s.roomId, edge: e });
        }
        await sleep(85);
    }
    const s = c.state.snap;
    console.log(`    ${label}: не доиграл; комната ${myRoom}, фаза ${s && s.phase}`);
    return false;
}

/**
 * Рейтинговые игры открываются после трёх партий, и match:find без них
 * честно отказывает. Набираем эти три партии ботом - тем же путём, которым
 * игрок разблокирует себя в жизни.
 */
async function unlock(c, u, n = 3) {
    for (let i = 0; i < n; i++) {
        if (!await playBotGame(c, u, 'игра ' + (i + 1))) return false;
        c.socket.emit('match:leave');
        await sleep(1000);
        c.state.snap = null;
    }
    return true;
}

/* ------------------------------------------------------------------ 1 */
async function part1() {
    console.log('часть 1: доступность и API');
    const page = await fetch(URL + '/');
    const html = await page.text();
    check('главная отдаётся 200', page.status === 200, page.status);
    check('отдаётся наш клиент',
        html.includes('Точки и квадраты') || html.includes('assets/index'), html.slice(0, 60));

    const cssHref = (html.match(/href="\/assets\/([^"]+\.css)"/) || [])[1];
    check('есть ссылка на CSS', !!cssHref, cssHref);
    if (cssHref) {
        const css = await (await fetch(URL + '/assets/' + cssHref)).text();
        // Без этого правила длинный текст распирает контейнер и доска
        // прыгает вправо на 119 пикселей - ловим сразу, до жалоб
        check('в CSS есть min-width:0 у .container',
            /\.container\{[^}]*min-width:0/.test(css), cssHref);
    }
    const jsHref = (html.match(/src="\/assets\/([^"]+\.js)"/) || [])[1];
    if (jsHref) {
        const js = await (await fetch(URL + '/assets/' + jsHref)).text();
        check('свежая сборка на сервере', js.includes('chain-warning'), 'в JS нет chain-warning');
    }

    const u = await makeUser();
    check('регистрация выдаёт токен', !!u.token);
    const me = await api('/api/profile', null, u.token);
    check('профиль отвечает', me.status === 200 && me.data.username === u.username, me.status);
    check('новый игрок: партий 0', (me.data.played || 0) === 0, me.data.played);
    check('новый игрок: рейтинг 1000', me.data.rating === 1000, me.data.rating);
    check('рейтинговые игры закрыты при 0 партиях', me.data.canPlayRated === false, me.data.canPlayRated);
    check('без токена профиль не отдаётся', (await api('/api/profile', null, 'invalid-token-000')).status === 401);

    const lb = await api('/api/leaderboard');
    check('таблица рейтинга отвечает',
        lb.status === 200 && Array.isArray(lb.data) && lb.data.length > 0, lb.status);
    if (Array.isArray(lb.data) && lb.data.length) {
        check('таблица отсортирована по рейтингу',
            lb.data.every((r, i) => i === 0 || lb.data[i - 1].rating >= r.rating),
            lb.data.slice(0, 3).map(r => r.rating));
    }
    check('список онлайн отвечает', (await api('/api/online')).status === 200);
    check('история чата отвечает',
        (await api('/api/chat-history')).data instanceof Array);
    check('неверный пароль отклонён', [400, 401].includes(
        (await api('/api/login', { username: u.username, password: 'wrong-pass' })).status));
}

/* ------------------------------------------------------------------ 2 */
async function part2() {
    console.log('часть 2: партия двух людей, продолжение, итоги, рейтинг');
    const A = await makeUser();
    const B = await makeUser();
    const a = await connect(A);
    const b = await connect(B);

    a.socket.emit('match:find');
    await sleep(900);
    check('подбор закрыт до трёх партий и объясняет причину',
        a.state.search && a.state.search.status === 'done' && a.state.search.reason === 'locked',
        a.state.search);
    a.socket.emit('match:findCancel');
    await sleep(500);

    const okA = await unlock(a, A);
    const okB = await unlock(b, B);
    check('оба набрали три партии с ботом', okA && okB, { okA, okB });
    const profA = (await api('/api/profile', null, A.token)).data;
    check('рейтинговые игры открылись после трёх партий',
        profA.canPlayRated === true && profA.played >= 3,
        { played: profA.played, can: profA.canPlayRated });

    a.socket.emit('match:find');
    await sleep(400);
    b.socket.emit('match:find');

    // Ждём именно живую партию: одна комната у обоих, фаза playing и ни
    // одного бота. Иначе можно поймать хвост от партии с ботом - он остаётся
    // в снимке и выглядит как свежая партия.
    const live = () => a.state.snap && b.state.snap
        && a.state.snap.phase === 'playing'
        && !a.state.snap.players.some(p => p.isBot)
        && a.state.snap.roomId === b.state.snap.roomId;
    let waited = 0;
    while (waited < 25000 && !live()) { await sleep(400); waited += 400; }

    const snapA = a.state.snap;
    check('два ищущих состыковались напрямую', !!snapA && snapA.phase === 'playing',
        snapA && { phase: snapA.phase });
    if (!snapA || snapA.phase !== 'playing') { a.socket.close(); b.socket.close(); return; }
    check('соперник настоящий, а не бот', !snapA.players.some(p => p.isBot),
        snapA.players.map(p => p.username));

    check('поле 5x5: 40 линий', snapA.totalEdges === 40 && snapA.edges.length === 40, snapA.totalEdges);
    check('квадратов 16', snapA.totalBoxes === 16 && snapA.boxOwner.length === 16, snapA.totalBoxes);
    check('тайминг хода 15 секунд', snapA.timing.turn === 15000, snapA.timing.turn);
    check('в партии двое', snapA.players.length === 2, snapA.players.length);
    check('ход отдан одному из двоих', [a.state.snap.turnId, b.state.snap.turnId].includes(snapA.turnId));
    check('счёт пуст', snapA.players.every(p => p.score === 0), snapA.players.map(p => p.score));

    // Играем до финала. Снимок берём с одного сокета, а ход шлём от того,
    // чей сейчас ход: если брать снимок с обоих, легко отправить ход по
    // устаревшему состоянию, сервер его отвергнет, и партия не сдвинется.
    let captures = 0, continuations = 0, guard = 0;
    let prevCount = -1, idle = 0, expectCont = false;
    while (guard++ < 900) {
        const s = a.state.snap;
        if (!s) { await sleep(140); continue; }
        if (s.phase === 'finished') break;
        if (s.phase !== 'playing') { await sleep(140); continue; }

        const count = s.edges.filter(v => v !== -1).length;
        if (count === prevCount) {
            idle++;
            await sleep(140);
            if (idle < 25) continue;
            const any = freeEdges(s)[0];
            if (any === undefined) { await sleep(200); continue; }
            console.log(`    застряли: линий ${count}, ход у ${s.turnId}, пробуем ${any}`);
            (s.turnId === A.username ? a : b).socket.emit('match:move', { roomId: s.roomId, edge: any });
            idle = 0;
            await sleep(200);
            continue;
        }
        // этот прирост - результат хода, который мы только что отправили
        if (expectCont && (s.lastGainedBoxes || []).length) {
            captures++;
            if (s.turnId === A.username) continuations++;
        }
        idle = 0;
        prevCount = count;

        if (s.turnId !== A.username && s.turnId !== B.username) { await sleep(140); continue; }
        const edge = chooseEdge(s);
        if (edge === null) { await sleep(140); continue; }
        expectCont = s.turnId === A.username && closesBox(s, edge) > 0;
        (s.turnId === A.username ? a : b).socket.emit('match:move', { roomId: s.roomId, edge });
        await sleep(150);
    }

    const fin = a.state.snap;
    check('партия доиграна до финала', fin && fin.phase === 'finished', fin && fin.phase);
    if (!fin || fin.phase !== 'finished') { a.socket.close(); b.socket.close(); return; }

    const drawn = fin.edges.filter(v => v !== -1).length;
    const claimed = fin.boxOwner.filter(v => v !== -1).length;
    const sum = fin.players.reduce((s, p) => s + p.score, 0);
    check('проведены все 40 линий', drawn === 40, drawn);
    check('разыграны все 16 квадратов', claimed === 16, claimed);
    check('счёт в сумме даёт 16', sum === 16, fin.players.map(p => p.score));
    check('счёт сходится с заливкой поля', claimed === sum, { claimed, sum });
    check('были взятия квадратов', captures > 0, captures);
    check('взятие даёт право ходить дальше', continuations > 0, { captures, continuations });

    const [pa, pb] = fin.players;
    if (pa.score === pb.score) {
        // 8:8 - законный исход: 16 квадратов делятся поровну. Побеждает тот,
        // кто забрал последний квадрат, поэтому сверяемся с последним взятием,
        // а не со счётом.
        check('ничья помечена как tiebreak', fin.result && fin.result.reason === 'tiebreak', fin.result);
        const last = fin.lastGainedBoxes || [];
        const ownerOfLast = last.length ? byIdSlot(fin, fin.boxOwner[last[last.length - 1]]) : null;
        check('победитель - забравший последний квадрат',
            !!fin.result && ownerOfLast !== null && fin.result.winnerId === ownerOfLast,
            { owner: ownerOfLast, winnerId: fin.result && fin.result.winnerId });
    } else {
        const top = pa.score > pb.score ? pa : pb;
        const low = pa.score > pb.score ? pb : pa;
        check('побеждает больший счёт', top.score > low.score,
            fin.players.map(p => ({ n: p.username, s: p.score })));
        check('исход помечен как score', fin.result && fin.result.reason === 'score', fin.result);
        check('победитель определён верно', fin.result && fin.result.winnerId === top.id,
            { winnerId: fin.result && fin.result.winnerId, expect: top.id });
    }

    const aPost = (await api('/api/profile', null, A.token)).data;
    const bPost = (await api('/api/profile', null, B.token)).data;
    check('рейтинг изменился у обоих', aPost.rating !== 1000 && bPost.rating !== 1000,
        { A: aPost.rating, B: bPost.rating });
    check('сыграно три партии с ботом плюс рейтинговая', aPost.played === 4 && bPost.played === 4,
        { A: aPost.played, B: bPost.played });
    check('у обоих записана история',
        (aPost.history || []).length >= 1 && (bPost.history || []).length >= 1);
    check('рейтинговые игры остаются открытыми', aPost.canPlayRated === true, aPost.canPlayRated);

    a.socket.close();
    b.socket.close();
    console.log(`  (итог ${fin.result.reason}: ` +
        fin.players.map(p => `${p.username} ${p.score}`).join(' : ') +
        `, рейтинг ${aPost.rating}:${bPost.rating})`);
}

/* ------------------------------------------------------------------ 3 */
async function part3() {
    console.log('часть 3: бот и разблокировка после трёх партий');
    const u = await makeUser();
    const c = await connect(u);

    const done = await unlock(c, u, 3);
    check('три партии с ботом доиграны', done, done);

    const after = (await api('/api/profile', null, u.token)).data;
    check('бот засчитан как партия', after.played === 3, after.played);
    check('после трёх партий рейтинг открыт', after.canPlayRated === true, after.canPlayRated);
    check('бот не двигает рейтинг', after.rating === 1000, after.rating);
    // Партии с ботом намеренно не идут в рекорд: onResult выходит рано, если
    // в паре есть бот, поэтому applyStats не вызывается вовсе - ни рейтинг, ни
    // победы и поражения. В played они засчитываются, иначе гейт на три
    // партии было бы не набрать, не сыграв с живым соперником.
    check('бот не пишет в рекорд побед и поражений',
        after.wins === 0 && after.losses === 0 && after.draws === 0,
        { w: after.wins, l: after.losses, d: after.draws });

    const again = await playBotGame(c, u, 'игра 4');
    check('ещё одна партия сыгралась', again, again);
    c.socket.emit('match:leave');
    await sleep(900);
    const after2 = (await api('/api/profile', null, u.token)).data;
    check('гейт не сбрасывается', after2.canPlayRated === true, after2.canPlayRated);
    check('рейтинг так и не сдвинулся от бота', after2.rating === 1000, after2.rating);
    c.socket.close();
}

/* ------------------------------------------------------------------ 4 */
async function part4() {
    console.log('часть 4: таймаут хода');
    const u = await makeUser();
    const c = await connect(u);
    c.socket.emit('match:startBot');

    let s, guard = 0;
    while (guard++ < 60) {
        s = c.state.snap;
        if (s && s.phase === 'playing') break;
        await sleep(200);
    }
    check('партия началась', s && s.phase === 'playing', s && s.phase);
    if (!s) { c.socket.close(); return; }

    const before = s.edges.filter(v => v !== -1).length;
    const bot = s.players.find(p => p.isBot);
    check('у бота нет страйков', !bot || bot.strikes === 0, bot && bot.strikes);

    // Молчим и ждём, пока сервер сходит за нас. Таймаут хода - не нарушение,
    // страйк за него не положен: это принципиальная часть правил.
    let elapsed = 0, moved = false;
    while (elapsed < 22000) {
        await sleep(1000);
        elapsed += 1000;
        const now = c.state.snap;
        if (now && now.edges.filter(v => v !== -1).length > before) { moved = true; break; }
    }
    check('после молчания сервер ходит сам', moved,
        c.state.snap && c.state.snap.edges.filter(v => v !== -1).length + ' против ' + before);

    const mine = c.state.snap.players.find(p => p.id === u.username);
    check('таймаут хода не считается страйком', mine && mine.strikes === 0, mine && mine.strikes);
    c.socket.close();
}

/* ------------------------------------------------------------------ 5 */
async function part5() {
    console.log('часть 5: чат');
    const A = await makeUser();
    const B = await makeUser();
    const a = await connect(A);
    const b = await connect(B);
    const text = 'проверка связи ' + Math.floor(Math.random() * 1e6);
    const got = new Promise(res => {
        b.socket.on('globalChatMessage', m => res(m));
        setTimeout(() => res(null), 10000);
    });
    a.socket.emit('sendGlobalChat', { text });
    const m = await got;
    check('сообщение дошло до другого игрока', !!m, m);
    if (m) {
        check('текст не искажён', m.text === text, m.text);
        check('указан автор', m.sender === A.username, m.sender);
        check('есть отметка времени', typeof m.timestamp === 'number' && m.timestamp > 0);
    }
    const hist = await api('/api/chat-history');
    check('сообщение сохранилось в истории',
        Array.isArray(hist.data) && hist.data.some(x => x.text === text));
    a.socket.close();
    b.socket.close();
}

const parts = { 1: part1, 2: part2, 3: part3, 4: part4, 5: part5 };
const order = arg === 'all' ? [1, 2, 3, 4, 5] : [Number(arg)];

if (order.some(n => !parts[n])) {
    console.error('часть должна быть 1..5 или all');
    process.exit(2);
}

(async () => {
    for (const n of order) {
        const before = failed;
        await parts[n]();
        console.log(failed === before
            ? `  -> часть ${n} чистая`
            : `  -> часть ${n}: провалено ${failed - before}`);
    }

    if (created.length) {
        // Список нужен для уборки: без него ищем по префиксу
        fs.writeFileSync(ACCOUNTS_FILE, created.join('\n') + '\n');
    }

    console.log('\n' + (failed === 0
        ? `все части чистые (${URL})`
        : `провалено проверок: ${failed}`));
    if (created.length) {
        console.log('создано аккаунтов: ' + created.length);
        console.log('уборка: node tools/clean-test-accounts.js --path users.json');
        console.log('список имён: ' + ACCOUNTS_FILE);
    }
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
    console.error('ОШИБКА:', e && e.message ? e.message : e);
    if (created.length) {
        console.log('созданы аккаунты: ' + created.join(', '));
    }
    process.exit(3);
});
