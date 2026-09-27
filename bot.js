/**
 * Простой бот для серверного матча. Работает по эвристике:
 * выиграть -> заблокировать -> центр -> угол -> любая клетка.
 * Возвращает индекс клетки или -1, если ходить некуда.
 */

const WIN_PATTERNS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

function winnerAfter(board, mark, cell) {
    const test = board.slice();
    test[cell] = mark;
    return WIN_PATTERNS.some(([a, b, c]) =>
        test[a] === mark && test[b] === mark && test[c] === mark);
}

function botMove(board, mark) {
    const empty = [];
    for (let i = 0; i < 9; i++) if (board[i] === '') empty.push(i);
    if (empty.length === 0) return -1;

    const foe = mark === 'X' ? 'O' : 'X';

    // 1. Собственная победа
    for (const cell of empty) if (winnerAfter(board, mark, cell)) return cell;

    // 2. Блокировка соперника
    for (const cell of empty) if (winnerAfter(board, foe, cell)) return cell;

    // 3. Центр
    if (board[4] === '') return 4;

    // 4. Углы
    const corners = empty.filter(c => c === 0 || c === 2 || c === 6 || c === 8);
    if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)];

    // 5. Любая свободная
    return empty[Math.floor(Math.random() * empty.length)];
}

module.exports = { botMove };
