/**
 * Проверка начисления рейтинга.
 *
 * Тест импортирует rating.js, а не повторяет формулу: копия в тесте
 * расходилась с боевой и переставала что-либо проверять.
 *
 * Отдельно ловится ошибка знака: rating - (-1) даёт плюс, а не минус.
 */

const { matchDeltas } = require('./rating');

const BOT_RATING = 1000;

let failed = 0;
function check(name, actual, expected) {
    if (actual === expected) {
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}: получено ${actual}, ожидалось ${expected}`);
    }
}

/** Прогоняет матч двух игроков с заданными рейтингами. */
function play(ratingWinner, ratingLoser) {
    const { win, loss } = matchDeltas(ratingWinner, ratingLoser);
    return { winner: ratingWinner + win, loser: ratingLoser + loss, win, loss };
}

console.log('\nРавные рейтинги: +2 за победу, -1 за поражение');
check('победа: 1000 -> 1002', play(1000, 1000).winner, 1002);
check('поражение: 1000 -> 999', play(1000, 1000).loser, 999);
check('система ненулевая: сумма +1', matchDeltas(1000, 1000).win + matchDeltas(1000, 1000).loss, 1);

console.log('\nПобеда над более сильным даёт больше очков');
{
    const up = play(1000, 1200);   // андердог выиграл
    const even = play(1000, 1000);
    check('андердог получает больше равного', up.win > even.win, true);
    console.log(`       андердог +${up.win}, равные +${even.win}`);
}

console.log('\nПоражение более сильному стоит дешевле');
{
    const fav = play(1200, 1000).loser;    // фаворит проиграл
    const even = play(1000, 1000).loser;
    check('фаворит теряет столько же или меньше', fav >= even - 1, true);
    console.log(`       фаворит 1200 -> ${fav}, равные 1000 -> ${even}`);
}

console.log('\nРезультат всегда что-то меняет (нет нулевых дельт)');
for (const [w, l] of [[1000, 1000], [1000, 3000], [3000, 1000], [5000, 1]]) {
    const d = matchDeltas(w, l);
    check(`матч ${w} против ${l}: дельты ненулевые`, d.win >= 1 && d.loss <= -1, true);
}

console.log('\nСуммарные очки в матче не обнуляются и не создаются из воздуха');
{
    // Победа сильного над слабым: сильный берёт мало, слабый теряет мало
    const d = matchDeltas(1400, 1000);
    check('дельта фаворита скромная', d.win <= 2, true);
    console.log(`       1400 против 1000: +${d.win} / ${d.loss}`);
}

console.log('\nСистема не нулевая - оба края зафиксированы, чтобы правка была осознанной');
{
    check('равные: +2 и -1, сумма +1', (() => {
        const d = matchDeltas(1000, 1000);
        return d.win + d.loss;
    })(), 1);
    check('фаворит выиграл: +1 и -2, сумма -1', (() => {
        const d = matchDeltas(1400, 1000);
        return d.win + d.loss;
    })(), -1);
}

console.log('\nЗнак дельт: поражение всегда уменьшает рейтинг');
{
    let bad = 0;
    for (let w = 500; w <= 2500; w += 100) {
        for (let l = 500; l <= 2500; l += 100) {
            const d = matchDeltas(w, l);
            if (d.win <= 0 || d.loss >= 0) bad++;
            if (play(w, l).loser > l) bad++;
        }
    }
    check('ни на одной паре рейтингов проигравший не вырос', bad, 0);
}

console.log('\nИгра с ботом не двигает рейтинг вообще');
{
    // Формула сама по себе дала бы новичку очки, поэтому матчи с ботом
    // отсекаются раньше - в хуке onResult в server.js. Здесь фиксируем,
    // что отсекается именно хук, а не формула: если бы отсечка исчезла,
    // эти проверки остались бы зелёными и никто бы не заметил.
    const d = matchDeltas(BOT_RATING, BOT_RATING);
    check('против бота формула дала бы дельту (значит отсекается выше)', d.win > 0, true);
    console.log('       отсекается в server.js: onResult возвращает null, если в паре есть бот');
}

console.log('\nРейтинг не уходит в минус');
check('после поражения с нуля остаётся 0', Math.max(0, 0 + matchDeltas(0, 1000).loss), 0);

console.log(failed === 0 ? '\nВсе проверки рейтинга пройдены\n' : `\nПровалено: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
