// Game and Discord types
export interface BingoSquare {
    userId: string;
    username: string;
    avatar: string;
    streamerChannel?: string;
}

export interface BingoGameState {
    phrases: string[];
    covered: Record<number, BingoSquare>;
    lastUpdate: number;
}

export interface TagGameState {
    players: Array<{id: string, username: string, avatar: string, joinedAt: number}>;
    currentIt: string | null;
    tags: Array<{from: string, to: string, timestamp: number, channel: string}>;
    immunity: Record<string, string | number>;
    lastUpdate: number;
}

export interface DiscordMessage {
    id: string;
    content: string;
    author?: {
        id: string;
        username: string;
        bot?: boolean;
    };
}

export interface ChatHistoryMessage {
    id: string;
    user: string;
    message: string;
    color?: string;
    badges?: Record<string, string>;
    isSystemMessage: boolean;
}

export interface WebSocketMessage {
    type: string;
    payload: any;
}

export interface PointsRequest {
    username: string;
    points: number;
    reason: string;
}