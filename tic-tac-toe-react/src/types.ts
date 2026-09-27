export type PlayerSymbol = 'X' | 'O';
export type CellValue = PlayerSymbol | '';
export type GameMode = 'pvp' | 'bot' | 'online';
export type GameStatus = 'playing' | 'won' | 'draw';

export interface Player {
    id: string;
    symbol: PlayerSymbol;
    username: string;
}

export interface Room {
    id: string;
    board: CellValue[];
    players: Player[];
    currentPlayer: PlayerSymbol;
    gameActive: boolean;
    scores: { X: number; O: number; Draw: number };
}

export interface User {
    username: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    streak: number;
    maxStreak: number;
}

export interface ChatMessage {
    sender: string;
    text: string;
    socketId: string;
    timestamp: number;
}

export interface LeaderboardEntry {
    username: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
}
