import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchSnapshot, RoundEndInfo } from '../types';
import './Countdown.css';

interface CountdownProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
    /** итог последнего раунда: кто выиграл и сколько очков за это */
    roundEnd: RoundEndInfo | null;
    /** оборвалась ли связь с сервером */
    offline: boolean;
    onChooseRole: (attack: boolean) => void;
}

/**
 * Панель состояния матча: отсчёты, подсказка «ваш ход», выбор роли
 * победителем угадайки и итог прошедшего раунда. Дедлайны приходят с
 * сервера, локально только пересчитываем остаток раз в 200 мс.
 */
const Countdown: React.FC<CountdownProps> = ({
    snapshot,
    myId,
    roundEnd,
    offline,
    onChooseRole
}) => {
    // Счётчик нужен только чтобы панель перерисовывалась: остаток считается
    // по часам в момент отрисовки, а не по значению из состояния. Когда
    // значение лежало в состоянии, оно отставало до 200 мс, и отсчёт
    // показывал «16 с» на пятнадцатисекундном таймере.
    const [, redraw] = useState(0);

    useEffect(() => {
        const t = setInterval(() => redraw(x => x + 1), 200);
        return () => clearInterval(t);
    }, []);

    // Дедлайны приходят с сервера, то есть считаются по его часам. Часы
    // игрока с ними могут не совпадать - на проверенной машине расхождение
    // было 56 секунд, и отсчёт показывал «72 с» вместо пятнадцати, причём
    // на смене хода значение не сбрасывалось, а подрастало. Снимок несёт
    // текущий момент серверного времени: поправку считаем в момент прихода
    // снимка, и остаток идёт по ней. Считаем здесь же, в отрисовке, а не в
    // эффекте - иначе первая цифра после смены фазы показывалась бы
    // неверной на один кадр.
    const skew = useMemo(() => {
        if (snapshot && typeof snapshot.serverNow === 'number') {
            return snapshot.serverNow - Date.now();
        }
        return 0;
    }, [snapshot]);

    // Смена фазы должна перерисовать подсказку
    const phaseKey = snapshot ? `${snapshot.phase}:${snapshot.round}` : 'none';
    const lastKey = useRef(phaseKey);
    useEffect(() => {
        if (lastKey.current !== phaseKey) {
            lastKey.current = phaseKey;
            redraw(x => x + 1);
        }
    }, [phaseKey]);

    if (!snapshot) {
        return (
            <div className="countdown countdown-idle">
                Нажмите «Игра против бота», чтобы начать матч
            </div>
        );
    }

    const { phase, guessing, turnDeadline, players, result } = snapshot;
    const me = players.find(p => p.id === myId) || null;
    const myMark = me ? me.mark : null;
    const isMyTurn = phase === 'playing' && myMark !== null && snapshot.currentMark === myMark;
    const opponentOffline = players.some(p => p.id !== myId && !p.connected);

    const deadline = phase === 'playing' ? turnDeadline : guessing ? guessing.deadline : null;
    // Остаток считаем по серверным часам, поэтому поправку вычитаем
    const left = deadline ? Math.max(0, Math.ceil((deadline - Date.now() - skew) / 1000)) : null;

    return (
        <div className={`countdown countdown-${phase}`}>
            {/* Таймер и текст живут в отдельном ряду. Раньше всё было в одну
                строку flex, и два слота по 100% ширины выдавливали текст в
                ноль - игрок не видел «выберите число» и не понимал, почему
                кнопки не работают */}
            <div className="countdown-top">
                {left !== null && <span className="countdown-timer">{left}</span>}

                {phase === 'guessing' && guessing && (
                    <div className="countdown-body">
                        {guessing.sub === 'countdown' && (
                            <span>Приготовьтесь выбрать число ({left} с)</span>
                        )}
                        {guessing.sub === 'picking' && (
                            <span>
                                {me && me.pick !== null
                                    ? 'Число выбрано, ждём соперника'
                                    : 'Выберите число от 1 до 9 на доске'}
                            </span>
                        )}
                        {guessing.sub === 'reveal' && (
                            <span>
                                Системное число: <b>{guessing.systemNumber ?? '—'}</b>
                            </span>
                        )}
                    </div>
                )}

                {phase === 'roleChoice' && guessing && (
                    <div className="countdown-body">
                        {guessing.winnerId === myId ? (
                            <div className="role-choice">
                                <span>Вы ближе к загаданному числу. Выбирайте роль:</span>
                                <div className="role-buttons">
                                    <button className="btn" onClick={() => onChooseRole(true)}>
                                        Атаковать (X)
                                    </button>
                                    <button
                                        className="btn btn-role-defend"
                                        onClick={() => onChooseRole(false)}
                                    >
                                        Защищаться (O)
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <span>Соперник выбирает роль…</span>
                        )}
                    </div>
                )}

                {phase === 'playing' && (
                    <div className="countdown-body">
                        {isMyTurn ? (
                            <span className="your-turn">Ваш ход ({left} с)</span>
                        ) : (
                            <span>
                                Ход соперника (
                                {snapshot.players.find(p => p.mark === snapshot.currentMark)
                                    ?.username}
                                )
                            </span>
                        )}
                    </div>
                )}

                {phase === 'finished' && result && (
                    <div className="countdown-body">
                        {/* Подробности показывает MatchResult выше, здесь только
                            короткая строка, чтобы не дублировать */}
                        <span className="match-winner">
                            Матч окончен
                            {result.type === 'cancelled' ? ` — ${reasonText(result.reason)}` : ''}
                        </span>
                    </div>
                )}
            </div>

            {/* Итог раунда: без него игрок видит, как изменился счёт, но не
                понимает почему. Правила +2/+3/+1 приходилось держать в голове.

                Слот рисуется всегда, пока есть матч, и имеет ФИКСИРОВАННУЮ
                высоту. Раньше он появлялся вместе с плашкой и менял высоту
                по длине текста - 36, потом 101, потом 84 пикселя, и каждый
                раз доска прыгала вниз сразу после хода игрока */}
            <div className="round-slot">
                {roundEnd && phase === 'playing' && (
                    <div className={`round-result round-result-${roundEnd.outcome}`}>
                        <span className="rr-label">Раунд {snapshot.round - 1}</span>
                        <span className="rr-text">
                            {roundResultText(roundEnd, me?.isAttacker ?? false)}
                        </span>
                    </div>
                )}
            </div>

            {/* Связь: без баннера игрок смотрит на застывшую доску и не
                понимает, что матч вот-вот отменят. Тоже в слоте с резервом */}
            <div className="warn-slot">
                {offline ? (
                    <div className="conn-warning">
                        Нет связи с сервером, переподключаемся. Матч отменится,
                        если не вернуться вовремя.
                    </div>
                ) : opponentOffline && phase !== 'finished' ? (
                    <div className="conn-warning">
                        Соперник отключился. У него {snapshot.timing.turn} с на возврат
                        в игру.
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function reasonText(reason?: string): string {
    switch (reason) {
        case 'guess-timeout':
            return 'не выбрано число за отведённое время';
        case 'timeout':
            return 'пропущен ход';
        case 'disconnect':
            return 'разрыв связи';
        case 'strike':
            return 'автопроигрыш: четыре нарушения';
        case 'score':
            return 'набрано 5 очков';
        default:
            return 'причина неизвестна';
    }
}

/**
 * Человеческая формулировка исхода раунда вместе с очками.
 * Держим короткой: длинный текст переносился на несколько строк и
 * растягивал плашку, а та двигала доску.
 */
function roundResultText(end: RoundEndInfo, iAmAttacker: boolean): string {
    if (end.outcome === 'draw') return 'ничья: +1 защитнику';
    if (end.outcome === 'attacker') {
        return iAmAttacker ? 'вы атаковали и выиграли: +2' : 'атакующий выиграл: +2';
    }
    return iAmAttacker ? 'вы проиграли защиту: +3 сопернику' : 'вы защитились и выиграли: +3';
}

export default Countdown;
