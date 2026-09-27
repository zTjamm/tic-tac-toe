import React from 'react';
import type { MatchSnapshot } from '../types';
import './MatchResult.css';

interface MatchResultProps {
    snapshot: MatchSnapshot;
    myId: string | null;
    onRematch: () => void;
    onExit: () => void;
    canRematch: boolean;
}

/**
 * Экран итогов матча. Показывает, кто победил и почему матч закончился,
 * и предлагает реванш или возврат в меню.
 */
const MatchResult: React.FC<MatchResultProps> = ({
    snapshot,
    myId,
    onRematch,
    onExit,
    canRematch
}) => {
    const { result, players, round } = snapshot;
    if (!result) return null;

    const me = players.find(p => p.id === myId) || null;
    const opponent = players.find(p => p.id !== myId) || null;
    const iWon = !!me && result.type === 'finished' && result.winnerId === me.id;
    const iLost = !!me && result.type === 'finished' && result.winnerId !== me.id;

    let title: string;
    let tone: string;

    if (result.type === 'cancelled') {
        title = 'Матч отменён';
        tone = 'cancelled';
    } else if (iWon) {
        title = 'Вы победили';
        tone = 'win';
    } else if (iLost) {
        title = 'Вы проиграли';
        tone = 'loss';
    } else {
        title = `Победа: ${players.find(p => p.id === result.winnerId)?.username ?? '—'}`;
        tone = 'other';
    }

    // round - это номер раунда, который шёл. При победе он уже завершён
    // (finish() не увеличивает счётчик), при отмене - нет.
    const roundsPlayed = result.type === 'cancelled' ? round - 1 : round;

    return (
        <div className={`match-result match-result-${tone}`}>
            <div className="match-result-title">{title}</div>
            <div className="match-result-reason">{reasonText(result.reason)}</div>

            <div className="match-result-score">
                {players.map(p => (
                    <div
                        key={p.id}
                        className={`result-player ${
                            result.winnerId === p.id ? 'is-winner' : ''
                        }`}
                    >
                        <span className="name">
                            {p.username}
                            {p.id === myId ? ' (вы)' : ''}
                        </span>
                        <span className="pts">{p.score}</span>
                    </div>
                ))}
            </div>

            <div className="match-result-meta">
                Сыграно раундов: {Math.max(0, roundsPlayed)}
                {opponent ? ` · соперник: ${opponent.username}` : ''}
            </div>

            <div className="match-result-actions">
                <button
                    className="btn"
                    onClick={onRematch}
                    disabled={!canRematch}
                    title={canRematch ? 'Сыграть ещё раз' : 'Нет связи с сервером'}
                >
                    Реванш
                </button>
                <button className="btn btn-ghost" onClick={onExit}>
                    В меню
                </button>
            </div>
        </div>
    );
};

function reasonText(reason?: string): string {
    switch (reason) {
        case 'guess-timeout':
            return 'кто-то не выбрал число за отведённое время';
        case 'timeout':
            return 'кто-то не успел сделать ход';
        case 'disconnect':
            return 'разрыв связи не восстановился';
        case 'strike':
            return 'автопроигрыш: три нарушения подряд';
        case 'score':
            return 'набрано 5 очков';
        default:
            return '';
    }
}

export default MatchResult;
