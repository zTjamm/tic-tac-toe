/**
 * Сверка геометрии клиента и сервера.
 *
 * Клиент рисует поле по индексам из снимка, сервер эти индексы считает.
 * Если нумерация разойдётся, партия не сломается, но игрок увидит
 * «не те очки» и квадраты в чужих местах - ошибку, которую почти невозможно
 * заметить глазами и тем более поймать тестами движка.
 *
 * Поэтому берём настоящий файл tic-tac-toe-react/src/board.ts, транслилируем
 * его tsc и сравниваем с серверным match.js по всем 40 линиям и 16 квадратам.
 *
 * Запуск: node test-geometry.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const server = require('./match');
const REACT = path.join(__dirname, 'tic-tac-toe-react');
const BOARD_TS = path.join(REACT, 'src', 'board.ts');

let failed = 0;
function check(name, ok, info) {
    if (ok) console.log(`  ok   ${name}`);
    else {
        failed++;
        console.log(`  FAIL ${name}${info !== undefined ? ' -> ' + JSON.stringify(info) : ''}`);
    }
}

/** Транслилируем board.ts и грузим как обычный модуль.
    Через API компилятора, а не запуском tsc.cmd: .cmd нельзя исполнить
    через spawnSync, на Windows это падает с EINVAL. */
function loadClientBoard() {
    const ts = require(path.join(REACT, 'node_modules', 'typescript'));
    const source = fs.readFileSync(BOARD_TS, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020
        },
        fileName: 'board.ts'
    });
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dots-geo-'));
    const out = path.join(outDir, 'board.js');
    fs.writeFileSync(out, outputText, 'utf8');
    const mod = require(out);
    return { mod, cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }) };
}

console.log('Трансляция клиентской геометрии...');
const { mod: client, cleanup } = loadClientBoard();

