import { useState, useCallback, useEffect } from 'react';
import type { CellValue, PlayerSymbol, GameMode } from '../types';

const WIN_PATTERNS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

export const useGame = () => {
    const [board, setBoard] = useState<CellValue[]>(Array(9).fill(''));
    const [currentPlayer, setCurrentPlayer] = useState<PlayerSymbol>('X');
    const [gameActive, setGameActive] = useState(true);
    const [mode, setMode] = useState<GameMode>('pvp');
    const [scores, setScores] = useState({ X: 0, O: 0, Draw: 0 });
    const [playerNames, setPlayerNames] = useState({ X: 'Игрок X', O: 'Игрок O' });
    const [winPattern, setWinPattern] = useState<number[] | null>(null);

    const checkWin = useCallback((board: CellValue[], player: PlayerSymbol): number[] | null => {
        for (const pattern of WIN_PATTERNS) {
            const [a, b, c] = pattern;
            if (board[a] === player && board[b] === player && board[c] === player) {
                return pattern;
            }
        }
        return null;
    }, []);

    const makeMove = useCallback((index: number) => {
        if (board[index] !== '' || !gameActive) return;

        const newBoard = [...board];
        newBoard[index] = currentPlayer;
        setBoard(newBoard);

        const pattern = checkWin(newBoard, currentPlayer);
        if (pattern) {
            setWinPattern(pattern);
            setGameActive(false);
            setScores(prev => ({ ...prev, [currentPlayer]: prev[currentPlayer as 'X' | 'O'] + 1 }));
            return;
        }

        if (newBoard.every(cell => cell !== '')) {
            setGameActive(false);
            setScores(prev => ({ ...prev, Draw: prev.Draw + 1 }));
            return;
        }

        setCurrentPlayer(currentPlayer === 'X' ? 'O' : 'X');
    }, [board, currentPlayer, gameActive, checkWin]);

    const resetGame = useCallback(() => {
        setBoard(Array(9).fill(''));
        setCurrentPlayer('X');
        setGameActive(true);
        setWinPattern(null);
    }, []);

    const resetScore = useCallback(() => {
        setScores({ X: 0, O: 0, Draw: 0 });
        resetGame();
    }, [resetGame]);

    const setGameMode = useCallback((newMode: GameMode) => {
        setMode(newMode);
        resetGame();
    }, [resetGame]);

    const updateStatus = useCallback(() => {
        if (!gameActive) return;
        const playerName = playerNames[currentPlayer] || currentPlayer;
        return `Ход: ${currentPlayer} (${playerName})`;
    }, [gameActive, currentPlayer, playerNames]);

    // Bot logic
    useEffect(() => {
        if (mode !== 'bot' || !gameActive || currentPlayer !== 'O') return;

        const timer = setTimeout(() => {
            // Try to win
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    const testBoard = [...board];
                    testBoard[i] = 'O';
                    if (checkWin(testBoard, 'O')) {
                        makeMove(i);
                        return;
                    }
                }
            }

            // Block player
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    const testBoard = [...board];
                    testBoard[i] = 'X';
                    if (checkWin(testBoard, 'X')) {
                        makeMove(i);
                        return;
                    }
                }
            }

            // Take center
            if (board[4] === '') {
                makeMove(4);
                return;
            }

            // Take corners
            const corners = [0, 2, 6, 8].filter(i => board[i] === '');
            if (corners.length > 0) {
                makeMove(corners[Math.floor(Math.random() * corners.length)]);
                return;
            }

            // Take any available
            const empty = board.map((v, i) => v === '' ? i : -1).filter(i => i !== -1);
            if (empty.length > 0) {
                makeMove(empty[Math.floor(Math.random() * empty.length)]);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [mode, gameActive, currentPlayer, board, checkWin, makeMove]);

    return {
        board,
        currentPlayer,
        gameActive,
        mode,
        scores,
        playerNames,
        winPattern,
        makeMove,
        resetGame,
        resetScore,
        setGameMode,
        setPlayerNames,
        updateStatus
    };
};
