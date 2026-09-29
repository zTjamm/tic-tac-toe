import React from 'react';
import type { CellValue, MatchSnapshot, MatchPlayer } from '../types';
import './Board.css';

interface BoardProps {
    snapshot: MatchSnapshot | null;
    /** id игрока, который смотрит доску (для подсветки его выбора) */
    myId: string | null;
    /** клетки выигрышной линии прошлого раунда; null пока линии нет */
    winPattern: number[] | null;
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
    winPattern,
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
            // Клик по занятой соперником клетке раньше уходил на сервер,
            // который молча его отклонял: выглядело, что игра зависла
            if (canPick && !players.some(p => p.pick === index)) onPickNumber(index);
            return;
        }
        if (myTurn && board[index] === '') onMove(index);
    };

    // Пока идёт отсчёт, хлопать по клеткам бесполезно - гасим их заранее
    const waiting = inGuessing && guessing?.sub !== 'picking';
    const systemNumber = guessing?.systemNumber ?? null;

    return (
        <div
            className={`board ${inGuessing ? 'board-guessing' : ''} ${
                waiting ? 'waiting' : ''
            }`}
        >
            {Array.from({ length: 9 }).map((_, index) => {
                if (inGuessing) {
                    const taken = players.some(p => p.pick === index);
                    // Число на клетке, которое загадала система. Условие не
                    // привязано к sub === 'reveal': открытое число должно
                    // гореть и на фазе выбора роли, где игрок и решает, кто
                    // оказался ближе. systemNumber обнуляется только в
                    // начале новой угадайки, поэтому метка гаснет сама
                    const isSystem =
                        systemNumber !== null &&
                        cellNumbers[index] === systemNumber;

                    return (
                        <div
                            key={index}
                            className={`cell cell-number ${pickClass(index, players, myId)} ${
                                taken ? 'taken' : ''
                            } ${canPick && !taken ? '' : 'locked'} ${
                                isSystem ? 'revealed' : ''
                            }`}
                            onClick={() => handleClick(index)}
                        >
                            <span className="cell-num">{cellNumbers[index]}</span>
                            {isSystem && <span className="cell-system">загадано</span>}
                            {pickBadge(index, players, guessing?.winnerId ?? null)}
                        </div>
                    );
                }

                const cell: CellValue = board[index] ?? '';
                const disabled = !myTurn || cell !== '';
                const isWin = !!winPattern && winPattern.includes(index);
                return (
                    <div
                        key={index}
                        className={`cell ${cell ? cell.toLowerCase() : ''} ${
                            disabled ? 'taken' : ''
                        } ${isWin ? 'win' : ''}`}
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
