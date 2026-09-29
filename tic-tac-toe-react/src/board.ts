/**
 * Геометрия поля «точек и квадратов».
 *
 * ВАЖНО: индексы линий и квадратов здесь должны совпадать с match.js на
 * сервере. Сервер хранит позицию в массивах edges и boxOwner, и клиент
 * рисует по тем же индексам, поэтому расхождение в нумерации выглядело бы
 * как «ходишь не туда» - ошибка, которую почти невозможно заметить глазами.
 *
 * Нумерация:
 *   точки (r,c) сетки GRID x GRID
 *   горизонтальная линия h(r,c) = r * SPAN + c
 *   вертикальная   линия v(r,c) = H_COUNT + c * SPAN + r
 *   квадрат (r,c), стороны: верх h(r,c), низ h(r+1,c),
 *                          лево v(r,c), право v(r,c+1)
 */

/** точек по стороне */
export const GRID = 5;
export const SPAN = GRID - 1;
export const BOX_COUNT = SPAN * SPAN;
export const H_COUNT = GRID * SPAN;
export const EDGE_COUNT = H_COUNT * 2;

export const hIndex = (r: number, c: number) => r * SPAN + c;
export const vIndex = (r: number, c: number) => H_COUNT + c * SPAN + r;

/* --------------------- раскладка в координатах SVG ---------------------

   Между пятью точками ЧЕТЫРЕ промежутка, не пять. Из-за этого путаница
   и выехали за viewBox последняя колонка и последний ряд точек:
   при STEP = 120 поле от 60 до 540 не влезало в 480, и всё, что правее
   и ниже 480, просто обрезалось. Теперь раскладка считается от общего
   размера, а не задаётся двумя независимыми числами. */

export const SIZE = 480;                 // сторона viewBox
export const STEP = 100;                 // расстояние между соседними точками
export const PAD = 40;                   // поле от края

/** Координата точки по оси. 2 * PAD + SPAN * STEP === SIZE. */
export const px = (n: number) => PAD + n * STEP;

export const VIEW_BOX = `0 0 ${SIZE} ${SIZE}`;

/** Левый верхний угол квадрата в координатах точек. */
export function boxOrigin(box: number): { r: number; c: number } {
    return { r: Math.floor(box / SPAN), c: box % SPAN };
}

/** Четыре стороны квадрата в порядке: верх, низ, лево, право. */
export function boxEdges(box: number): [number, number, number, number] {
    const { r, c } = boxOrigin(box);
    return [hIndex(r, c), hIndex(r + 1, c), vIndex(r, c), vIndex(r, c + 1)];
}

/**
 * Разбор индекса линии в координаты точек - нужно для отрисовки.
 * @returns {r1,c1,r2,c2} - две точки, которые соединяет линия
 */
export function edgePoints(edge: number): { r1: number; c1: number; r2: number; c2: number } {
    if (edge < H_COUNT) {
        const r = Math.floor(edge / SPAN);
        const c = edge % SPAN;
        return { r1: r, c1: c, r2: r, c2: c + 1 };
    }
    const v = edge - H_COUNT;
    const c = Math.floor(v / SPAN);
    const r = v % SPAN;
    return { r1: r, c1: c, r2: r + 1, c2: c };
}

/** Разбор индекса квадрата в координаты углов - нужно для заливки. */
export function boxRect(box: number) {
    const { r, c } = boxOrigin(box);
    return { r, c, rows: r + 1, cols: c + 1 };
}

/**
 * Границы всего, что рисуется, в координатах viewBox.
 *
 * Существует ради проверки в test-geometry: рисунок обязан целиком
 * помещаться в SIZE. Иначе последняя колонка и последний ряд точек
 * молча уезжают за viewBox и обрезаются - игра при этом продолжает
 * работать, линии рисуются, партии доигрываются, и заметить пропажу
 * можно только глазами.
 */
export function contentBounds() {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < GRID; i++) {
        xs.push(px(i));
        ys.push(px(i));
    }
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        size: SIZE,
        leftMargin: px(0),
        rightMargin: SIZE - px(GRID - 1),
        topMargin: px(0),
        bottomMargin: SIZE - px(GRID - 1)
    };
}

/** Все линии квадрата, лежащие на одной стороне поля, рисуем иначе:
    прозрачная зона клика шире самой линии, иначе промахнуться невозможно. */
export function isHorizontal(edge: number) {
    return edge < H_COUNT;
}
