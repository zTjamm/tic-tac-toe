/**
 * Хранение пользователей.
 *
 * Файл лежит рядом с кодом, а это плохо: на Fly.io машина останавливается
 * при простое (auto_stop_machines), и её файловая система не переживает
 * перезапуск. Аккаунты и рейтинги пропадали бы при каждом останове.
 *
 * Поэтому путь задаётся переменной DATA_DIR, а на Fly.io это каталог
 * тома. Если файла в DATA_DIR нет, он берётся из сборки: так при первом
 * деплое старые аккаунты переезжают на том, а не теряются.
 *
 * Запись атомарная. Прежде было обычное writeFileSync, и если процесс
 * убивали посреди записи - а на деплое именно это и происходит - файл
 * оставался обрезанным, и загрузить его в следующий раз было уже нельзя.
 */

const path = require('path');
const fs = require('fs');

/** Файл, который лежит в образе: переселяем из него на том. */
const BUNDLED_FILE = path.join(__dirname, 'users.json');

/** Куда пишем сейчас. */
function storePath() {
    const dir = process.env.DATA_DIR;
    return dir ? path.join(dir, 'users.json') : BUNDLED_FILE;
}

function ensureDir(file) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, force: true });
}

/** Копирует файл из сборки, если рабочего ещё нет. */
function seedIfMissing() {
    const target = storePath();
    if (fs.existsSync(target)) return false;
    if (!fs.existsSync(BUNDLED_FILE)) return false;
    ensureDir(target);
    fs.copyFileSync(BUNDLED_FILE, target);
    return true;
}

function read(file = storePath()) {
    try {
        if (!fs.existsSync(file)) return {};
        const raw = fs.readFileSync(file, 'utf8');
        if (!raw.trim()) return {};
        return JSON.parse(raw);
    } catch (e) {
        // Битый файл не должен ронять сервер: иначе после неудачного
        // деплоя игра не поднимется вообще. Старый остаётся на месте -
        // переименуем его, чтобы данные можно было вытащить руками
        try {
            const broken = `${file}.broken-${Date.now()}`;
            fs.copyFileSync(file, broken);
            console.error(`[Store] users.json не читается, копия: ${broken}`);
            console.error('[Store] причина:', e.message);
        } catch (copyErr) {
            console.error('[Store] и копию сделать не удалось:', copyErr.message);
        }
        return {};
    }
}

function write(data, file = storePath()) {
    ensureDir(file);
    // Пишем во временный файл и переименовываем: переименование в
    // пределах одного каталога атомарно, поэтому читатель никогда не
    // увидит наполовину записанный файл
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

module.exports = { storePath, read, write, seedIfMissing, BUNDLED_FILE };
