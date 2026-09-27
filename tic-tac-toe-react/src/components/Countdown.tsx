import React, { useEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '../types';
import './Countdown.css';

interface CountdownProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
    onChooseRole: (attack: boolean) => void;
}

/**
 * Панель состояния матча: отсчёты, подсказка «ваш ход» и выбор роли
 * победителем угадайки. Дедлайны приходят с сервера, локально только
 * пересчитываем остаток раз в 200 мс.
 */
const Countdown: React.FC<CountdownProps> = ({ snapshot, myId, onChooseRole }) => {
    const [now, setNow] = useState(() => Date.now());
    const [, force] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 200);
        return () => clearInterval(t);
    }, []);

    // Смена фазы должна перерисовать подсказку
    const phaseKey = snapshot ? `${snapshot.phase}:${snapshot.round}` : 'none';
    const lastKey = useRef(phaseKey);
    useEffect(() => {
        if (lastKey.current !== phaseKey) {
            lastKey.current = phaseKey;
            force(x => x + 1);
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

    const deadline = phase === 'playing' ? turnDeadline : guessing ? guessing.deadline : null;
    const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

    return (
        <div className={`countdown countdown-${phase}`}>
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
                                <button className="btn btn-role-defend" onClick={() => onChooseRole(false)}>
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
                            Ход соперника ({snapshot.players.find(p => p.mark === snapshot.currentMark)?.username})
                        </span>
                    )}
                </div>
            )}

            {phase === 'finished' && result && (
                <div className="countdown-body">
                    {/* Подробности показывает MatchResult ниже, здесь только
                        короткая строка, чтобы не дублировать */}
                    <span className="match-winner">
                        Матч окончен
                        {result.type === 'cancelled' ? ` — ${reasonText(result.reason)}` : ''}
                    </span>
                </div>
            )}
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
            return 'автопроигрыш за три нарушения';
        case 'score':
            return 'набрано 5 очков';
        default:
            return 'причина неизвестна';
    }
}

export default Countdown;
