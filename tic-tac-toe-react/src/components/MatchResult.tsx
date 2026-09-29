import React from 'react';
import type { MatchSnapshot } from '../types';
import './MatchResult.css';

interface MatchResultProps {
    snapshot: MatchSnapshot;
    myId: string | null;
    onRematch: () => void;
    onExit: () => void;
    canRematch: boolean;
    /** партия с ботом рейтинга не двигает - это надо сказать прямо */
    isBotMatch: boolean;
}

/**
 * Экран итогов партии. Показывает счёт по квадратам, кто победил и почему,
 * и предлагает реванш или возврат в меню.
 */
const MatchResult: React.FC<MatchResultProps> = ({
    snapshot,
    myId,
    onRematch,
    onExit,
    canRematch,
    isBotMatch
}) => {
    const { result, players, totalBoxes, movesLeft } = snapshot;
    if (!result) return null;

    const me = players.find(p => p.id === myId) || null;
    const opponent = players.find(p => p.id !== myId) || null;
    const iWon = !!me && result.type === 'finished' && result.winnerId === me.id;
    const iLost = !!me && result.type === 'finished' && result.winnerId !== me.id;

    let title: string;
    let tone: string;

    if (result.type === 'cancelled') {
        title = 'Партия прервана';
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

    return (
        <div className={`match-result match-result-${tone}`}>
            <div className="match-result-title">{title}</div>
            <div className="match-result-reason">{reasonText(result.reason)}</div>

            <div className="match-result-score">
                {players.map(p => (
                    <div
                        key={p.id}
                        className={`result-player slot-${p.slot} ${
                            result.winnerId === p.id ? 'is-winner' : ''
                        }`}
                    >
                        <span className="mark" />
                        <span className="name">
                            {p.username}
                            {p.id === myId ? ' (вы)' : ''}
                        </span>
                        <span className="pts">{p.score}</span>
                    </div>
                ))}
            </div>

            <div className="match-result-meta">
                Закрыто {totalBoxes} квадратов · осталось линий: {movesLeft}
                {opponent ? ` · соперник: ${opponent.username}` : ''}
            </div>

            {isBotMatch ? (
                <div className="rating-change is-neutral">
                    <span className="rc-why">Партия с ботом, рейтинг не изменился</span>
                </div>
            ) : (
                <RatingChange snapshot={snapshot} myId={myId} />
            )}

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
        case 'disconnect':
            return 'разрыв связи не восстановился';
        case 'strike':
            return 'автопроигрыш: четыре обрыва связи';
        case 'score':
            return 'разобраны все квадраты, у кого больше — тот и выиграл';
        case 'tiebreak':
            return 'счёт 8:8: выиграл тот, кто забрал последний квадрат';
        default:
            return '';
    }
}

/**
 * Разбор изменения рейтинга. Формула учитывает силу соперника, поэтому
 * «+3» вместо привычных «+2» выглядит ошибкой, если не сказать почему.
 *
 * В снимке финала рейтинг УЖЕ обновлён (хук onResult отработал до
 * рассылки), поэтому значение «до» восстанавливаем вычитанием дельты.
 */
const RatingChange: React.FC<{ snapshot: MatchSnapshot; myId: string | null }> = ({
    snapshot,
    myId
}) => {
    const { players, ratingDelta } = snapshot;
    if (snapshot.result?.type !== 'finished' || !ratingDelta || !myId) return null;

    const me = players.find(p => p.id === myId) || null;
    if (!me || me.isBot) return null;
    const delta = ratingDelta[myId];
    if (typeof delta !== 'number' || delta === 0) return null;

    const opponent = players.find(p => p.id !== myId) || null;
    const before = me.rating - delta;
    const oppDelta = opponent ? ratingDelta[opponent.id] ?? 0 : 0;
    const oppBefore = opponent ? opponent.rating - oppDelta : 0;

    // Разрыв считаем по рейтингам ДО матча - именно он влиял на очки
    const gap = opponent ? before - oppBefore : 0;
    const absGap = Math.abs(gap);
    const sign = delta > 0 ? '+' : '';

    let why = '';
    if (opponent && opponent.isBot) {
        why = ' · матч против бота (рейтинг 1000)';
    } else if (absGap >= 100) {
        why =
            gap > 0
                ? ` · вы были сильнее на ${absGap}`
                : ` · соперник был сильнее на ${absGap}`;
    } else {
        why = ' · равные рейтинги';
    }

    return (
        <div className={`rating-change ${delta > 0 ? 'is-up' : 'is-down'}`}>
            <span className="rc-amount">
                рейтинг {sign}
                {delta}
            </span>
            <span className="rc-flow">
                {before} → {me.rating}
            </span>
            <span className="rc-why">{why}</span>
        </div>
    );
};

export default MatchResult;
