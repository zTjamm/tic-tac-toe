import React from 'react';
import type { CellValue } from '../types';
import './Board.css';

interface BoardProps {
    board: CellValue[];
    onCellClick: (index: number) => void;
    disabled: boolean;
    winPattern: number[] | null;
}

const Board: React.FC<BoardProps> = ({ board, onCellClick, disabled, winPattern }) => {
    return (
        <div className="board">
            {board.map((cell, index) => (
                <div
                    key={index}
                    className={`cell ${cell ? cell.toLowerCase() : ''} ${disabled ? 'taken' : ''} ${
                        winPattern?.includes(index) ? 'win' : ''
                    }`}
                    onClick={() => !disabled && onCellClick(index)}
                >
                    {cell}
                </div>
            ))}
        </div>
    );
};

export default Board;
