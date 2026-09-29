import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchSnapshot, MoveInfo } from '../types';
import './Countdown.css';

interface CountdownProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
    /** последний ход: сколько квадратов закрыто и чей это был ход */
    lastMove: MoveInfo | null;
    /** оборвалась ли связь с сервером */
    offline: boolean;
}

/**
 * Панель состояния партии: отсчёт до хода, чья очередь, предупреждение о
 * цепочке и итог последнего хода. Дедлайны приходят с сервера, локально
 * только пересчитываем остаток раз в 200 мс.
 */
const Countdown: React.FC<CountdownProps> = ({
    snapshot,
    myId,
    lastMove,
    offline
}) => {
    // Счётчик нужен только чтобы панель перерисовывалась: остаток считается
    // по часам в момент отрисовки, а не по значению из состояния.
    const [, redraw] = useState(0);

    useEffect(() => {
        const t = setInterval(() => redraw(x => x + 1), 200);
        return () => clearInterval(t);
    }, []);

    // Дедлайны считаются по часам сервера, а часы игрока с ними могут
    // не совпадать. Снимок несёт текущий момент серверного времени:
    // поправку считаем в момент прихода снимка.
    const skew = useMemo(() => {
        if (snapshot && typeof snapshot.serverNow === 'number') {
            return snapshot.serverNow - Date.now();
        }
        return 0;
    }, [snapshot]);

    // Смена фазы должна перерисовать подсказку
    const phaseKey = snapshot ? `${snapshot.phase}:${snapshot.turnId}` : 'none';
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
                Нажмите «Играть» или «Бот», чтобы начать партию
            </div>
        );
    }

    const { phase, startDeadline, turnDeadline, players, danger, result, timing } = snapshot;
    const isMyTurn = phase === 'playing' && snapshot.turnId === myId;
    const opponentOffline = players.some(p => p.id !== myId && !p.connected);

    const deadline = phase === 'starting' ? startDeadline : turnDeadline;
    const left = deadline
        ? Math.max(0, Math.ceil((deadline - Date.now() - skew) / 1000))
        : null;

    /* Последние секунды подсвечиваем: счётчик идёт у всех, но заметить
       взглядом, что осталось три, можно только если он покраснел. Раньше
       оставалось догадываться, сколько ещё есть на ход */
    const urgent = left !== null && left <= 5;

    return (
        <div className={`countdown countdown-${phase}`}>
            <div className="countdown-top">
                {left !== null && (
                    <span className={`countdown-timer ${urgent ? 'is-urgent' : ''}`}>
                        {left}
                    </span>
                )}

                <div className="countdown-body">
                    {phase === 'starting' && <span>Поле разметится, скоро ход</span>}

                    {phase === 'playing' && isMyTurn && (
                        <span className={`your-turn ${urgent ? 'is-urgent' : ''}`}>
                            Ваш ход ({left} с)
                        </span>
                    )}

                    {phase === 'playing' && !isMyTurn && (
                        <span>
                            Ход соперника (
                            {players.find(p => p.id === snapshot.turnId)?.username}) —{' '}
                            {left} с
                        </span>
                    )}

                    {phase === 'playing' && danger.length > 0 && isMyTurn && (
                        <span className="chain-warning">
                            Осторожно: придётся отдать {danger.length} (
                            {danger.length === 1 ? 'квадрат' : 'квадрата'}). Красная
                            область — она уже почти закрыта.
                        </span>
                    )}

                    {phase === 'finished' && result && (
                        <span className="match-winner">
                            Партия окончена
                            {result.type === 'cancelled'
                                ? ` — ${reasonText(result.reason)}`
                                : ''}
                        </span>
                    )}
                </div>
            </div>

            {/* Слот рисуется всегда и имеет фиксированную высоту: раньше
                плашка появлялась вместе с ходом и прыгала по высоте, а это
                дёргало доску в тот самый момент, когда игрок ходит */}
            <div className="round-slot">
                {lastMove && phase !== 'finished' && (
                    <div className="round-result">
                        <span className="rr-text">
                            {lastMove.auto
                                ? 'Время вышло — ход сделан за игрока'
                                : lastMove.gained > 0
                                  ? `Закрыто квадратов: ${lastMove.gained} — ход остаётся`
                                  : 'Линия проведена, ход перешёл сопернику'}
                        </span>
                    </div>
                )}
            </div>

            {/* Связь: без баннера игрок смотрит на застывшую доску и не
                понимает, что вот-вот засчитают обрыв связи */}
            <div className="warn-slot">
                {offline ? (
                    <div className="conn-warning">
                        Нет связи с сервером, переподключаемся. У вас {timing.turn} с,
                        иначе засчитается обрыв.
                    </div>
                ) : opponentOffline && phase !== 'finished' ? (
                    <div className="conn-warning">
                        Соперник отключился. У него 15 с на возврат в игру.
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function reasonText(reason?: string): string {
    switch (reason) {
        case 'disconnect':
            return 'разрыв связи не восстановился';
        case 'strike':
            return 'автопроигрыш: четыре обрыва связи';
        case 'score':
            return 'разобраны все квадраты';
        case 'tiebreak':
            return 'счёт 8:8, последний квадрат забрал сильнейший по времени';
        default:
            return 'причина неизвестна';
    }
}

export default Countdown;
