/**
 * Проверка того, ради чего вообще затевался том: аккаунт должен пережить
 * перезапуск сервера.
 *
 * Раньше users.json лежал рядом с кодом, и на проде файл жил в
 * файловой системе машины, которая останавливается при простое. Всё, что
 * туда записано, пропадало. Этот сценарий запускает сервер с DATA_DIR,
 * регистрирует игрока, убивает сервер, поднимает новый и проверяет, что
 * вход и рейтинг на месте.
 *
 * Запуск: node test-persistence.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PORT = 3111;
const BASE = `http://localhost:${PORT}`;
const USER = 'persist' + Math.floor(Math.random() * 100000);
const PASSWORD = 'pass1234';

let failed = 0;
function check(name, ok, info) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ждём, пока сервер начнёт отвечать. */
async function waitUp(timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const r = await fetch(`${BASE}/api/online`);
            if (r.ok) return true;
        } catch { /* ещё поднимается */ }
        await sleep(200);
    }
    return false;
}

function startServer(dataDir) {
    return spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
        stdio: 'ignore'
    });
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    const ended = new Promise(res => child.once('exit', res));
    child.kill('SIGTERM');
    await Promise.race([ended, sleep(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await sleep(700);
}

async function api(pathname, options) {
    const res = await fetch(`${BASE}${pathname}`, options);
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
    // Свежий «том»: никакого файла там нет, проверяем и запись, и посев
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dots-persist-'));
    const file = path.join(dataDir, 'users.json');
    console.log(`Каталог данных: ${dataDir}`);

    console.log('\nПервый запуск:');
    let server = startServer(dataDir);
    check('сервер поднялся', await waitUp());
    /* Посев: на пустом томе файл берётся из сборки. Проверяем, что он
       РОВНО скопирован, а не пустой: на сервере в сборке лежат настоящие
       аккаунты, и ожидание «пусто» там падало бы, хотя всё работает */
    const bundled = path.join(ROOT, 'users.json');
    const bundledData = fs.existsSync(bundled) ? JSON.parse(fs.readFileSync(bundled, 'utf8')) : {};
    const seeded = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    check('посев создал файл на томе', seeded !== null);
    check('посев скопировал файл из сборки целиком',
        seeded !== null && Object.keys(seeded).length === Object.keys(bundledData).length &&
        Object.keys(bundledData).every(k => seeded[k] !== undefined),
        { изСборки: Object.keys(bundledData).length, наТоме: seeded && Object.keys(seeded).length });

    const reg = await api('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASSWORD })
    });
    check('регистрация прошла', reg.status === 200, reg.body);
    check('файл появился на томе', fs.existsSync(file));
    check('в файле есть зарегистрированный игрок',
        fs.existsSync(file) && !!JSON.parse(fs.readFileSync(file, 'utf8'))[USER]);
    const token = reg.body && reg.body.token;

    console.log('\nПерезапуск сервера:');
    await stopServer(server);
    check('файл на томе пережил остановку', fs.existsSync(file));

    server = startServer(dataDir);
    check('сервер поднялся снова', await waitUp());

    // Сессии живут в памяти, поэтому токен после перезапуска недействителен.
    // Это ожидаемо: проверяем, что САМ аккаунт уцелел
    const stale = await api('/api/profile', { headers: { Authorization: `Bearer ${token}` } });
    check('старый токен не прошёл (сессии в памяти)', stale.status === 401, stale.status);

    const login = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASSWORD })
    });
    check('вход после перезапуска удался', login.status === 200, login.body);
    check('рейтинг сохранился',
        login.body && login.body.user && login.body.user.rating === 1000,
        login.body && login.body.user);

    console.log('\nВторой перезапуск, чтобы убедиться, что посев не перетирает данные:');
    await stopServer(server);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('аккаунт всё ещё в файле', !!onDisk[USER], Object.keys(onDisk));

    server = startServer(dataDir);
    check('сервер поднялся в третий раз', await waitUp());
    const login2 = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASSWORD })
    });
    check('аккаунт уцелел после двух перезапусков', login2.status === 200, login2.status);

    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
}

main()
    .then(() => {
        console.log(failed === 0 ? '\nДанные переживают перезапуск' : `\nПровалено: ${failed}`);
        process.exit(failed === 0 ? 0 : 1);
    })
    .catch(e => {
        console.error('\nОшибка теста:', e.message);
        process.exit(1);
    });
