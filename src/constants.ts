// StreamWeaver Constants
export const TIMEOUTS = {
    PORT_CLEANUP: 10000,
    PROCESS_START_DELAY: 3000,
    RECONNECT_MIN_DELAY: 10000,
    RECONNECT_MAX_DELAY: 300000,
    IMMUNITY_DURATION: 15 * 60 * 1000, // 15 minutes
    CHAT_CHECK_INTERVAL: 5000
} as const;

export const PORTS = {
    DEFAULT_WS: 8090,
    DEFAULT_NEXT: 3100,
    DEFAULT_GENKIT: 4000,
    GENKIT_SECONDARY: 4003
} as const;

export const LIMITS = {
    MAX_CHAT_HISTORY: 1000,
    MAX_RECONNECT_ATTEMPTS: 10
} as const;

export const EVENT_TYPES = {
    BINGO_STATE_UPDATE: 'bingo-state-update',
    TAG_STATE_UPDATE: 'tag-state-update',
    TWITCH_STATUS: 'twitch-status',
    TWITCH_MESSAGE: 'twitch-message',
    VOICE_USER_JOINED: 'voice-user-joined',
    VOICE_USER_LEFT: 'voice-user-left',
    VOICE_USER_MUTED: 'voice-user-muted'
} as const;