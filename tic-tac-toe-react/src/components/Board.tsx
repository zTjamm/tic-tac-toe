import React from 'react';
import type { CellValue, MatchSnapshot, MatchPlayer } from '../types';
import './Board.css';

interface BoardProps {
    snapshot: MatchSnapshot | null;
    /** id игрока, который смотрит доску (для подсветки его выбора) */
    myId: string | null;
    onPickNumber: (cell: number) => void;
    onMove: (cell: number) => void;
}

/**
 * Доска умеет три вещи:
 *  - в фазе угадайки показывает числа 1..9 и подсвечивает выбор каждого игрока
 *    своим цветом;
 *  - в фазе игры показывает X/O и разрешает ход только текущему;
 *  - в фазе выбора роли показывает выбранные числа и выбор победителя угадайки.
 */
const Board: React.FC<BoardProps> = ({
    snapshot,
    myId,
    onPickNumber,
    onMove
}) => {
    if (!snapshot) {
        return (
            <div className="board board-empty">
                {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="cell" />
                ))}
            </div>
        );
    }

    const { phase, guessing, board, currentMark, players, cellNumbers } = snapshot;
    const inGuessing = phase === 'guessing' || phase === 'roleChoice';

    const me = players.find(p => p.id === myId) || null;
    const myMark = me ? me.mark : null;
    const myTurn = phase === 'playing' && myMark !== null && currentMark === myMark;
    const canPick =
        phase === 'guessing' &&
        guessing?.sub === 'picking' &&
        me !== null &&
        me.pick === null;

    const handleClick = (index: number) => {
        if (inGuessing) {
            if (canPick) onPickNumber(index);
            return;
        }
        if (myTurn && board[index] === '') onMove(index);
    };

    return (
        <div
            className={`board ${inGuessing ? 'board-guessing' : ''} ${
                phase === 'finished' ? 'board-finished' : ''
            }`}
        >
            {Array.from({ length: 9 }).map((_, index) => {
                if (inGuessing) {
                    return (
                        <div
                            key={index}
                            className={`cell cell-number ${pickClass(index, players, myId)} ${
                                canPick && players.some(p => p.pick === index) ? 'taken' : ''
                            }`}
                            onClick={() => handleClick(index)}
                        >
                            <span className="cell-num">{cellNumbers[index]}</span>
                            {pickBadge(index, players, guessing?.winnerId ?? null)}
                        </div>
                    );
                }

                const cell: CellValue = board[index] ?? '';
                const disabled = !myTurn || cell !== '';
                return (
                    <div
                        key={index}
                        className={`cell ${cell ? cell.toLowerCase() : ''} ${
                            disabled ? 'taken' : ''
                        }`}
                        onClick={() => handleClick(index)}
                    >
                        {cell}
                    </div>
                );
            })}
        </div>
    );
};

/** Класс подсветки по тому, чья это клетка. */
function pickClass(index: number, players: MatchPlayer[], myId: string | null): string {
    const owner = players.find(p => p.pick === index);
    if (!owner) return '';
    if (owner.id === myId) return 'pick-mine';
    return 'pick-theirs';
}

/** Маленькая метка с ником выбравшего. */
function pickBadge(index: number, players: MatchPlayer[], winnerId: string | null) {
    const owner = players.find(p => p.pick === index);
    if (!owner) return null;
    return (
        <span className={`cell-pick-owner ${owner.id === winnerId ? 'is-winner' : ''}`}>
            {owner.username}
        </span>
    );
}

export default Board;
