/**
 * Автономный тест движка матча. Таймеры не ждём — вызываем обработчики
 * напрямую, чтобы проверять логику детерминированно.
 * Запуск: node test-match.js
 */

const { Match } = require('./match');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}\n         получено:  ${a}\n         ожидалось: ${e}`);
    }
}

function makeMatch(opts = {}) {
    const violations = [];
    const m = new Match(
        'TEST',
        [{ id: 'p1', username: 'Иван' }, { id: 'p2', username: 'Пётр' }],
        {
            onState: () => {},
            onViolation: opts.onViolation
                || ((name, count, kind) => { violations.push({ name, count, kind }); }),
            shouldPunish: opts.shouldPunish || (() => false)
        }
    );
    m.violations = violations;
    return m;
}

/** Прогоняет угадайку, заставляя нужного игрока стать атакующим. */
function playGuessing(m, cellA, cellB, wantAttackerId) {
    m.openPicking();
    m.pickCell('p1', cellA);
    if (cellB !== undefined) m.pickCell('p2', cellB);

    let guard = 0;
    while (m.phase === 'guessing' && guard++ < 500) m.revealNumber();

    if (m.phase === 'roleChoice') {
        const w = m.guessWinnerId;
        m.chooseRole(w, w === wantAttackerId);
    }
}

/** Разыгрывает один раунд так, чтобы выиграл winnerId. */
function playRound(m, winnerId) {
    const round = m.round;
    const wCells = [0, 1, 2];
    // 3,4,6 намеренно не образуют линию, иначе побеждает не тот, кого мы просим
    const oCells = [3, 4, 6];
    let wi = 0, oi = 0;
    let guard = 0;
    while (m.phase === 'playing' && m.round === round && guard++ < 20) {
        const curId = m.idOfMark(m.currentMark);
        const cell = curId === winnerId ? wCells[wi++] : oCells[oi++];
        if (cell === undefined) throw new Error('playRound: cells exhausted, round ' + round);
        m.move(curId, cell);
    }
    if (guard >= 20) throw new Error('playRound: loop, round ' + round);
}

/** Разыгрывает раунд вничью. X: 0,1,5,6,8  O: 2,3,4,7 — линий нет ни у кого. */
function playDrawRound(m) {
    const round = m.round;
    const xCells = [0, 1, 5, 6, 8];
    const oCells = [2, 3, 4, 7];
    let xi = 0, oi = 0;
    let guard = 0;
    while (m.phase === 'playing' && m.round === round && guard++ < 20) {
        const cell = m.currentMark === 'X' ? xCells[xi++] : oCells[oi++];
        if (cell === undefined) throw new Error('playDrawRound: cells exhausted, round ' + round);
        m.move(m.idOfMark(m.currentMark), cell);
    }
    if (guard >= 20) throw new Error('playDrawRound: loop, round ' + round);
}

console.log('\n1. Старт: фаза угадайки, раунд 1');
{
    const m = makeMatch();
    check('фаза = guessing', m.phase, 'guessing');
    check('подфаза = countdown', m.guessSub, 'countdown');
    check('раунд = 1', m.round, 1);
    check('счёт 0:0', [m.player('p1').score, m.player('p2').score], [0, 0]);
    check('числа 1..9', m.snapshot().cellNumbers, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

console.log('\n2. Угадайка: одна клетка, перевыбор запрещён, занятая не берётся');
{
    const m = makeMatch();
    m.openPicking();
    check('p1 берёт клетку 4', m.applyPick('p1', 4), true);
    check('перевыбор p1 отклонён', m.applyPick('p1', 5), false);
    check('p2 не может взять занятую 4', m.applyPick('p2', 4), false);
    check('p2 берёт свободную 0', m.applyPick('p2', 0), true);
    check('перевыбор p2 отклонён', m.applyPick('p2', 1), false);
    check('клетка вне доски отклонена', m.applyPick('p2', 99), false);
}

console.log('\n3. Угадайка: не выбрал за 10 сек -> отмена');
{
    const m = makeMatch();
    m.openPicking();
    m.pickCell('p1', 4);
    m.onGuessTimeout();
    check('матч отменён', m.result.type, 'cancelled');
    check('причина', m.result.reason, 'guess-timeout');
}

console.log('\n4. Роли: атакующий играет X, защитник O');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    check('фаза = playing', m.phase, 'playing');
    check('p1 атакует и играет X', [m.attackerId, m.player('p1').mark], ['p1', 'X']);
    check('p2 защищается и играет O', m.player('p2').mark, 'O');
    check('первым ходит X', m.currentMark, 'X');
    check('доска чистая', m.board.every(c => c === ''), true);
}

console.log('\n5. Очки: атакующий +2, защитник +3, ничья защитнику +1');
{
    const a = makeMatch();
    playGuessing(a, 0, 1, 'p1');
    playRound(a, 'p1');                    // X атакует и выигрывает
    check('атакующий: 2:0', [a.player('p1').score, a.player('p2').score], [2, 0]);
    check('раунд 2', a.round, 2);
    check('роли поменялись, атакует p2', a.attackerId, 'p2');
    check('p2 теперь X', a.player('p2').mark, 'X');

    const b = makeMatch();
    playGuessing(b, 0, 1, 'p1');
    playRound(b, 'p2');                    // O защищается и выигрывает
    check('защитник: 0:3', [b.player('p1').score, b.player('p2').score], [0, 3]);

    const c = makeMatch();
    playGuessing(c, 0, 1, 'p1');
    playDrawRound(c);
    check('ничья: защитнику +1', [c.player('p1').score, c.player('p2').score], [0, 1]);
    check('раунд продолжается', c.phase, 'playing');
}

console.log('\n6. Матч до 5 очков');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    playRound(m, 'p1');   // +2 -> 2
    playRound(m, 'p1');   // p1 теперь защитник, выигрывает как защитник -> +3 = 5
    check('p1 набрал 5', m.player('p1').score, 5);
    check('матч окончен', m.phase, 'finished');
    check('победа', m.result.type, 'finished');
    check('победил p1', m.result.winnerId, 'p1');
}

console.log('\n7. Таймаут хода в раунде 1 -> отмена');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    m.onTurnTimeout('p1');
    check('отмена', m.result.type, 'cancelled');
    check('причина', m.result.reason, 'timeout');
}

console.log('\n8. Таймаут в раунде 2+, ожидающий НЕ лидирует -> отмена');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    playRound(m, 'p1');                   // p1 выиграл как атакующий: 2:0
    m.move(m.idOfMark('X'), 0);           // p2 (теперь атакующий) делает ход
    // теперь ход p1, он лидирует 2:0; ждёт его p2, который не лидирует
    m.onTurnTimeout('p1');
    check('отмена', m.result.type, 'cancelled');
    check('причина', m.result.reason, 'timeout');
}

console.log('\n9. Таймаут в раунде 2+, ожидающий лидирует -> победа');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    playRound(m, 'p2');                   // 0:3, ходит лидер p2, ждёт отстающий p1
    m.onTurnTimeout('p1');
    check('матч окончен', m.phase, 'finished');
    check('победил лидер p2', m.result.winnerId, 'p2');
}

console.log('\n10. Восемь ничьих подряд -> 4:4 и угадайка в раунде 9');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    for (let r = 0; r < 8 && m.phase === 'playing'; r++) playDrawRound(m);
    check('счёт 4:4', [m.player('p1').score, m.player('p2').score], [4, 4]);
    check('раунд 9', m.round, 9);
    check('фаза угадайки', m.phase, 'guessing');
    check('доска очищена', m.board.every(c => c === ''), true);
}

console.log('\n11. Раунд 9 всегда завершает матч (побеждает >= 5)');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    for (let r = 0; r < 8 && m.phase === 'playing'; r++) playDrawRound(m);
    playGuessing(m, 0, 1, 'p1');          // угадайка 9-го раунда
    check('идёт 9-й раунд', [m.round, m.phase], [9, 'playing']);
    playRound(m, m.idOfMark('X'));        // X выигрывает -> 6:4
    check('матч окончен', m.phase, 'finished');
    check('у кого-то 5+', Math.max(m.player('p1').score, m.player('p2').score) >= 5, true);
}

console.log('\n12. Страйки: нарушение считается, но наказания нет');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    m.resolveViolation('p1', 'timeout');
    check('нарушение записано', m.violations.length, 1);
    check('нарушитель пойман по нику', m.violations[0].name, 'Иван');
    check('без наказания -> отмена', m.result.reason, 'timeout');
}

console.log('\n13. Страйк: shouldPunish -> автопроигрыш');
{
    const m = makeMatch({ shouldPunish: () => true });
    playGuessing(m, 0, 1, 'p1');
    m.resolveViolation('p1', 'timeout');
    check('матч окончен', m.phase, 'finished');
    check('причина = страйк', m.result.reason, 'strike');
    check('победил соперник', m.result.winnerId, 'p2');
}

console.log('\n13b. Наказание срабатывает только на 4-м нарушении');
{
    // Повторяем реальную логику менеджера: счётчик между матчами
    let total = 0;
    const m = makeMatch({
        onViolation: (name, count) => { total = count; },
        shouldPunish: () => total >= 4
    });
    playGuessing(m, 0, 1, 'p1');
    for (let i = 0; i < 3; i++) {
        m.resolveViolation('p1', 'timeout');
        m.phase = 'playing'; m.result = null;
    }
    check('после 3 нарушений матч жив', m.phase, 'playing');
    check('нарушений 3', m.player('p1').violations, 3);
    m.resolveViolation('p1', 'disconnect');
    check('матч завершён', m.phase, 'finished');
    check('причина = страйк', m.result.reason, 'strike');
    check('победил соперник', m.result.winnerId, 'p2');
}

console.log('\n14. Обрыв связи и переподключение');
{
    const m = makeMatch();
    playGuessing(m, 0, 1, 'p1');
    m.onDisconnect('p1');
    check('помечен отключённым', m.player('p1').connected, false);
    m.onReconnect('p1');
    check('переподключился', m.player('p1').connected, true);
    check('матч жив', m.phase, 'playing');
    check('таймер хода восстановлен', m.turnDeadline > Date.now(), true);
}

console.log('\n15. Ходы в неправильной фазе игнорируются');
{
    const m = makeMatch();
    m.move('p1', 0);                       // ещё угадайка
    check('ход в угадайке отклонён', m.board.every(c => c === ''), true);
    playGuessing(m, 0, 1, 'p1');
    m.move('p2', 0);                       // не его ход
    check('ход не в свою очередь отклонён', m.board.every(c => c === ''), true);
    m.move('p1', 4);
    m.move('p1', 4);                       // занятая клетка
    check('повтор клетки отклонён', m.board[4], 'X');
}

console.log(`\n${'='.repeat(46)}\nПройдено: ${passed}   Провалено: ${failed}\n${'='.repeat(46)}\n`);
process.exit(failed === 0 ? 0 : 1);
