/**
 * SubAction Registry - Central registry for all sub-action types
 * Based on Streamer.bot's 300+ sub-action system
 */

export interface SubActionDefinition {
  id: number;
  name: string;
  category: string;
  description: string;
  fields: SubActionField[];
  handler: string; // Handler function name
  icon?: string;
}

export interface SubActionField {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'color' | 'file' | 'code' | 'variable';
  label: string;
  description?: string;
  required?: boolean;
  default?: any;
  options?: { label: string; value: any }[];
  min?: number;
  max?: number;
  placeholder?: string;
}

/**
 * Sub-Action Type Registry
 * IDs match Streamer.bot where applicable for compatibility
 */
export class SubActionRegistry {
  private static definitions: Map<number, SubActionDefinition> = new Map();

  static initialize() {
    // Core - Logic & Flow Control
    this.register({
      id: 1002,
      name: 'Delay',
      category: 'Core/Logic',
      description: 'Pause execution for a specified duration',
      fields: [
        { name: 'minDelay', type: 'number', label: 'Minimum Delay (ms)', required: true, default: 1000, min: 0 },
        { name: 'maxDelay', type: 'number', label: 'Maximum Delay (ms)', required: false, min: 0 }
      ],
      handler: 'handleDelay'
    });

    this.register({
      id: 124,
      name: 'Break',
      category: 'Core/Logic',
      description: 'Stop execution of the current action',
      fields: [],
      handler: 'handleBreak'
    });

    this.register({
      id: 1009,
      name: 'Comment',
      category: 'Core/Logic',
      description: 'Add a comment to your action (does nothing)',
      fields: [
        { name: 'comment', type: 'text', label: 'Comment', required: false, placeholder: 'Add a note here...' }
      ],
      handler: 'handleComment'
    });

    this.register({
      id: 120,
      name: 'If/Else',
      category: 'Core/Logic',
      description: 'Conditional logic block',
      fields: [
        { name: 'input', type: 'text', label: 'Value to Compare', required: true },
        { 
          name: 'operation', 
          type: 'select', 
          label: 'Comparison', 
          required: true,
          options: [
            { label: 'Equals', value: 0 },
            { label: 'Not Equals', value: 1 },
            { label: 'Contains', value: 2 },
            { label: 'Does Not Contain', value: 3 },
            { label: 'Starts With', value: 4 },
            { label: 'Ends With', value: 5 },
            { label: 'Is Empty', value: 6 },
            { label: 'Is Not Empty', value: 7 },
            { label: 'Greater Than', value: 8 },
            { label: 'Greater Than or Equal', value: 9 },
            { label: 'Less Than', value: 10 },
            { label: 'Less Than or Equal', value: 11 },
            { label: 'Regex Match', value: 12 }
          ]
        },
        { name: 'value', type: 'text', label: 'Compare To', required: false }
      ],
      handler: 'handleIfElse'
    });

    this.register({
      id: 1003,
      name: 'Random Number',
      category: 'Core/Logic',
      description: 'Generate a random number',
      fields: [
        { name: 'min', type: 'number', label: 'Minimum', required: true, default: 1 },
        { name: 'max', type: 'number', label: 'Maximum', required: true, default: 100 },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', required: true, default: 'randomNumber' }
      ],
      handler: 'handleRandomNumber'
    });

    // Variables - Global
    this.register({
      id: 122,
      name: 'Set Global Variable',
      category: 'Variables/Global',
      description: 'Set a global variable value',
      fields: [
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: true },
        { name: 'value', type: 'text', label: 'Value', required: true },
        { name: 'persisted', type: 'boolean', label: 'Persist To Disk', default: false }
      ],
      handler: 'handleSetGlobalVariable'
    });

