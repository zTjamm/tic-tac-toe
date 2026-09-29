import React from 'react';
import type { MatchSnapshot } from '../types';
import {
    GRID,
    BOX_COUNT,
    STEP,
    VIEW_BOX,
    px,
    boxRect,
    edgePoints,
    isHorizontal
} from '../board';
import './Board.css';

interface BoardProps {
    snapshot: MatchSnapshot | null;
    myId: string | null;
    /** индекс последней проведённой линии - её подсвечиваем */
    lastEdge: number | null;
    onMove: (edge: number) => void;
}

// Раскладка в координатах SVG живёт в board.ts вместе с индексами.
// Держать её здесь было бы значит дублировать числа: при изменении
// размера поля в одном месте другое молча разъезжалось бы, и рисунок
// уехал бы за viewBox.
/**
 * Задержка появления точки. Идём по диагоналям, поэтому сетка проявляется
 * волной из левого верхнего угла, а не по строкам.
 */
const dotDelay = (r: number, c: number) => `${(r + c) * 38}ms`;

const Board: React.FC<BoardProps> = ({ snapshot, myId, lastEdge, onMove }) => {
    if (!snapshot) {
        return (
            <div className="board board-empty">
                <svg viewBox={VIEW_BOX} className="board-svg">
                    {Array.from({ length: GRID * GRID }).map((_, i) => {
                        const r = Math.floor(i / GRID);
                        const c = i % GRID;
                        return (
                            <circle
                                key={i}
                                cx={px(c)}
                                cy={px(r)}
                                r={3.5}
                                className="dot"
                                style={{ animationDelay: dotDelay(r, c) }}
                            />
                        );
                    })}
                </svg>
            </div>
        );
    }

    const { edges, boxOwner, turnId, danger, phase } = snapshot;
    const myTurn = phase === 'playing' && turnId === myId;
    const lastGained = new Set(snapshot.lastGainedBoxes ?? []);

    // Ники под доской не рисуем: в табло они уже есть, и снизу получался
    // дубль. Раньше он вдобавок был чёрным - в CSS была переменная
    // --text-dim, которой в проекте никто не объявлял, и цвет падал
    // на значение по умолчанию, то есть чёрный.
    const dangerSet = new Set(danger);

    const handleEdge = (edge: number) => {
        if (!myTurn) return;
        if (edges[edge] !== -1) return;
        onMove(edge);
    };

    return (
        <div className={`board ${myTurn ? 'my-turn' : ''}`}>
            <svg
                viewBox={VIEW_BOX}
                className="board-svg"
                onContextMenu={e => e.preventDefault()}
            >
                {/* ---------- Забранные квадраты и опасные цепочки ---------- */}
                {Array.from({ length: BOX_COUNT }).map((_, box) => {
                    const owner = boxOwner[box];
                    const { r, c } = boxRect(box);
                    const x = px(c) + 4;
                    const y = px(r) + 4;
                    const w = STEP - 8;
                    const isDanger = dangerSet.has(box);

                    // Новый квадрат мигнёт один раз - так видно, что именно
                    // ты только что забрал, и куда ушёл счёт
                    const justTaken =
                        owner !== -1 && lastGained.has(box);

                    return (
                        <g key={`box-${box}`}>
                            {owner !== -1 && (
                                <rect
                                    x={x}
                                    y={y}
                                    width={w}
                                    height={w}
                                    className={`box-fill slot-${owner} ${
                                        justTaken ? 'just-taken' : ''
                                    }`}
                                />
                            )}
                            {isDanger && (
                                <rect
                                    x={x + 3}
                                    y={y + 3}
                                    width={w - 6}
                                    height={w - 6}
                                    className="box-danger"
                                />
                            )}
                        </g>
                    );
                })}

                {/* ---------- Точки сетки ---------- */}
                {Array.from({ length: GRID * GRID }).map((_, i) => {
                    const r = Math.floor(i / GRID);
                    const c = i % GRID;
                    return (
                        <circle
                            key={`dot-${i}`}
                            cx={px(c)}
                            cy={px(r)}
                            r={3.5}
                            className="dot"
                            style={{ animationDelay: dotDelay(r, c) }}
                        />
                    );
                })}

                {/* ---------- Проведённые линии ---------- */}
                {edges.map((slot, edge) => {
                    if (slot === -1) return null;
                    const { r1, c1, r2, c2 } = edgePoints(edge);
                    return (
                        <line
                            key={`line-${edge}`}
                            x1={px(c1)}
                            y1={px(r1)}
                            x2={px(c2)}
                            y2={px(r2)}
                            className={`edge-line slot-${slot} ${
                                edge === lastEdge ? 'is-latest' : ''
                            }`}
                        />
                    );
                })}

                {/* ---------- Зоны клика по свободным линиям ---------- */}
                {myTurn &&
                    edges.map((slot, edge) => {
                        if (slot !== -1) return null;
                        const { r1, c1, r2, c2 } = edgePoints(edge);
                        const mx = (px(c1) + px(c2)) / 2;
                        const my = (px(r1) + px(r2)) / 2;
                        // Полоса вдоль линии: по ней и попадает палец
                        const w = isHorizontal(edge) ? STEP : 26;
                        const h = isHorizontal(edge) ? 26 : STEP;
                        return (
                            <rect
                                key={`hit-${edge}`}
                                x={mx - w / 2}
                                y={my - h / 2}
                                width={w}
                                height={h}
                                className="edge-hit"
                                onClick={() => handleEdge(edge)}
                            >
                                <title>Провести линию</title>
                            </rect>
                        );
                    })}
            </svg>
        </div>
    );
};

export default Board;
