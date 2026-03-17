/**
 * Trigger Registry - Central registry for all trigger types
 * Based on Streamer.bot's 350+ trigger system
 */

import { TriggerType } from '../types';

export interface TriggerDefinition {
  id: number;
  name: string;
  category: string;
  description: string;
  platform?: string;
  fields?: TriggerField[];
  variables?: TriggerVariable[];
}

export interface TriggerField {
  name: string;
  type: 'toggle' | 'select' | 'number' | 'text' | 'multiselect';
  label: string;
  description?: string;
  options?: { label: string; value: any }[];
  default?: any;
}

export interface TriggerVariable {
  name: string;
  type: string;
  description: string;
  example?: any;
}

export class TriggerRegistry {
  private static definitions: Map<number, TriggerDefinition> = new Map();

  static initialize() {
    // Core Triggers
    this.register({
      id: 401,
      name: 'Command Triggered',
      category: 'Core/Commands',
      description: 'Triggered when a command is executed',
      variables: [
        { name: 'commandId', type: 'string', description: 'The command ID', example: 'cmd-123' },
        { name: 'command', type: 'string', description: 'The command text', example: '!shoutout' },
        { name: 'user', type: 'string', description: 'User who triggered the command' },
        { name: 'message', type: 'string', description: 'Full message text' },
        { name: 'rawInput', type: 'string', description: 'Input after command' }
      ]
    });

    this.register({
      id: 1100,
      name: 'Timed Action',
      category: 'Core/Timed',
      description: 'Triggered at specified intervals',
      fields: [
        { name: 'interval', type: 'number', label: 'Interval (seconds)' },
        { name: 'repeat', type: 'toggle', label: 'Repeat', default: true }
      ]
    });

    this.register({
      id: 1101,
      name: 'At Specific Time',
      category: 'Core/Timed',
      description: 'Triggered at a specific time',
      fields: [
        { name: 'time', type: 'text', label: 'Time (HH:mm)' },
        { name: 'days', type: 'multiselect', label: 'Days', options: [
          { label: 'Monday', value: 1 },
          { label: 'Tuesday', value: 2 },
          { label: 'Wednesday', value: 3 },
          { label: 'Thursday', value: 4 },
          { label: 'Friday', value: 5 },
          { label: 'Saturday', value: 6 },
          { label: 'Sunday', value: 0 }
        ]}
      ]
    });

    this.register({
      id: 1200,
      name: 'Global Hotkey',
      category: 'Core/Hotkeys',
      description: 'Triggered by a global hotkey',
      fields: [
        { name: 'hotkey', type: 'text', label: 'Hotkey Combination' }
      ]
    });

    this.register({
      id: 1300,
      name: 'File Watcher - File Created',
      category: 'Core/File Watcher',
      description: 'Triggered when a file is created',
      fields: [
        { name: 'path', type: 'text', label: 'Watch Path' },
        { name: 'filter', type: 'text', label: 'File Filter (*.txt)', default: '*.*' }
      ],
      variables: [
        { name: 'fileName', type: 'string', description: 'Name of the file' },
        { name: 'filePath', type: 'string', description: 'Full path to the file' }
      ]
    });

    this.register({
      id: 1301,
      name: 'File Watcher - File Modified',
      category: 'Core/File Watcher',
      description: 'Triggered when a file is modified',
      fields: [
        { name: 'path', type: 'text', label: 'Watch Path' },
        { name: 'filter', type: 'text', label: 'File Filter (*.txt)', default: '*.*' }
      ],
      variables: [
        { name: 'fileName', type: 'string', description: 'Name of the file' },
        { name: 'filePath', type: 'string', description: 'Full path to the file' }
      ]
    });

    this.register({
      id: 1302,
      name: 'File Watcher - File Deleted',
      category: 'Core/File Watcher',
      description: 'Triggered when a file is deleted',
      fields: [
        { name: 'path', type: 'text', label: 'Watch Path' },
        { name: 'filter', type: 'text', label: 'File Filter (*.txt)', default: '*.*' }
      ],
      variables: [
        { name: 'fileName', type: 'string', description: 'Name of the file' },
        { name: 'filePath', type: 'string', description: 'Full path to the file' }
      ]
    });

    // Twitch Triggers
    this.register({
      id: 101,
      name: 'Follow',
      category: 'Twitch/Channel',
      platform: 'twitch',
      description: 'Triggered when someone follows the channel',
      variables: [
        { name: 'user', type: 'string', description: 'Username of the follower' },
        { name: 'userId', type: 'string', description: 'User ID of the follower' },
        { name: 'followedAt', type: 'string', description: 'Timestamp of follow' }
      ]
    });

    this.register({
      id: 102,
      name: 'Cheer',
      category: 'Twitch/Bits',
      platform: 'twitch',
      description: 'Triggered when someone cheers bits',
      fields: [
        { name: 'minBits', type: 'number', label: 'Minimum Bits' },
        { name: 'maxBits', type: 'number', label: 'Maximum Bits' }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the cheerer' },
        { name: 'bits', type: 'number', description: 'Number of bits cheered' },
        { name: 'message', type: 'string', description: 'Cheer message' },
        { name: 'isAnonymous', type: 'boolean', description: 'Whether the cheer is anonymous' }
      ]
    });

    this.register({
      id: 103,
      name: 'Subscribe',
      category: 'Twitch/Subscriptions',
      platform: 'twitch',
      description: 'Triggered when someone subscribes',
      fields: [
        { name: 'tier1', type: 'toggle', label: 'Tier 1', default: true },
        { name: 'tier2', type: 'toggle', label: 'Tier 2', default: true },
        { name: 'tier3', type: 'toggle', label: 'Tier 3', default: true },
        { name: 'prime', type: 'toggle', label: 'Prime', default: true }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the subscriber' },
        { name: 'tier', type: 'string', description: 'Subscription tier' },
        { name: 'message', type: 'string', description: 'Sub message' }
      ]
    });

    this.register({
      id: 104,
      name: 'Resubscribe',
      category: 'Twitch/Subscriptions',
      platform: 'twitch',
      description: 'Triggered when someone resubscribes',
      fields: [
        { name: 'tier1', type: 'toggle', label: 'Tier 1', default: true },
        { name: 'tier2', type: 'toggle', label: 'Tier 2', default: true },
        { name: 'tier3', type: 'toggle', label: 'Tier 3', default: true },
        { name: 'prime', type: 'toggle', label: 'Prime', default: true },
        { name: 'minMonths', type: 'number', label: 'Minimum Months' },
        { name: 'maxMonths', type: 'number', label: 'Maximum Months' }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the subscriber' },
        { name: 'months', type: 'number', description: 'Months subscribed' },
        { name: 'tier', type: 'string', description: 'Subscription tier' },
        { name: 'message', type: 'string', description: 'Resub message' }
      ]
    });

    this.register({
      id: 105,
      name: 'Gift Subscription',
      category: 'Twitch/Subscriptions',
      platform: 'twitch',
      description: 'Triggered when someone gifts a subscription',
      fields: [
        { name: 'tier1', type: 'toggle', label: 'Tier 1', default: true },
        { name: 'tier2', type: 'toggle', label: 'Tier 2', default: true },
        { name: 'tier3', type: 'toggle', label: 'Tier 3', default: true }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the gifter' },
        { name: 'recipientUser', type: 'string', description: 'Username of the recipient' },
        { name: 'tier', type: 'string', description: 'Subscription tier' },
        { name: 'months', type: 'number', description: 'Months gifted' }
      ]
    });

    this.register({
      id: 106,
      name: 'Gift Bomb',
      category: 'Twitch/Subscriptions',
      platform: 'twitch',
      description: 'Triggered when someone gifts multiple subscriptions',
      fields: [
        { name: 'tier1', type: 'toggle', label: 'Tier 1', default: true },
        { name: 'tier2', type: 'toggle', label: 'Tier 2', default: true },
        { name: 'tier3', type: 'toggle', label: 'Tier 3', default: true },
        { name: 'minGifts', type: 'number', label: 'Minimum Gifts' },
        { name: 'maxGifts', type: 'number', label: 'Maximum Gifts' }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the gifter' },
        { name: 'gifts', type: 'number', description: 'Number of gifts' },
        { name: 'tier', type: 'string', description: 'Subscription tier' },
        { name: 'totalGifts', type: 'number', description: 'Total gifts by user' }
      ]
    });

    this.register({
      id: 107,
      name: 'Raid',
      category: 'Twitch/Channel',
      platform: 'twitch',
      description: 'Triggered when the channel gets raided',
      fields: [
        { name: 'minViewers', type: 'number', label: 'Minimum Viewers' },
        { name: 'maxViewers', type: 'number', label: 'Maximum Viewers' }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the raider' },
        { name: 'viewers', type: 'number', description: 'Number of viewers' }
      ]
    });

    this.register({
      id: 112,
      name: 'Channel Point Reward Redemption',
      category: 'Twitch/Channel Points',
      platform: 'twitch',
      description: 'Triggered when a channel point reward is redeemed',
      fields: [
        { name: 'rewardId', type: 'select', label: 'Reward' }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username of the redeemer' },
        { name: 'rewardId', type: 'string', description: 'Reward ID' },
        { name: 'rewardTitle', type: 'string', description: 'Reward title' },
        { name: 'rewardCost', type: 'number', description: 'Reward cost' },
        { name: 'userInput', type: 'string', description: 'User input (if required)' },
        { name: 'rawInput', type: 'string', description: 'Raw input from user' }
      ]
    });

    this.register({
      id: 200,
      name: 'Chat Message',
      category: 'Twitch/Chat',
      platform: 'twitch',
      description: 'Triggered on every chat message',
      fields: [
        { name: 'pattern', type: 'text', label: 'Message Pattern (regex)' },
        { name: 'excludeBots', type: 'toggle', label: 'Exclude Bot Messages', default: true }
      ],
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'message', type: 'string', description: 'Message text' },
        { name: 'messageId', type: 'string', description: 'Message ID' },
        { name: 'bits', type: 'number', description: 'Bits included in message' },
        { name: 'isSubscriber', type: 'boolean', description: 'Is user subscribed' },
        { name: 'isModerator', type: 'boolean', description: 'Is user a moderator' },
        { name: 'isVip', type: 'boolean', description: 'Is user a VIP' }
      ]
    });

    this.register({
      id: 201,
      name: 'First Message',
      category: 'Twitch/Chat',
      platform: 'twitch',
      description: 'Triggered on user\'s first message',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'message', type: 'string', description: 'First message text' }
      ]
    });

    this.register({
      id: 210,
      name: 'Stream Online',
      category: 'Twitch/Stream',
      platform: 'twitch',
      description: 'Triggered when stream goes online',
      variables: [
        { name: 'title', type: 'string', description: 'Stream title' },
        { name: 'game', type: 'string', description: 'Current game/category' }
      ]
    });

    this.register({
      id: 211,
      name: 'Stream Offline',
      category: 'Twitch/Stream',
      platform: 'twitch',
      description: 'Triggered when stream goes offline'
    });

    this.register({
      id: 212,
      name: 'Stream Update',
      category: 'Twitch/Stream',
      platform: 'twitch',
      description: 'Triggered when stream title or category changes',
      variables: [
        { name: 'title', type: 'string', description: 'New stream title' },
        { name: 'game', type: 'string', description: 'New game/category' },
        { name: 'oldTitle', type: 'string', description: 'Previous stream title' },
        { name: 'oldGame', type: 'string', description: 'Previous game/category' }
      ]
    });

    // Hype Train
    this.register({
      id: 220,
      name: 'Hype Train Start',
      category: 'Twitch/Hype Train',
      platform: 'twitch',
      description: 'Triggered when a hype train starts',
      variables: [
        { name: 'level', type: 'number', description: 'Current level' },
        { name: 'goal', type: 'number', description: 'Goal for next level' }
      ]
    });

    this.register({
      id: 221,
      name: 'Hype Train End',
      category: 'Twitch/Hype Train',
      platform: 'twitch',
      description: 'Triggered when a hype train ends',
      variables: [
        { name: 'level', type: 'number', description: 'Final level reached' },
        { name: 'topContributors', type: 'array', description: 'Top contributors' }
      ]
    });

    // OBS Triggers
    this.register({
      id: 301,
      name: 'Scene Changed',
      category: 'OBS Studio/Scenes',
      description: 'Triggered when OBS scene changes',
      fields: [
        { name: 'sceneName', type: 'select', label: 'Scene Name' },
        { name: 'connectionId', type: 'select', label: 'OBS Connection' }
      ],
      variables: [
        { name: 'sceneName', type: 'string', description: 'New scene name' },
        { name: 'previousScene', type: 'string', description: 'Previous scene name' }
      ]
    });

    this.register({
      id: 310,
      name: 'Streaming Started',
      category: 'OBS Studio/Streaming',
      description: 'Triggered when OBS streaming starts'
    });

    this.register({
      id: 311,
      name: 'Streaming Stopped',
      category: 'OBS Studio/Streaming',
      description: 'Triggered when OBS streaming stops',
      variables: [
        { name: 'duration', type: 'number', description: 'Stream duration in seconds' }
      ]
    });

    this.register({
      id: 320,
      name: 'Recording Started',
      category: 'OBS Studio/Recording',
      description: 'Triggered when OBS recording starts'
    });

    this.register({
      id: 321,
      name: 'Recording Stopped',
      category: 'OBS Studio/Recording',
      description: 'Triggered when OBS recording stops',
      variables: [
        { name: 'fileName', type: 'string', description: 'Recording file path' },
        { name: 'duration', type: 'number', description: 'Recording duration in seconds' }
      ]
    });

    // Voice Control
    this.register({
      id: 1400,
      name: 'Voice Command Recognized',
      category: 'Voice Control',
      description: 'Triggered when a voice command is recognized',
      fields: [
        { name: 'commandId', type: 'select', label: 'Voice Command' }
      ],
      variables: [
        { name: 'command', type: 'string', description: 'Recognized command' },
        { name: 'confidence', type: 'number', description: 'Recognition confidence (0-100)' }
      ]
    });

    // MIDI
    this.register({
      id: 1500,
      name: 'MIDI Note On',
      category: 'MIDI',
      description: 'Triggered by MIDI note on event',
      fields: [
        { name: 'deviceId', type: 'select', label: 'MIDI Device' },
        { name: 'channel', type: 'number', label: 'Channel (1-16)' },
        { name: 'note', type: 'number', label: 'Note (0-127)' }
      ],
      variables: [
        { name: 'channel', type: 'number', description: 'MIDI channel' },
        { name: 'note', type: 'number', description: 'Note number' },
        { name: 'velocity', type: 'number', description: 'Note velocity' }
      ]
    });

    this.register({
      id: 1501,
      name: 'MIDI Control Change',
      category: 'MIDI',
      description: 'Triggered by MIDI CC event',
      fields: [
        { name: 'deviceId', type: 'select', label: 'MIDI Device' },
        { name: 'channel', type: 'number', label: 'Channel (1-16)' },
        { name: 'control', type: 'number', label: 'Control (0-127)' }
      ],
      variables: [
        { name: 'channel', type: 'number', description: 'MIDI channel' },
        { name: 'control', type: 'number', description: 'Control number' },
        { name: 'value', type: 'number', description: 'Control value' }
      ]
    });

    // ====================
    // NEW: Voice Control Triggers
    // ====================
    this.register({
      id: 8001,
      name: 'Voice Command Recognized',
      category: 'Voice/Recognition',
      description: 'Triggered when a voice command is recognized',
      variables: [
        { name: 'transcription', type: 'string', description: 'Voice transcription text' },
        { name: 'confidence', type: 'number', description: 'Recognition confidence (0-1)' },
        { name: 'commandType', type: 'string', description: 'Type of command recognized' }
      ]
    });

    this.register({
      id: 8002,
      name: 'Voice Shoutout Detected',
      category: 'Voice/Commands',
      description: 'Triggered when a voice shoutout command is detected',
      variables: [
        { name: 'transcription', type: 'string', description: 'Voice transcription' },
        { name: 'targetUser', type: 'string', description: 'Matched username' },
        { name: 'confidence', type: 'string', description: 'Match confidence' }
      ]
    });

    // ====================
    // NEW: Twitch Poll Triggers
    // ====================
    this.register({
      id: 8010,
      name: 'Twitch Poll Started',
      category: 'Twitch/Polls',
      platform: 'Twitch',
      description: 'Triggered when a poll starts',
      variables: [
        { name: 'pollId', type: 'string', description: 'Poll ID' },
        { name: 'title', type: 'string', description: 'Poll title' },
        { name: 'choices', type: 'array', description: 'Poll choices' },
        { name: 'duration', type: 'number', description: 'Duration in seconds' }
      ]
    });

    this.register({
      id: 8011,
      name: 'Twitch Poll Progress',
      category: 'Twitch/Polls',
      platform: 'Twitch',
      description: 'Triggered during poll voting',
      variables: [
        { name: 'pollId', type: 'string', description: 'Poll ID' },
        { name: 'votes', type: 'object', description: 'Vote counts per choice' }
      ]
    });

    this.register({
      id: 8012,
      name: 'Twitch Poll Ended',
      category: 'Twitch/Polls',
      platform: 'Twitch',
      description: 'Triggered when a poll ends',
      variables: [
        { name: 'pollId', type: 'string', description: 'Poll ID' },
        { name: 'winner', type: 'string', description: 'Winning choice' },
        { name: 'votes', type: 'object', description: 'Final vote counts' }
      ]
    });

    // ====================
    // NEW: Twitch Prediction Triggers
    // ====================
    this.register({
      id: 8020,
      name: 'Twitch Prediction Started',
      category: 'Twitch/Predictions',
      platform: 'Twitch',
      description: 'Triggered when a prediction starts',
      variables: [
        { name: 'predictionId', type: 'string', description: 'Prediction ID' },
        { name: 'title', type: 'string', description: 'Prediction title' },
        { name: 'outcomes', type: 'array', description: 'Prediction outcomes' }
      ]
    });

    this.register({
      id: 8021,
      name: 'Twitch Prediction Locked',
      category: 'Twitch/Predictions',
      platform: 'Twitch',
      description: 'Triggered when a prediction is locked',
      variables: [
        { name: 'predictionId', type: 'string', description: 'Prediction ID' },
        { name: 'points', type: 'object', description: 'Points per outcome' }
      ]
    });

    this.register({
      id: 8022,
      name: 'Twitch Prediction Resolved',
      category: 'Twitch/Predictions',
      platform: 'Twitch',
      description: 'Triggered when a prediction is resolved',
      variables: [
        { name: 'predictionId', type: 'string', description: 'Prediction ID' },
        { name: 'winningOutcome', type: 'string', description: 'Winning outcome' },
        { name: 'winners', type: 'number', description: 'Number of winners' },
        { name: 'pointsWon', type: 'number', description: 'Total points won' }
      ]
    });

    // ====================
    // NEW: YouTube Triggers
    // ====================
    this.register({
      id: 8030,
      name: 'YouTube Member Joined',
      category: 'YouTube/Memberships',
      platform: 'YouTube',
      description: 'Triggered when someone becomes a member',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'levelName', type: 'string', description: 'Membership level' },
        { name: 'message', type: 'string', description: 'Join message' }
      ]
    });

    this.register({
      id: 8031,
      name: 'YouTube Member Milestone',
      category: 'YouTube/Memberships',
      platform: 'YouTube',
      description: 'Triggered on membership milestone',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'months', type: 'number', description: 'Months subscribed' },
        { name: 'message', type: 'string', description: 'Milestone message' }
      ]
    });

    this.register({
      id: 8032,
      name: 'YouTube Super Chat',
      category: 'YouTube/Super Chat',
      platform: 'YouTube',
      description: 'Triggered on Super Chat',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'amount', type: 'number', description: 'Amount in USD' },
        { name: 'currency', type: 'string', description: 'Currency code' },
        { name: 'message', type: 'string', description: 'Super Chat message' }
      ]
    });

    // ====================
    // NEW: Kick Triggers
    // ====================
    this.register({
      id: 8040,
      name: 'Kick Subscription',
      category: 'Kick/Subscriptions',
      platform: 'Kick',
      description: 'Triggered on subscription',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'months', type: 'number', description: 'Months subscribed' },
        { name: 'gifted', type: 'boolean', description: 'Is gifted sub' },
        { name: 'gifter', type: 'string', description: 'Gifter username' }
      ]
    });

    this.register({
      id: 8041,
      name: 'Kick Gift Bomb',
      category: 'Kick/Gifts',
      platform: 'Kick',
      description: 'Triggered on gift bomb',
      variables: [
        { name: 'gifter', type: 'string', description: 'Gifter username' },
        { name: 'giftCount', type: 'number', description: 'Number of gifts' },
        { name: 'giftName', type: 'string', description: 'Gift name' }
      ]
    });

    // ====================
    // NEW: TikTok Triggers
    // ====================
    this.register({
      id: 8050,
      name: 'TikTok Gift Received',
      category: 'TikTok/Gifts',
      platform: 'TikTok',
      description: 'Triggered when receiving a TikTok gift',
      variables: [
        { name: 'user', type: 'string', description: 'Username' },
        { name: 'giftName', type: 'string', description: 'Gift name' },
        { name: 'giftId', type: 'number', description: 'Gift ID' },
        { name: 'count', type: 'number', description: 'Gift count' },
        { name: 'diamondCount', type: 'number', description: 'Diamond value' }
      ]
    });

    this.register({
      id: 8051,
      name: 'TikTok Share',
      category: 'TikTok/Engagement',
      platform: 'TikTok',
      description: 'Triggered when someone shares the stream',
      variables: [
        { name: 'user', type: 'string', description: 'Username' }
      ]
    });

    this.register({
      id: 8052,
      name: 'TikTok Follow',
      category: 'TikTok/Engagement',
      platform: 'TikTok',
      description: 'Triggered when someone follows',
      variables: [
        { name: 'user', type: 'string', description: 'Username' }
      ]
    });

    console.log(`TriggerRegistry initialized with ${this.definitions.size} triggers`);
  }

  private static register(definition: TriggerDefinition) {
    this.definitions.set(definition.id, definition);
  }

  static getDefinition(id: number): TriggerDefinition | undefined {
    return this.definitions.get(id);
  }

  static getAllDefinitions(): TriggerDefinition[] {
    return Array.from(this.definitions.values());
  }

  static getDefinitionsByCategory(category: string): TriggerDefinition[] {
    return Array.from(this.definitions.values())
      .filter(def => def.category.startsWith(category));
  }

  static getDefinitionsByPlatform(platform: string): TriggerDefinition[] {
    return Array.from(this.definitions.values())
      .filter(def => !def.platform || def.platform === platform);
  }

  static getCategories(): string[] {
    const categories = new Set<string>();
    this.definitions.forEach(def => {
      const mainCategory = def.category.split('/')[0];
      categories.add(mainCategory);
    });
    return Array.from(categories).sort();
  }
}

// Initialize the registry
TriggerRegistry.initialize();