try {
    /* -------------------- размеры поля -------------------- */
    console.log('\nРазмеры:');
    check('GRID совпадает', client.GRID === server.GRID, [client.GRID, server.GRID]);
    check('SPAN совпадает', client.SPAN === server.SPAN, [client.SPAN, server.SPAN]);
    check('число линий совпадает', client.EDGE_COUNT === server.EDGE_COUNT,
        [client.EDGE_COUNT, server.EDGE_COUNT]);
    check('число квадратов совпадает', client.BOX_COUNT === server.BOX_COUNT,
        [client.BOX_COUNT, server.BOX_COUNT]);
    check('H_COUNT совпадает', client.H_COUNT === server.H_COUNT,
        [client.H_COUNT, server.H_COUNT]);

    /* -------------------- стороны квадратов -------------------- */
    // Главная сверка: стороны квадрата обязаны совпасть до индекса.
    // Именно по ним клиент рисует заливку и определяет, чей это квадрат.
    console.log('\nСтороны квадратов:');
    let sideMismatch = null;
    for (let box = 0; box < server.BOX_COUNT; box++) {
        const a = client.boxEdges(box).join(',');
        const b = server.BOX_EDGES[box].join(',');
        if (a !== b) { sideMismatch = { box, client: a, server: b }; break; }
    }
    check(`все ${server.BOX_COUNT} квадратов имеют одинаковые стороны на клиенте и сервере`,
        sideMismatch === null, sideMismatch);

    /* -------------------- индексы линий -------------------- */
    console.log('\nИндексы линий:');
    check('hIndex совпадает по всей сетке', (() => {
        for (let r = 0; r < server.GRID; r++) {
            for (let c = 0; c < server.SPAN; c++) {
                if (client.hIndex(r, c) !== server.hIndex(r, c)) return false;
            }
        }
        return true;
    })());
    check('vIndex совпадает по всей сетке', (() => {
        for (let c = 0; c < server.GRID; c++) {
            for (let r = 0; r < server.SPAN; r++) {
                if (client.vIndex(r, c) !== server.vIndex(r, c)) return false;
            }
        }
        return true;
    })());

    /* -------------------- какие квадраты касаются линии -------------------- */
    // На этом строится и подсветка цепочек, и забор квадратов: если
    // EDGE_BOXES разойдутся, квадрат закроется не тем ходом.
    console.log('\nСвязь линий и квадратов:');
    const serverTouch = Array.from({ length: server.EDGE_COUNT }, () => []);
    for (let box = 0; box < server.BOX_COUNT; box++) {
        for (const e of server.BOX_EDGES[box]) serverTouch[e].push(box);
    }
    for (const list of serverTouch) list.sort((a, b) => a - b);

    const clientTouch = Array.from({ length: client.EDGE_COUNT }, () => []);
    for (let box = 0; box < client.BOX_COUNT; box++) {
        for (const e of client.boxEdges(box)) clientTouch[e].push(box);
    }
    for (const list of clientTouch) list.sort((a, b) => a - b);

    let touchMismatch = null;
    for (let e = 0; e < server.EDGE_COUNT; e++) {
        const a = clientTouch[e].join(',');
        const b = serverTouch[e].join(',');
        if (a !== b) { touchMismatch = { edge: e, client: a, server: b }; break; }
    }
    check(`все ${server.EDGE_COUNT} линий касаются одинаковых квадратов`,
        touchMismatch === null, touchMismatch);

    /* -------------------- координаты для отрисовки -------------------- */
    // Линия должна соединять соседние точки сетки: если endpoints уедут,
    // на экране появится линия не между теми точками, что нарисованы.
    console.log('\nКоординаты линий:');
    let pointMismatch = null;
    for (let edge = 0; edge < client.EDGE_COUNT; edge++) {
        const p = client.edgePoints(edge);
        const [e1, e2] = server.BOX_EDGES.length ? sidesOf(edge) : [];
        if (e1 === undefined) continue;
        if (p.r1 !== e1.r1 || p.c1 !== e1.c1 || p.r2 !== e2.r1 || p.c2 !== e2.c1) {
            pointMismatch = { edge, client: p, server: [e1, e2] };
            break;
        }
    }
    check('линии соединяют те же точки, что и на сервере',
        pointMismatch === null, pointMismatch);

    check('каждая линия соединяет соседние точки', (() => {
        for (let edge = 0; edge < client.EDGE_COUNT; edge++) {
            const p = client.edgePoints(edge);
            const dr = Math.abs(p.r2 - p.r1);
            const dc = Math.abs(p.c2 - p.c1);
            if (dr + dc !== 1) return false;
        }
        return true;
    })());

    check('isHorizontal совпадает с типом линии на сервере', (() => {
        for (let edge = 0; edge < client.EDGE_COUNT; edge++) {
            if (client.isHorizontal(edge) !== (edge < server.H_COUNT)) return false;
        }
        return true;
    })());

    /* -------------------- раскладка углов квадрата -------------------- */
    console.log('\nРаскладка квадратов:');
    let rectMismatch = null;
    for (let box = 0; box < client.BOX_COUNT; box++) {
        const rect = client.boxRect(box);
        const { r, c } = serverBoxOrigin(box);
        if (rect.r !== r || rect.c !== c) {
            rectMismatch = { box, client: rect, server: { r, c } };
            break;
        }
    }
    check('левый верхний угол квадрата совпадает', rectMismatch === null, rectMismatch);

    /* -------------------- рисунок помещается в viewBox -------------------- */
    // Главная проверка этого файла. Раньше её не было, и поле молча уезжало
    // за viewBox: точки шли до 540 при размере 480, правая колонка и нижний
    // ряд не рисовались, часть линий не попадала на экран. Игра при этом
    // полностью работала - партии доигрывались, клики обрабатывались,
    // потому что элементы оставались в DOM. Заметить можно было только
    // глазами, а тесты этого не проверяли.
    console.log('\nРисунок помещается в поле:');
    {
        const b = client.contentBounds();
        const limit = client.SIZE;
        check('все точки внутри viewBox',
            b.minX >= 0 && b.maxX <= limit && b.minY >= 0 && b.maxY <= limit, b);
        check('рисунок квадратный', b.maxX - b.minX === b.maxY - b.minY,
            { w: b.maxX - b.minX, h: b.maxY - b.minY });
        check('поля слева и справа одинаковые', b.leftMargin === b.rightMargin,
            { left: b.leftMargin, right: b.rightMargin });
        check('поля сверху и снизу одинаковые', b.topMargin === b.bottomMargin,
            { top: b.topMargin, bottom: b.bottomMargin });
        check('промежутков ровно на 4 стороны сетки',
            b.leftMargin * 2 + (b.maxX - b.minX) === limit,
            { left: b.leftMargin, content: b.maxX - b.minX, limit });
    }

    // Каждая линия обязана целиком лежать внутри поля
    let lineOutside = null;
    for (let edge = 0; edge < client.EDGE_COUNT; edge++) {
        const p = client.edgePoints(edge);
        for (const v of [client.px(p.r1), client.px(p.c1), client.px(p.r2), client.px(p.c2)]) {
            if (v < 0 || v > client.SIZE) { lineOutside = { edge, value: v }; break; }
        }
        if (lineOutside) break;
    }
    check(`все ${client.EDGE_COUNT} линий помещаются в поле`, lineOutside === null, lineOutside);

    // Зона клика шире самой линии: она должна помещаться тоже, иначе
    // крайние линии нажимаются «вполсилы»
    const HIT = 26;
    let hitOutside = null;
    for (let edge = 0; edge < client.EDGE_COUNT; edge++) {
        const p = client.edgePoints(edge);
        const mx = (client.px(p.c1) + client.px(p.c2)) / 2;
        const my = (client.px(p.r1) + client.px(p.r2)) / 2;
        const w = client.isHorizontal(edge) ? client.STEP : HIT;
        const h = client.isHorizontal(edge) ? HIT : client.STEP;
        if (mx - w / 2 < 0 || mx + w / 2 > client.SIZE ||
            my - h / 2 < 0 || my + h / 2 > client.SIZE) {
            hitOutside = { edge, mx, my, w, h };
            break;
        }
    }
    check('зоны клика помещаются в поле', hitOutside === null, hitOutside);

} finally {
    cleanup();
}

