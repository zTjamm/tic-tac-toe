export type ChatMessage = {
    sender: string;
    text: string;
    socketId: string;
    timestamp: number;
};

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
    inMatch: boolean;
    strikes: number;
}

/* ==================== «Точки и квадраты» (снимок с сервера) ==================== */

export type MatchPhase = 'starting' | 'playing' | 'finished';

export interface MatchPlayer {
    id: string;
    /** номер игрока в снимке: в edges и boxOwner хранятся именно слоты */
    slot: number;
    username: string;
    /** закрытые квадраты */
    score: number;
    isBot: boolean;
    connected: boolean;
    /** рейтинг до матча: по нему объясняется размер изменения */
    rating: number;
    /** накопленные обрывы связи; 3 означает автопроигрыш при следующем */
    strikes: number;
}

export type MatchResult = {
    type: 'finished' | 'cancelled';
    winnerId?: string | null;
    reason?: string;
};

export interface MatchSnapshot {
    roomId: string;
    phase: MatchPhase;
    /** точек по стороне: 5 даёт 16 квадратов и 40 линий */
    grid: number;
    /** 40 элементов: -1 - линия не проведена, иначе слот игрока */
    edges: number[];
    /** 16 элементов: -1 - квадрат не забран, иначе слот игрока */
    boxOwner: number[];
    turnId: string | null;
    /** кто ходил первым; ход первого обычно сильнее, и это стоит показать */
    firstId: string | null;
    startDeadline: number | null;
    turnDeadline: number | null;
    /** момент серверного времени на момент снимка; поправка к часам игрока */
    serverNow?: number;
    result: MatchResult | null;
    totalBoxes: number;
    totalEdges: number;
    boxesLeft: number;
    /** сколько линий осталось провести: конец партии становится зрелищем */
    movesLeft: number;
    /** квадраты, которые игрок, которому ход, обязан отдать */
    danger: number[];
    /** квадраты, забранные последним ходом: доска мигает ими */
    lastGainedBoxes: number[];
    players: MatchPlayer[];
    timing: {
        start: number;
        turn: number;
    };
    /** изменение рейтинга по игрокам при финале; null пока матч не закончен */
    ratingDelta: Record<string, number> | null;
}

export interface MoveInfo {
    edge: number;
    playerId: string;
    /** сколько квадратов забранно этим ходом */
    gained: number;
    /** ход остался у игрока: он закрыл квадрат и ходит снова */
    extraTurn: boolean;
    /** ход сделан сервером за игрока по таймауту */
    auto: boolean;
}

export interface MatchStateMessage {
    type: string;
    extra: MoveInfo | null;
    snapshot: MatchSnapshot;
}

/* ============================== подбор соперника ============================== */

export type SearchReason = 'empty' | 'exhausted' | 'locked' | 'inMatch';

export type SearchState =
    | { status: 'idle' }
    | { status: 'searching'; checked: number; total: number; by?: string }
    | { status: 'done'; reason: SearchReason };

export interface OnlineUser {
    username: string;
    rating: number;
    /** уже в матче — вызов ему недоступен */
    inMatch: boolean;
    /** накопленные нарушения, чтобы видеть, кто рискует автопроигрышем */
    strikes: number;
}
