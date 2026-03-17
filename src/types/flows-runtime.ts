export type FlowNodeOutcome = 'success' | 'failure' | 'true' | 'false';

export interface FlowServices {
  sendChatMessage: (message: string, as?: 'bot' | 'broadcaster') => Promise<void>;
  sendDiscordMessage: (channelId: string, message: string) => Promise<void>;
  conversationalResponse: (input: { message: string; personality?: string }) => Promise<{ response: string }>;
  textToSpeech: (input: { text: string; voice: string }) => Promise<{ audioDataUri: string }>;
  sendPluginCommand: (pluginId: string, command: { command: string; payload?: Record<string, any> }) => Promise<void>;
  broadcast: (payload: any) => void;
  updatePoints: (options: { user: string; amount?: number; operation?: 'add' | 'set' | 'get'; reason?: string }) => Promise<{ points: number; level: number }>;
  getPoints: (user: string) => Promise<{ points: number; level: number }>;
  getLeaderboard: (limit?: number) => Promise<Array<{ user: string; points: number; level: number }>>;
}

export type FlowLogEventType =
  | 'flow-start'
  | 'node-start'
  | 'node-complete'
  | 'node-error'
  | 'flow-complete';

export interface FlowLogEvent {
  type: FlowLogEventType;
  message: string;
  nodeId?: string;
  label?: string;
  outcome?: FlowNodeOutcome;
  error?: string;
  timestamp?: number;
}

export interface FlowExecutionContext {
  args: string[];
  tags: Record<string, any>;
  vars: Record<string, any>;
  lastOutput?: string;
  personality?: string;
  voice?: string;
  services: FlowServices;
  logEvent?: (event: FlowLogEvent) => void;
}
