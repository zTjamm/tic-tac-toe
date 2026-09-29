import React, { useEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '../types';
import './Scoreboard.css';

interface ScoreboardProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
}

/**
 * Табло партии: у каждого игрока его цвет, число закрытых квадратов и
 * отметка «вы». Всего квадратов 16, поэтому счёт всегда виден на одном
 * экране и не нужно помнить правила начисления очков.
 */
const Scoreboard: React.FC<ScoreboardProps> = ({ snapshot, myId }) => {
    /* Число, изменившееся на последнем ходе. Без этого забор квадрата
       выглядит мгновенной сменой цифры, и не видно, что именно её вызвало */
    const [bumped, setBumped] = useState<string | null>(null);
    const prevScores = useRef<Record<string, number>>({});

    useEffect(() => {
        if (!snapshot) return;
        const next: Record<string, number> = {};
        let changed: string | null = null;
        for (const p of snapshot.players) {
            next[p.id] = p.score;
            const prev = prevScores.current[p.id];
            if (prev !== undefined && p.score > prev) changed = p.id;
        }
        prevScores.current = next;
        if (!changed) return;
        setBumped(changed);
        const t = setTimeout(() => setBumped(null), 500);
        return () => clearTimeout(t);
    }, [snapshot]);

    if (!snapshot) return null;

    const { players, boxesLeft, totalBoxes, movesLeft, firstId, phase } = snapshot;

    return (
        <div className="scoreboard">
            <div className="scoreboard-round">
                Осталось квадратов: <b>{boxesLeft}</b> из {totalBoxes} · ходов:{' '}
                <b>{movesLeft}</b>
            </div>
            <div className="scoreboard-players">
                {players.map(p => (
                    <div
                        key={p.id}
                        className={`score slot-${p.slot} ${p.id === myId ? 'is-me' : ''}`}
                    >
                        <span className="mark" />
                        <span className="label">
                            {p.username}
                            {p.id === myId ? ' (вы)' : ''}
                            {p.id === firstId && phase !== 'finished' && (
                                <span className="first-move" title="Ходил первым">
                                    1
                                </span>
                            )}
                        </span>
                        <span className={`value ${bumped === p.id ? 'is-bumped' : ''}`}>
                            {p.score}
                        </span>
                        {p.strikes > 0 && (
                            <span
                                className={`strikes ${p.strikes >= 2 ? 'is-danger' : ''}`}
                                title={`обрывов связи: ${p.strikes} из 3`}
                            >
                                {p.strikes}/3
                            </span>
                        )}
                        {!p.connected && <span className="offline">нет связи</span>}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Scoreboard;
