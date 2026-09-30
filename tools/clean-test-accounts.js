/**
 * Удаление тестовых аккаунтов из users.json.
 *
 * Нужен после прогона tools/prod-smoke.js: тот регистрирует настоящих
 * игроков, они попадают в общий онлайн, а выигравшие - в таблицу рейтинга.
 * Без уборки четыре-пять мест в топе занимают выдуманные игроки.
 *
 * Запуск:
 *   node tools/clean-test-accounts.js --path users.json            - что удалится
 *   node tools/clean-test-accounts.js --path users.json --apply    - удалить
 *
 * Удаляется только префикс sm_ - тот, что ставит prod-smoke. Более короткие
 * префиксы прочих тестов ('tm', 'oa', 'ob') намеренно не включены по
 * умолчанию: они запросто совпали бы с живым ником, а скрипт удаляет
 * аккаунты вместе с их рейтингом и историей. Добавить свой:
 *   --prefix itest --prefix prod
 *
 * ВАЖНО: останавливайте сервер. Пользователи живут в памяти процесса, и
 * ближайший saveUsers() затрёт правку файла обратно - я на этом уже
 * наступал: удалил аккаунт, а через минуту он снова был в users.json.
 * На боевом сервере:
 *   pm2 stop tic-tac-toe
 *   node tools/clean-test-accounts.js --path users.json --apply
 *   pm2 start tic-tac-toe
 * Рестарт обнуляет сессии: вошедшим придётся войти заново.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};

// Единственный префикс по умолчанию: он ставится самим prod-smoke и
// ничем больше не используется.
const prefixes = ['sm_'];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prefix') prefixes.push(args[i + 1]);
}

const target = path.resolve(getArg('--path') || 'users.json');
const apply = args.includes('--apply');

if (!fs.existsSync(target)) {
    console.error('файла нет: ' + target);
    console.error('укажите путь явно: --path /root/tic-tac-toe/users.json');
    process.exit(2);
}

let users;
try {
    users = JSON.parse(fs.readFileSync(target, 'utf8'));
} catch (e) {
    console.error('файл не читается: ' + e.message);
    process.exit(2);
}

const junk = Object.keys(users).filter(name => prefixes.some(p => name.startsWith(p)));
const keep = Object.keys(users).filter(name => !junk.includes(name));

console.log('файл: ' + target);
console.log('префиксы: ' + prefixes.join(', '));
console.log('всего аккаунтов: ' + Object.keys(users).length);
console.log('к удалению: ' + junk.length);
console.log('останется: ' + keep.length);
console.log();

if (junk.length) {
    console.log('удаляются:');
    for (const n of junk) {
        const u = users[n];
        const extra = u && u.rating !== 1000 ? `, рейтинг ${u.rating}` : '';
        console.log('  ' + n + extra);
    }
    console.log();
}
console.log('остаются: ' + keep.join(', '));

if (!apply) {
    console.log();
    console.log('это был просмотр. Для удаления добавьте --apply');
    console.log('и убедитесь, что сервер остановлен: правка не переживёт saveUsers()');
    process.exit(0);
}

if (!junk.length) {
    console.log();
    console.log('удалять нечего');
    process.exit(0);
}

// Последний предохранитель: файлу пользователей не из чего восстанавливаться,
// и восстановиться будет не из чего
if (!keep.length) {
    console.error();
    console.error('ОТКАЗ: это удалит все аккаунты разом. Проверьте --path и --prefix');
    process.exit(4);
}

// Пишем через временный файл с последующим переименованием: users.json -
// это состояние сервера, и оборванная запись здесь означает потерю всех
// аккаунтов разом. Так же пишет сам user-store.js.
const tmp = target + '.tmp-' + process.pid;
for (const n of junk) delete users[n];
fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
fs.renameSync(tmp, target);

console.log();
console.log('удалено ' + junk.length + ', в файле осталось ' + Object.keys(users).length);
console.log('теперь запустите сервер заново, иначе он продолжит работать со старым списком в памяти');
