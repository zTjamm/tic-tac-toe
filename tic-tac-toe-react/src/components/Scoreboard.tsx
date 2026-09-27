import React from 'react';
import './Scoreboard.css';

interface ScoreboardProps {
    scores: { X: number; O: number; Draw: number };
    labelX: string;
    labelO: string;
}

const Scoreboard: React.FC<ScoreboardProps> = ({ scores, labelX, labelO }) => {
    return (
        <div className="scoreboard">
            <div className="score x-score">
                <span className="label">{labelX}</span>
                <span className="value">{scores.X}</span>
            </div>
            <div className="score draw-score">
                <span className="label">Ничьи</span>
                <span className="value">{scores.Draw}</span>
            </div>
            <div className="score o-score">
                <span className="label">{labelO}</span>
                <span className="value">{scores.O}</span>
            </div>
        </div>
    );
};

export default Scoreboard;
