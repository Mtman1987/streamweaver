// Core automation framework types - similar to Streamer.bot's structure

export interface Command {
  id: string;
  name: string;
  enabled: boolean;
  command: string; // The actual command text like "!shoutout"
  mode: CommandMode;
  regexExplicitCapture?: boolean;
  location: CommandLocation;
  ignoreBotAccount: boolean;
  ignoreInternal: boolean;
  sources: number; // Bitfield for platforms (Twitch, Discord, etc.)
  persistCounter: boolean;
  persistUserCounter: boolean;
  caseSensitive: boolean;
  globalCooldown: number;
  userCooldown: number;
  group?: string;
  grantType: GrantType;
  permittedUsers: string[];
  permittedGroups: string[];
}

export interface Action {
  id: string;
  name: string;
  enabled: boolean;
  group?: string;
  alwaysRun: boolean;
  randomAction: boolean;
  concurrent: boolean;
  excludeFromHistory: boolean;
  excludeFromPending: boolean;
  queue?: string;
  triggers: Trigger[];
  subActions: SubAction[];
}

export interface Trigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  exclusions: string[];
  // Command-specific
  commandId?: string;
  // Event-specific
  min?: number;
  max?: number;
  tiers?: number;
  // Channel point reward-specific
  rewardId?: string;
}

export interface SubAction {
  id: string;
  type: SubActionType;
  enabled: boolean;
  weight: number;
  parentId?: string;
  index: number;
  
  // Nested structure for IF/ELSE blocks
  subActions?: SubAction[];
  random?: boolean;
  
  // Common properties
  text?: string;
  useBot?: boolean;
  fallback?: boolean;
  
  // Variable operations
  variableName?: string;
  value?: any;
  autoType?: boolean;
  persisted?: boolean;
  destination?: number; // 0=Global, 1=User, 2=Target User
  source?: number; // 0=Value, 1=Math, 2=Variable
  defaultValue?: any;
  destinationVariable?: string;
  
  // Conditional logic
  input?: string;
  operation?: number; // 0=Equals, 1=Not Equals, 2=Contains, 6=IsEmpty
  
  // HTTP requests
  url?: string;
  headers?: Record<string, string>;
  parseAsJson?: boolean;
  
  // File operations
  file?: string;
  append?: boolean;
  
  // User operations
  userLogin?: string;
  
  // Sound operations
  soundFile?: string;
  volume?: number;
  finishBeforeContinuing?: boolean;
  device?: string;
  
  // Action execution
  actionId?: string;
  runImmedately?: boolean;
  
  // Wait operations
  maxValue?: string;
  
  // OBS operations
  sceneName?: string;
  sourceName?: string;
  state?: number; // 0=Hide, 1=Show
  connectionId?: string;
  fileName?: string;
  
  // C# code execution
  name?: string;
  description?: string;
  references?: string[];
  byteCode?: string;
  precompile?: boolean;
  delayStart?: boolean;
  saveResultToVariable?: boolean;
  saveToVariable?: string;
  
  // Dynamic properties for extensibility
  [key: string]: any;
}

export enum CommandMode {
  EXACT = 0,
  REGEX = 1
}

export enum CommandLocation {
  START = 0,
  ANYWHERE = 1
}

export enum GrantType {
  EVERYONE = 0,
  SPECIFIC_USERS_GROUPS = 1
}

export enum TriggerType {
  COMMAND = 401,
  FOLLOW = 101,
  CHEER = 102,
  SUBSCRIBE = 103,
  RESUB = 104,
  GIFT_SUB = 105,
  GIFT_BOMB = 106,
  RAID = 107,
  CHANNEL_POINT_REWARD = 112
}

export enum SubActionType {
  // Core actions (matching Streamer.bot exactly)
  PLAY_SOUND = 1,
  WRITE_TO_FILE = 3,
  RUN_ACTION = 4,
  SEND_MESSAGE = 10,
  TWITCH_SLOW_MODE = 14,
  TWITCH_SET_TITLE = 15,
  TWITCH_SET_GAME = 16,
  TWITCH_CREATE_MARKER = 17,
  GET_DATE_TIME = 21,
  OBS_SET_SCENE = 25,
  OBS_TOGGLE_SOURCE = 30,
  OBS_SET_TEXT = 31,
  OBS_SET_BROWSER_SOURCE = 32,
  GET_USER_INFO = 50,
  GET_USER_INFO_BY_LOGIN = 51,
  
  // Variables (matching Streamer.bot)
  GET_GLOBAL_VAR = 121,
  SET_GLOBAL_VAR = 122,
  SET_ARGUMENT = 123,
  
  // Control flow
  IF_ELSE = 120,
  BREAK = 124,
  
  // Nested blocks for IF/ELSE structure
  IF_BLOCK = 99901,
  ELSE_BLOCK = 99902,
  
  // Advanced actions
  WAIT = 1002,
  RANDOM_NUMBER = 1003,
  ACTION_STATE = 1004,
  HTTP_REQUEST = 1007,
  COMMENT = 1009,
  GET_COMMANDS = 1013,

  // Additional variable ops
  SET_USER_VAR = 1050,
  GET_USER_VAR = 1051,
  MATH_OPERATION = 1052,
  STRING_OPERATION = 1053,

  // Additional file ops
  READ_FROM_FILE = 4001,

  // Additional Twitch ops
  TWITCH_DELETE_MESSAGE = 2001,
  TWITCH_CLEAR_CHAT = 2002,
  TWITCH_TIMEOUT_USER = 2003,
  TWITCH_BAN_USER = 2004,
  TWITCH_UNBAN_USER = 2005,
  TWITCH_RUN_COMMERCIAL = 2010,

  // Additional OBS ops
  OBS_GET_CURRENT_SCENE = 3001,
  OBS_START_RECORDING = 3010,
  OBS_STOP_RECORDING = 3011,
  OBS_START_STREAMING = 3020,
  OBS_STOP_STREAMING = 3021,

  // Additional platform ops
  DISCORD_SEND_MESSAGE = 5001,
  YOUTUBE_SEND_MESSAGE = 6001,
  
  // OBS Media
  OBS_SET_MEDIA_SOURCE = 322,
  
  // Custom code execution
  EXECUTE_CODE = 99999
}

export interface ActionQueue {
  id: string;
  name: string;
  blocking: boolean;
  paused?: boolean;
  pendingCount?: number;
  completedCount?: number;
}

export interface ActionExecution {
  id: string;
  actionId: string;
  actionName: string;
  queueId?: string;
  state: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  variables: Record<string, any>;
  duration?: number;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface AutomationState {
  commands: Command[];
  actions: Action[];
  queues: ActionQueue[];
  globalVariables: Record<string, any>;
}