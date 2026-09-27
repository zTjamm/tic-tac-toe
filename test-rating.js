/**
 * Проверка начисления рейтинга. Ловит ошибки знака, которые на глаз незаметны:
 * rating - (-1) даёт плюс, а не минус.
 */

const MATCH_WIN_POINTS = 2;
const MATCH_LOSS_POINTS = -1;

function applyRating(rating, result) {
    if (result === 'win') return rating + MATCH_WIN_POINTS;
    if (result === 'loss') return Math.max(0, rating + MATCH_LOSS_POINTS);
    return rating;
}

let failed = 0;
function check(name, actual, expected) {
    if (actual === expected) {
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}: получено ${actual}, ожидалось ${expected}`);
    }
}

console.log('\nРейтинг');
check('победа: 1000 -> 1002', applyRating(1000, 'win'), 1002);
check('поражение: 1000 -> 999', applyRating(1000, 'loss'), 999);
check('ничья не меняет', applyRating(1000, 'draw'), 1000);
check('поражение не уходит в минус', applyRating(0, 'loss'), 0);

console.log('\nСерия: победа, поражение, победа');
let r = 1000;
r = applyRating(r, 'win');
r = applyRating(r, 'loss');
r = applyRating(r, 'win');
check('1000 -> 1002 -> 1001 -> 1003', r, 1003);

console.log('\nСерия побед подряд накапливается корректно');
let r2 = 1000;
for (let i = 0; i < 4; i++) r2 = applyRating(r2, 'win');
check('4 победы: 1000 -> 1008', r2, 1008);

console.log(failed === 0 ? '\nВсе проверки рейтинга пройдены\n' : `\nПровалено: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
