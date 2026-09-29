export type PlayerSymbol = 'X' | 'O';
export type CellValue = PlayerSymbol | '';

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
    streak: number;
    maxStreak: number;
}

/** Друг из /api/friends: сервер хранит дружбу взаимной. */
export interface Friend {
    username: string;
    rating: number;
    online: boolean;
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
    /** рейтинг до матча: по нему объясняется размер изменения */
    rating: number;
    /** накопленные нарушения; 3 означает, что следующее приведёт к автопроигрышу */
    strikes: number;
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
    /** момент серверного времени на момент снимка; поправка к часам игрока */
    serverNow?: number;
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
    /** изменение рейтинга по игрокам при финале; null пока матч не закончен */
    ratingDelta: Record<string, number> | null;
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

export interface OnlineUser {
    username: string;
    rating: number;
    /** уже в матче — вызов ему недоступен */
    inMatch: boolean;
    /** накопленные нарушения, чтобы видеть, кто рискует автопроигрышем */
    strikes: number;
}

/** Друг из /api/friends: сервер хранит дружбу взаимной. */
export interface Friend {
    username: string;
    rating: number;
    online: boolean;
    inMatch: boolean;
    strikes: number;
}