function serverBoxOrigin(box) {
    return { r: Math.floor(box / server.SPAN), c: box % server.SPAN };
}

/** Какие две точки соединяет линия - восстанавливаем из серверной геометрии. */
function sidesOf(edge) {
    // Горизонтальная линия h(r,c) соединяет (r,c) и (r,c+1)
    if (edge < server.H_COUNT) {
        const r = Math.floor(edge / server.SPAN);
        const c = edge % server.SPAN;
        return [{ r1: r, c1: c }, { r1: r, c1: c + 1 }];
    }
    // Вертикальная v(r,c) соединяет (r,c) и (r+1,c)
    const v = edge - server.H_COUNT;
    const c = Math.floor(v / server.SPAN);
    const r = v % server.SPAN;
    return [{ r1: r, c1: c }, { r1: r + 1, c1: c }];
}

/* ----------------------------------------------------------------------
   Раскладка не должна зависеть от длины текста.

   Та же ошибка, что и с viewBox, только по горизонтали: длинный текст с
   nowrap распирал .container, и доска прыгала вправо. Проверяем, что
   правило на месте, - в собранном CSS, а не в исходнике, потому что
   страницу раздаёт именно он. */
(function checkContainerMinWidth() {
    const src = fs.readFileSync(path.join(REACT, 'src', 'App.css'), 'utf8');
    const rule = /\.container\s*\{[^}]*\}/.exec(src);
    check('у .container задан min-width: 0', !!rule && /min-width:\s*0/.test(rule[0]),
        rule ? rule[0].slice(0, 120) : 'правило не найдено');

    const distIndex = path.join(REACT, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) {
        const href = (/href="\/assets\/([^"]+\.css)"/.exec(fs.readFileSync(distIndex, 'utf8')) || [])[1];
        const cssPath = href && path.join(REACT, 'dist', 'assets', href);
        if (cssPath && fs.existsSync(cssPath)) {
            const minified = new RegExp('\\.container\\{[^}]*min-width:0').test(
                fs.readFileSync(cssPath, 'utf8'));
            check('min-width: 0 доехал до собранного CSS', minified, href);
        } else {
            check('собранный CSS на месте', false, href || 'ссылка не найдена');
        }
    } else {
        check('собранный CSS на месте', false, 'dist/index.html отсутствует - выполните npm run build');
    }
})();

console.log(failed === 0 ? '\nГеометрия клиента и сервера совпадает' : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