    this.register({
      id: 121,
      name: 'Get Global Variable',
      category: 'Variables/Global',
      description: 'Get a global variable value',
      fields: [
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: true },
        { name: 'defaultValue', type: 'text', label: 'Default Value', required: false },
        { name: 'destinationVariable', type: 'variable', label: 'Save To Variable', required: false }
      ],
      handler: 'handleGetGlobalVariable'
    });

    this.register({
      id: 123,
      name: 'Set Argument',
      category: 'Variables/Arguments',
      description: 'Set an action argument value',
      fields: [
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: true },
        { name: 'value', type: 'text', label: 'Value', required: true }
      ],
      handler: 'handleSetArgument'
    });

    // Variables - User Specific
    this.register({
      id: 1050,
      name: 'Set User Variable',
      category: 'Variables/User',
      description: 'Set a user-specific variable',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true },
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: true },
        { name: 'value', type: 'text', label: 'Value', required: true },
        { name: 'persisted', type: 'boolean', label: 'Persist To Disk', default: false }
      ],
      handler: 'handleSetUserVariable'
    });

    this.register({
      id: 1051,
      name: 'Get User Variable',
      category: 'Variables/User',
      description: 'Get a user-specific variable',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true },
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: true },
        { name: 'defaultValue', type: 'text', label: 'Default Value', required: false },
        { name: 'destinationVariable', type: 'variable', label: 'Save To Variable', required: false }
      ],
      handler: 'handleGetUserVariable'
    });

    // Variables - Math Operations
    this.register({
      id: 1052,
      name: 'Math Operation',
      category: 'Variables/Math',
      description: 'Perform mathematical operations',
      fields: [
        { name: 'operand1', type: 'text', label: 'First Value', required: true },
        { 
          name: 'operation', 
          type: 'select', 
          label: 'Operation', 
          required: true,
          options: [
            { label: 'Add (+)', value: 'add' },
            { label: 'Subtract (-)', value: 'subtract' },
            { label: 'Multiply (*)', value: 'multiply' },
            { label: 'Divide (/)', value: 'divide' },
            { label: 'Modulo (%)', value: 'modulo' },
            { label: 'Power (^)', value: 'power' }
          ]
        },
        { name: 'operand2', type: 'text', label: 'Second Value', required: true },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', required: true }
      ],
      handler: 'handleMathOperation'
    });

    // Variables - String Operations
    this.register({
      id: 1053,
      name: 'String Operation',
      category: 'Variables/String',
      description: 'Perform string operations',
      fields: [
        { name: 'input', type: 'text', label: 'Input String', required: true },
        { 
          name: 'operation', 
          type: 'select', 
          label: 'Operation', 
          required: true,
          options: [
            { label: 'To Uppercase', value: 'uppercase' },
            { label: 'To Lowercase', value: 'lowercase' },
            { label: 'Trim', value: 'trim' },
            { label: 'Length', value: 'length' },
            { label: 'Replace', value: 'replace' },
            { label: 'Substring', value: 'substring' },
            { label: 'Split', value: 'split' }
          ]
        },
        { name: 'param1', type: 'text', label: 'Parameter 1', required: false },
        { name: 'param2', type: 'text', label: 'Parameter 2', required: false },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', required: true }
      ],
      handler: 'handleStringOperation'
    });

    // Twitch - Chat
    this.register({
      id: 10,
      name: 'Send Message to Channel',
      category: 'Twitch/Chat',
      description: 'Send a message to Twitch chat',
      fields: [
        { name: 'message', type: 'text', label: 'Message', required: true },
        { name: 'useBot', type: 'boolean', label: 'Send as Bot Account', default: true }
      ],
      handler: 'handleTwitchSendMessage'
    });

    this.register({
      id: 2001,
      name: 'Delete Chat Message',
      category: 'Twitch/Chat',
      description: 'Delete a message from Twitch chat',
      fields: [
        { name: 'messageId', type: 'text', label: 'Message ID', required: true }
      ],
      handler: 'handleTwitchDeleteMessage'
    });

    this.register({
      id: 2002,
      name: 'Clear Chat',
      category: 'Twitch/Chat',
      description: 'Clear all messages in Twitch chat',
      fields: [],
      handler: 'handleTwitchClearChat'
    });

    this.register({
      id: 2003,
      name: 'Timeout User',
      category: 'Twitch/Moderation',
      description: 'Timeout a user in Twitch chat',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true },
        { name: 'duration', type: 'number', label: 'Duration (seconds)', required: true, default: 600, min: 1 },
        { name: 'reason', type: 'text', label: 'Reason', required: false }
      ],
      handler: 'handleTwitchTimeoutUser'
    });

    this.register({
      id: 2004,
      name: 'Ban User',
      category: 'Twitch/Moderation',
      description: 'Ban a user from Twitch chat',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true },
        { name: 'reason', type: 'text', label: 'Reason', required: false }
      ],
      handler: 'handleTwitchBanUser'
    });

    this.register({
      id: 2005,
      name: 'Unban User',
      category: 'Twitch/Moderation',
      description: 'Unban a user from Twitch chat',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true }
      ],
      handler: 'handleTwitchUnbanUser'
    });

    // Twitch - Channel
    this.register({
      id: 15,
      name: 'Set Stream Title',
      category: 'Twitch/Channel',
      description: 'Update the stream title',
      fields: [
        { name: 'title', type: 'text', label: 'Stream Title', required: true }
      ],
      handler: 'handleTwitchSetTitle'
    });

    this.register({
      id: 16,
      name: 'Set Game/Category',
      category: 'Twitch/Channel',
      description: 'Update the stream category',
      fields: [
        { name: 'game', type: 'text', label: 'Game/Category', required: true }
      ],
      handler: 'handleTwitchSetGame'
    });

    this.register({
      id: 17,
      name: 'Create Stream Marker',
      category: 'Twitch/Channel',
      description: 'Create a marker in the stream',
      fields: [
        { name: 'description', type: 'text', label: 'Marker Description', required: false }
      ],
      handler: 'handleTwitchCreateMarker'
    });

    this.register({
      id: 2010,
      name: 'Run Commercial',
      category: 'Twitch/Channel',
      description: 'Run a commercial break',
      fields: [
        { 
          name: 'duration', 
          type: 'select', 
          label: 'Duration', 
          required: true,
          options: [
            { label: '30 seconds', value: 30 },
            { label: '60 seconds', value: 60 },
            { label: '90 seconds', value: 90 },
            { label: '120 seconds', value: 120 },
            { label: '150 seconds', value: 150 },
            { label: '180 seconds', value: 180 }
          ]
        }
      ],
      handler: 'handleTwitchRunCommercial'
    });

    this.register({
      id: 14,
      name: 'Set Slow Mode',
      category: 'Twitch/Moderation',
      description: 'Enable or disable slow mode',
      fields: [
        { name: 'enabled', type: 'boolean', label: 'Enable Slow Mode', required: true },
        { name: 'duration', type: 'number', label: 'Wait Time (seconds)', default: 30, min: 3, max: 120 }
      ],
      handler: 'handleTwitchSlowMode'
    });

    // Twitch - User Info
    this.register({
      id: 50,
      name: 'Get User Info for Target',
      category: 'Twitch/User',
      description: 'Get information about the target user',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name (leave empty for trigger user)', required: false }
      ],
      handler: 'handleTwitchGetUserInfo'
    });

    this.register({
      id: 51,
      name: 'Get User Info by Login',
      category: 'Twitch/User',
      description: 'Get information about a user by login name',
      fields: [
        { name: 'userName', type: 'text', label: 'User Name', required: true }
      ],
      handler: 'handleTwitchGetUserInfoByLogin'
    });

    // OBS Studio - Scenes
    this.register({
      id: 25,
      name: 'Set Current Scene',
      category: 'OBS/Scenes',
      description: 'Switch to a different scene',
      fields: [
        { name: 'sceneName', type: 'text', label: 'Scene Name', required: true },
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSSetScene'
    });

    this.register({
      id: 3001,
      name: 'Get Current Scene',
      category: 'OBS/Scenes',
      description: 'Get the currently active scene',
      fields: [
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', default: 'currentScene' }
      ],
      handler: 'handleOBSGetCurrentScene'
    });

    // OBS Studio - Sources
    this.register({
      id: 30,
      name: 'Set Source Visibility',
      category: 'OBS/Sources',
      description: 'Show or hide a source',
      fields: [
        { name: 'sceneName', type: 'text', label: 'Scene Name', required: true },
        { name: 'sourceName', type: 'text', label: 'Source Name', required: true },
        { 
          name: 'state', 
          type: 'select', 
          label: 'State', 
          required: true,
          options: [
            { label: 'Hide', value: 0 },
            { label: 'Show', value: 1 },
            { label: 'Toggle', value: 2 }
          ]
        },
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSSetSourceVisibility'
    });

    this.register({
      id: 31,
      name: 'Set GDI Text',
      category: 'OBS/Sources',
      description: 'Update GDI+ text source',
      fields: [
        { name: 'sourceName', type: 'text', label: 'Source Name', required: true },
        { name: 'text', type: 'text', label: 'Text', required: true },
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSSetGDIText'
    });

    this.register({
      id: 32,
      name: 'Set Browser Source URL',
      category: 'OBS/Sources',
      description: 'Update browser source URL',
      fields: [
        { name: 'sourceName', type: 'text', label: 'Source Name', required: true },
        { name: 'url', type: 'text', label: 'URL', required: true },
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSSetBrowserSource'
    });

    // OBS Studio - Recording/Streaming
    this.register({
      id: 3010,
      name: 'Start Recording',
      category: 'OBS/Recording',
      description: 'Start recording',
      fields: [
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSStartRecording'
    });

    this.register({
      id: 3011,
      name: 'Stop Recording',
      category: 'OBS/Recording',
      description: 'Stop recording',
      fields: [
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSStopRecording'
    });

    this.register({
      id: 3020,
      name: 'Start Streaming',
      category: 'OBS/Streaming',
      description: 'Start streaming',
      fields: [
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSStartStreaming'
    });

    this.register({
      id: 3021,
      name: 'Stop Streaming',
      category: 'OBS/Streaming',
      description: 'Stop streaming',
      fields: [
        { name: 'connectionId', type: 'select', label: 'OBS Connection', required: false }
      ],
      handler: 'handleOBSStopStreaming'
    });

    // File Operations
    this.register({
      id: 3,
      name: 'Write to File',
      category: 'File/Write',
      description: 'Write text to a file',
      fields: [
        { name: 'file', type: 'file', label: 'File Path', required: true },
        { name: 'text', type: 'text', label: 'Text', required: true },
        { name: 'append', type: 'boolean', label: 'Append to File', default: false }
      ],
      handler: 'handleWriteToFile'
    });

    this.register({
      id: 4001,
      name: 'Read from File',
      category: 'File/Read',
      description: 'Read text from a file',
      fields: [
        { name: 'file', type: 'file', label: 'File Path', required: true },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', default: 'fileContent' }
      ],
      handler: 'handleReadFromFile'
    });

    // Sound
    this.register({
      id: 1,
      name: 'Play Sound',
      category: 'Media/Sound',
      description: 'Play a sound file',
      fields: [
        { name: 'soundFile', type: 'file', label: 'Sound File', required: true },
        { name: 'volume', type: 'number', label: 'Volume (0-100)', default: 100, min: 0, max: 100 },
        { name: 'finishBeforeContinuing', type: 'boolean', label: 'Wait for Sound to Finish', default: false }
      ],
      handler: 'handlePlaySound'
    });

    // Actions
    this.register({
      id: 4,
      name: 'Run Action',
      category: 'Actions/Control',
      description: 'Execute another action',
      fields: [
        { name: 'actionId', type: 'select', label: 'Action', required: true },
        { name: 'runImmediately', type: 'boolean', label: 'Run Immediately (bypass queue)', default: false }
      ],
      handler: 'handleRunAction'
    });

    this.register({
      id: 1004,
      name: 'Set Action State',
      category: 'Actions/Control',
      description: 'Enable or disable an action',
      fields: [
        { name: 'actionId', type: 'select', label: 'Action', required: true },
        { 
          name: 'state', 
          type: 'select', 
          label: 'State', 
          required: true,
          options: [
            { label: 'Enable', value: 'enable' },
            { label: 'Disable', value: 'disable' },
            { label: 'Toggle', value: 'toggle' }
          ]
        }
      ],
      handler: 'handleSetActionState'
    });

    // Network - HTTP
    this.register({
      id: 1007,
      name: 'HTTP Request',
      category: 'Network/HTTP',
      description: 'Make an HTTP request',
      fields: [
        { name: 'url', type: 'text', label: 'URL', required: true },
        { 
          name: 'method', 
          type: 'select', 
          label: 'Method', 
          required: true,
          options: [
            { label: 'GET', value: 'GET' },
            { label: 'POST', value: 'POST' },
            { label: 'PUT', value: 'PUT' },
            { label: 'DELETE', value: 'DELETE' },
            { label: 'PATCH', value: 'PATCH' }
          ]
        },
        { name: 'headers', type: 'code', label: 'Headers (JSON)', required: false },
        { name: 'body', type: 'text', label: 'Body', required: false },
        { name: 'parseAsJson', type: 'boolean', label: 'Parse Response as JSON', default: true },
        { name: 'variableName', type: 'variable', label: 'Save Response To Variable', default: 'httpResponse' }
      ],
      handler: 'handleHTTPRequest'
    });

    // DateTime
    this.register({
      id: 21,
      name: 'Get Date/Time',
      category: 'Core/DateTime',
      description: 'Get current date and time',
      fields: [
        { name: 'format', type: 'text', label: 'Format (e.g., YYYY-MM-DD HH:mm:ss)', default: 'YYYY-MM-DD HH:mm:ss' },
        { name: 'variableName', type: 'variable', label: 'Save To Variable', default: 'dateTime' }
      ],
      handler: 'handleGetDateTime'
    });

    // C# Code Execution
    this.register({
      id: 99999,
      name: 'Execute C# Code',
      category: 'Advanced/Code',
      description: 'Execute custom C# code',
      fields: [
        { name: 'code', type: 'code', label: 'C# Code', required: true },
        { name: 'precompile', type: 'boolean', label: 'Pre-compile', default: true },
        { name: 'saveResultToVariable', type: 'boolean', label: 'Save Result To Variable', default: false },
        { name: 'variableName', type: 'variable', label: 'Variable Name', required: false }
      ],
      handler: 'handleExecuteCSharpCode'
    });

    // Discord
    this.register({
      id: 5001,
      name: 'Send Discord Message',
      category: 'Discord/Messages',
      description: 'Send a message to a Discord channel',
      fields: [
        { name: 'channelId', type: 'text', label: 'Channel ID', required: true },
        { name: 'message', type: 'text', label: 'Message', required: true },
        { name: 'embed', type: 'boolean', label: 'Send as Embed', default: false }
      ],
      handler: 'handleDiscordSendMessage'
    });

    // YouTube
    this.register({
      id: 6001,
      name: 'Send YouTube Chat Message',
      category: 'YouTube/Chat',
      description: 'Send a message to YouTube live chat',
      fields: [
        { name: 'message', type: 'text', label: 'Message', required: true }
      ],
      handler: 'handleYouTubeSendMessage'
    });

    // ====================
    // NEW: Voice Commands
    // ====================
    this.register({
      id: 7001,
      name: 'Process Voice Command',
      category: 'Voice/Control',
      description: 'Process voice transcription and execute matched command',
      fields: [
        { name: 'transcription', type: 'text', label: 'Voice Transcription', required: true, placeholder: '%transcription%' },
        { name: 'activeChatters', type: 'variable', label: 'Active Chatters Variable', required: false }
      ],
      handler: 'handleVoiceCommand'
    });

    this.register({
      id: 7002,
      name: 'Add Active Chatter',
      category: 'Voice/Control',
      description: 'Add user to active chatters list for voice matching',
      fields: [
        { name: 'username', type: 'text', label: 'Username', required: true, placeholder: '%user%' }
      ],
      handler: 'handleAddActiveChatter'
    });

    // ====================
    // NEW: AI Memory
    // ====================
    this.register({
      id: 7010,
      name: 'AI Conversation with Memory',
      category: 'AI/Memory',
      description: 'Process AI conversation with two-tier memory system',
      fields: [
        { name: 'username', type: 'text', label: 'Username', required: true, placeholder: '%user%' },
        { name: 'message', type: 'text', label: 'User Message', required: true, placeholder: '%message%' },
        { name: 'personality', type: 'text', label: 'AI Personality', required: false, placeholder: 'Custom personality prompt...' }
      ],
      handler: 'handleAIMemoryConversation'
    });

    this.register({
      id: 7011,
      name: 'Clear User Memory',
      category: 'AI/Memory',
      description: 'Clear conversation history for a user',
      fields: [
        { name: 'username', type: 'text', label: 'Username', required: true, placeholder: '%user%' }
      ],
      handler: 'handleClearUserMemory'
    });

    // ====================
    // NEW: Advanced Logic & Loops
    // ====================
    this.register({
      id: 7020,
      name: 'For Loop',
      category: 'Core/Logic',
      description: 'Execute sub-actions multiple times',
      fields: [
        { name: 'iterations', type: 'number', label: 'Number of Iterations', required: true, default: 5, min: 1, max: 1000 },
        { name: 'indexVariable', type: 'text', label: 'Index Variable Name', required: false, default: 'loopIndex' }
      ],
      handler: 'handleForLoop'
    });

    // ====================
    // NEW: Array Operations
    // ====================
    this.register({
      id: 7030,
      name: 'Create Array',
      category: 'Variables/Array',
      description: 'Create an array from comma-separated values',
      fields: [
        { name: 'arrayName', type: 'text', label: 'Array Variable Name', required: true },
        { name: 'values', type: 'text', label: 'Values (comma-separated)', required: true }
      ],
      handler: 'handleCreateArray'
    });

    this.register({
      id: 7031,
      name: 'Get Random Array Item',
      category: 'Variables/Array',
      description: 'Get random item from array',
      fields: [
        { name: 'arrayName', type: 'text', label: 'Array Variable Name', required: true },
        { name: 'outputVariable', type: 'text', label: 'Output Variable', required: true, default: 'randomItem' }
      ],
      handler: 'handleGetRandomArrayItem'
    });

    // ====================
    // NEW: Pokemon System
    // ====================
    this.register({
      id: 8001,
      name: 'Open Pokemon Pack',
      category: 'Pokemon/Packs',
      description: 'Open a Pokemon card pack',
      fields: [
        { name: 'setNumber', type: 'number', label: 'Set Number (1-6)', required: false, default: 1, min: 1, max: 6 },
        { name: 'cost', type: 'number', label: 'Pack Cost', required: false, default: 1500 }
      ],
      handler: 'handlePokemonPackOpen'
    });

    this.register({
      id: 8002,
      name: 'Show Pokemon Collection',
      category: 'Pokemon/Collection',
      description: 'Display user Pokemon collection',
      fields: [],
      handler: 'handlePokemonCollectionShow'
    });

    this.register({
      id: 8003,
      name: 'List Pokemon Cards',
      category: 'Pokemon/Collection',
      description: 'List user Pokemon cards with pagination',
      fields: [],
      handler: 'handlePokemonCardsList'
    });

    this.register({
      id: 8004,
      name: 'Show Pokemon Card',
      category: 'Pokemon/Collection',
      description: 'Display specific Pokemon card',
      fields: [
        { name: 'cardIdentifier', type: 'text', label: 'Card Identifier', required: true, placeholder: '%rawInput%' }
      ],
      handler: 'handlePokemonShowCard'
    });

    this.register({
      id: 8005,
      name: 'Initiate Pokemon Trade',
      category: 'Pokemon/Trading',
      description: 'Start a Pokemon card trade',
      fields: [
        { name: 'targetUser', type: 'text', label: 'Target User', required: true, placeholder: '%rawInput%' }
      ],
      handler: 'handlePokemonTradeInitiate'
    });

    // ====================
    // NEW: System Commands
    // ====================
    this.register({
      id: 9002,
      name: 'Toggle Welcome Wagon Mode',
      category: 'System/Welcome',
      description: 'Toggle between chat and overlay-only welcome messages',
      fields: [],
      handler: 'handleWelcomeWagonToggle'
    });

    console.log(`SubActionRegistry initialized with ${this.definitions.size} sub-actions`);
  }

  private static register(definition: SubActionDefinition) {
    this.definitions.set(definition.id, definition);
  }

  static getDefinition(id: number): SubActionDefinition | undefined {
    return this.definitions.get(id);
  }

  static getAllDefinitions(): SubActionDefinition[] {
    return Array.from(this.definitions.values());
  }

  static getDefinitionsByCategory(category: string): SubActionDefinition[] {
    return Array.from(this.definitions.values())
      .filter(def => def.category.startsWith(category));
  }

  static getCategories(): string[] {
    const categories = new Set<string>();
    this.definitions.forEach(def => {
      const mainCategory = def.category.split('/')[0];
      categories.add(mainCategory);
    });
    return Array.from(categories).sort();
  }

  static getSubCategories(mainCategory: string): string[] {
    const subCategories = new Set<string>();
    this.definitions.forEach(def => {
      if (def.category.startsWith(mainCategory + '/')) {
        const parts = def.category.split('/');
        if (parts.length > 1) {
          subCategories.add(parts[1]);
        }
      }
    });
    return Array.from(subCategories).sort();
  }
}

// Initialize the registry
SubActionRegistry.initialize();
