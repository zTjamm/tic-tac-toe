/**
 * Восстановление users.json из истории git.
 *
 * Файл попал под .gitignore, но до этого был в репозитории, поэтому
 * последнее его состояние лежит в коммите, предшествующем .gitignore.
 * Отдельный скрипт, а не разовая команда: восстановление данных должно
 * быть повторяемым, иначе при следующем потерянном файле придётся
 * вспоминать, как это делалось.
 *
 * Запуск: node tools/restore-users.js [коммит]
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'users.json');

/** Коммит, в котором users.json ещё был в репозитории */
const FALLBACK_COMMIT = '4039ca2';

function readUsersAt(commit) {
    // Именно git show, а не pipe в PowerShell: консоль тут перекодирует
    // вывод, и на выходе получается не JSON
    const buf = execFileSync('git', ['show', `${commit}:users.json`], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024
    });
    return JSON.parse(buf.toString('utf8'));
}

/** Ищем последний коммит, где файл ещё отслеживался */
function findLastTracked() {
    const out = execFileSync(
        'git',
        ['log', '--format=%H %s', '--all', '--', 'users.json'],
        { cwd: ROOT }
    ).toString('utf8');
    for (const line of out.split('\n')) {
        const hash = line.trim().split(' ')[0];
        if (!hash) continue;
        try {
            const data = readUsersAt(hash);
            return { hash, short: hash.slice(0, 7), count: Object.keys(data).length };
        } catch {
            // коммит удалил файл - идём к следующему
        }
    }
    return null;
}

const argCommit = process.argv[2];
const last = findLastTracked();

if (!last && !argCommit) {
    console.error('В истории не нашлось ни одного состояния users.json.');
    process.exit(1);
}

const commit = argCommit || last.hash;
const data = readUsersAt(commit);
const names = Object.keys(data);

console.log(`Источник: ${commit.slice(0, 7)}`);
console.log(`Аккаунтов: ${names.length}`);
console.log(names.join(', '));

/** Сохраняем то, что есть сейчас, чтобы откат был обратимым */
let backup = null;
if (fs.existsSync(TARGET)) {
    const cur = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
    if (Object.keys(cur).length > 0) {
        backup = path.join(ROOT, 'users.json.before-restore');
        fs.writeFileSync(backup, fs.readFileSync(TARGET));
        console.log(`\nТекущий файл сохранён рядом: ${path.basename(backup)}`);
        console.log(`В нём аккаунтов: ${Object.keys(cur).length}`);
    }
}

/**
 * Историю и текущий файл соединяем: аккаунты из восстановления
 * возвращаем, но свежие (их могли набить тесты после потери) не
 * выбрасываем - вдруг это уже настоящие игроки.
 */
if (backup) {
    const cur = JSON.parse(fs.readFileSync(backup, 'utf8'));
    for (const [name, user] of Object.entries(cur)) {
        if (!data[name]) data[name] = user;
    }
    console.log(`После слияния аккаунтов: ${Object.keys(data).length}`);
}

fs.writeFileSync(TARGET, JSON.stringify(data, null, 2));
console.log(`\nЗаписано в users.json: ${Object.keys(data).length} аккаунтов`);
