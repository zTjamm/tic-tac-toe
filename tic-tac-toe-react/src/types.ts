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

/* ===================== матч «до 5 очков» (снимок с сервера) ===================== */

export type MatchPhase = 'guessing' | 'roleChoice' | 'playing' | 'finished';
export type GuessSub = 'countdown' | 'picking' | 'reveal';

export interface MatchPlayer {
    id: string;
    username: string;
    mark: PlayerSymbol;
    score: number;
    isBot: boolean;
    connected: boolean;
    /** клетка, выбранная в угадайке; null если ещё не выбрал */
    pick: number | null;
    isAttacker: boolean;
    isGuessWinner: boolean;
}

export interface Guessing {
    sub: GuessSub;
    /** число, открытое системой; null пока не открыто */
    systemNumber: number | null;
    winnerId: string | null;
    deadline: number | null;
}

export interface MatchResult {
    type: 'finished' | 'cancelled';
    winnerId?: string;
    reason?: string;
}

export interface MatchSnapshot {
    roomId: string;
    phase: MatchPhase;
    round: number;
    maxRounds: number;
    targetScore: number;
    board: CellValue[];
    currentMark: PlayerSymbol | null;
    attackerId: string | null;
    turnDeadline: number | null;
    deadline: number | null;
    result: MatchResult | null;
    cellNumbers: number[];
    players: MatchPlayer[];
    guessing: Guessing | null;
    timing: {
        guessCountdown: number;
        guessPick: number;
        guessRole: number;
        turn: number;
    };
}

export interface MatchStateMessage {
    type: string;
    extra: RoundEndInfo | null;
    snapshot: MatchSnapshot;
}

export interface RoundEndInfo {
    outcome: 'attacker' | 'defender' | 'draw';
    gainA: number;
    gainD: number;
    winPattern: number[] | null;
}
