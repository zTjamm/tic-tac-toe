import React from 'react';
import type { MatchSnapshot } from '../types';
import './Scoreboard.css';

interface ScoreboardProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
}

/**
 * Табло матча: у каждого игрока его фигура (X - атакует, O - защищается),
 * счёт до 5 и отметка "вы". Ничьих как результата матча не бывает, поэтому
 * третьей колонки "Ничьи" больше нет.
 */
const Scoreboard: React.FC<ScoreboardProps> = ({ snapshot, myId }) => {
    if (!snapshot) return null;

    const { players, targetScore, round, maxRounds, phase } = snapshot;
    const attacker = players.find(p => p.isAttacker) || null;
    // В фазе угадайки роли ещё не назначены - показывать их рано
    const rolesKnown = phase !== 'guessing' && phase !== 'roleChoice';

    return (
        <div className="scoreboard">
            <div className="scoreboard-round">
                Раунд {round} из {maxRounds} · цель {targetScore} очков
            </div>
            <div className="scoreboard-players">
                {players.map(p => (
                    <div
                        key={p.id}
                        className={`score score-${p.mark.toLowerCase()} ${
                            p.id === myId ? 'is-me' : ''
                        } ${rolesKnown && p.isAttacker ? 'is-attacker' : ''}`}
                    >
                        <span className="mark">{rolesKnown ? p.mark : '?'}</span>
                        <span className="label">
                            {p.username}
                            {p.id === myId ? ' (вы)' : ''}
                        </span>
                        <span className="value">{p.score}</span>
                        {!p.connected && <span className="offline">нет связи</span>}
                    </div>
                ))}
            </div>
            {rolesKnown && attacker && (
                <div className="scoreboard-hint">
                    Атакует {attacker.username} (X), ходит первым
                </div>
            )}
        </div>
    );
};

export default Scoreboard;
