/**
 * Проверка хранения пользователей.
 *
 * Модуль вынесен отдельно не для красоты: на проде файл лежит на томе,
 * и ошибка здесь стоит не «тест упал», а «после деплоя у всех пропали
 * аккаунты». Поэтому проверяем то, что на проде и ломается: путь через
 * DATA_DIR, посев с тома, атомарность записи и поведение при битом файле.
 *
 * Запуск: node test-store.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail) {
    if (ok) {
        passed++;
    } else {
        failed++;
        failures.push(`${name}${detail !== undefined ? ` — ${detail}` : ''}`);
    }
}

const tmpDirs = [];
function makeDataDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dots-store-'));
    tmpDirs.push(d);
    return d;
}

/** Подменяем user-store, чтобы каждый проверяющий случай был чистым */
function loadStore(dataDir) {
    delete require.cache[require.resolve('./user-store')];
    if (dataDir === null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDir;
    return require('./user-store');
}

/* --------------------- путь --------------------- */
{
    const dir = makeDataDir();
    const s = loadStore(dir);
    check('DATA_DIR задаёт путь к файлу', s.storePath() === path.join(dir, 'users.json'),
        s.storePath());
}
{
    const s = loadStore(null);
    check('без DATA_DIR файл лежит рядом с кодом', s.BUNDLED_FILE === path.join(__dirname, 'users.json'),
        s.storePath());
    check('файл из сборки существует', fs.existsSync(s.BUNDLED_FILE), s.BUNDLED_FILE);
}

/* --------------------- запись и чтение --------------------- */
{
    const dir = makeDataDir();
    const s = loadStore(dir);
    s.write({ a: { rating: 1000 }, b: { rating: 1200 } });
    const back = s.read();
    check('записанное читается обратно', back.a.rating === 1000 && back.b.rating === 1200, back);
    check('каталог создаётся, если его не было', fs.existsSync(dir));
}
{
    // Каталога может не быть: том монтируется, а вложенный путь - нет
    const dir = makeDataDir();
    const nested = path.join(dir, 'a', 'b');
    const s = loadStore(nested);
    s.write({ x: { rating: 5 } });
    check('вложенный каталог создаётся', fs.existsSync(path.join(nested, 'users.json')));
}

/* --------------------- атомарность --------------------- */
{
    /* Прежде запись шла прямо в users.json. Процесс, убитый посреди
       записи, оставлял обрезанный JSON, и после этого сервер уже не
       поднимался: прочитать файл было нельзя. Сейчас пишем во временный
       файл и переименовываем, поэтому на диске не бывает полузаписи */
    const dir = makeDataDir();
    const s = loadStore(dir);
    const data = {};
    for (let i = 0; i < 500; i++) data[`user${i}`] = { rating: 1000 + i, history: [] };
    s.write(data);
    check('большой файл читается после записи', Object.keys(s.read()).length === 500);

    // Временный файл не должен оставаться: иначе при следующей записи
    // он просто перезапишется, но мусор в каталоге тома остаётся навсегда
    const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp'));
    check('временный файл убран', leftovers.length === 0, leftovers.join(','));
}

/* --------------------- битый файл --------------------- */
{
    const dir = makeDataDir();
    const s = loadStore(dir);
    const file = path.join(dir, 'users.json');
    // Обрезанный JSON - ровно то, что оставалось после прежней записи
    fs.writeFileSync(file, '{"a": {"rating": 100');
    const data = s.read();
    check('битый файл не роняет чтение', data !== null && typeof data === 'object', data);
    const saved = fs.readdirSync(dir);
    check('битый файл сохранён для разбора',
        saved.some(f => f.includes('.broken-')), saved.join(','));
    // И сервер может продолжить работу: запись должна пройти
    s.write({ c: { rating: 7 } });
    check('после битого файла запись работает', s.read().c.rating === 7);
}
{
    const dir = makeDataDir();
    const s = loadStore(dir);
    // Пустой файл - тоже частая история: прервался первый же деплой
    fs.writeFileSync(path.join(dir, 'users.json'), '');
    check('пустой файл читается как пустое состояние', Object.keys(s.read()).length === 0);
}

/* --------------------- посев на томе --------------------- */
{
    /* При первом деплое тома ещё нет, а аккаунты лежат в образе.
       Без посева все, кто заходил раньше, оказались бы в гостях */
    const dir = makeDataDir();
    const s = loadStore(dir);
    check('до посева файла на томе нет', !fs.existsSync(path.join(dir, 'users.json')));
    const seeded = s.seedIfMissing();
    check('посев выполняется', seeded === true);
    check('файл появился на томе', fs.existsSync(path.join(dir, 'users.json')));
    const copied = s.read();
    check('на том попали аккаунты из сборки', Object.keys(copied).length > 0,
        Object.keys(copied).length);
}
{
    // Второй запуск: данные на томе уже есть, их нельзя затирать сборкой
    const dir = makeDataDir();
    const s = loadStore(dir);
    s.write({ важный: { rating: 1234 } });
    const seeded = s.seedIfMissing();
    check('повторный посев не выполняется', seeded === false);
    check('данные на томе не перезаписаны', s.read()['важный'].rating === 1234, s.read());
}

/* --------------------- режим без тома --------------------- */
{
    /* Локальная разработка остаётся как была: DATA_DIR не задан, файл
       рядом с кодом, никаких каталогов и переносов */
    const s = loadStore(null);
    const target = s.storePath();
    check('в обычном режиме путь рядом с кодом',
        target === path.join(__dirname, 'users.json'), target);

    /* Ниже только чтение. Писать сюда нельзя: write() заменяет файл
       целиком, и проверка пути стёрла бы боевые аккаунты. Именно так
       users.json однажды потерял всех игроков */
    const real = s.read();
    const realCount = Object.keys(real).length;
    s.read();
    const after = s.read();
    check('чтение не меняет файл из сборки',
        Object.keys(after).length === realCount, { было: realCount, стало: Object.keys(after).length });

    if (Object.keys(after).includes('__test_local__')) {
        console.warn('\nВНИМАНИЕ: в users.json найден __test_local__ - след старой версии теста.');
        delete after.__test_local__;
        s.write(after);
        console.warn('Аккаунт удалён.');
    }
}

/* --------------------- вывод --------------------- */
for (const d of tmpDirs) {
    try {
        fs.rmSync(d, { recursive: true, force: true });
    } catch { /* временный каталог, ничего страшного */ }
}
delete process.env.DATA_DIR;
delete require.cache[require.resolve('./user-store')];

console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
if (failed > 0) {
    console.log('\nПровалы:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
console.log('Все проверки хранения пройдены.');
