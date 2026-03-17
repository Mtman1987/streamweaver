import { WebSocket } from 'ws';

export type PluginCommandPayload = Record<string, any>;

export interface PluginCommand {
  command: string;
  payload?: PluginCommandPayload;
}

export interface PluginDefinition {
  id: string;
  name: string;
  description?: string;
  type: 'websocket' | 'http' | 'custom';
  sendCommand: (command: PluginCommand) => Promise<void>;
  disconnect?: () => void;
  metadata?: Record<string, any>;
}

const registry = new Map<string, PluginDefinition>();

export function registerPlugin(plugin: PluginDefinition) {
  registry.set(plugin.id, plugin);
  console.log(`[Plugin] Registered plugin: ${plugin.id}`);
}

export function getPlugin(id: string): PluginDefinition | undefined {
  return registry.get(id);
}

export function listPlugins(): PluginDefinition[] {
  return Array.from(registry.values());
}

export async function sendPluginCommand(id: string, command: PluginCommand) {
  const plugin = registry.get(id);
  if (!plugin) {
    throw new Error(`Plugin "${id}" not found.`);
  }
  await plugin.sendCommand(command);
}

export function unregisterPlugin(id: string) {
  const plugin = registry.get(id);
  if (plugin?.disconnect) {
    plugin.disconnect();
  }
  registry.delete(id);
  console.log(`[Plugin] Unregistered plugin: ${id}`);
}

export interface WebSocketPluginOptions {
  id: string;
  name: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
}

export function createWebSocketPlugin(options: WebSocketPluginOptions) {
  let socket: WebSocket | null = null;
  let isConnecting = false;
  let reconnectTimeout: NodeJS.Timeout | null = null;

  const connect = () => {
    if (isConnecting) return;
    isConnecting = true;
    socket = new WebSocket(options.url, {
      headers: options.headers,
    });

    socket.on('open', () => {
      console.log(`[Plugin:${options.id}] Connected to ${options.url}`);
      isConnecting = false;
    });

    socket.on('close', () => {
      console.warn(`[Plugin:${options.id}] Connection closed.`);
      isConnecting = false;
      if (options.autoReconnect !== false) {
        reconnectTimeout = setTimeout(
          connect,
          options.reconnectIntervalMs ?? 5000
        );
      }
    });

    socket.on('error', (error) => {
      console.error(`[Plugin:${options.id}] WebSocket error:`, error);
    });
  };

  connect();

  const definition: PluginDefinition = {
    id: options.id,
    name: options.name,
    description: options.description,
    type: 'websocket',
    metadata: {
      url: options.url,
      ...options.metadata,
    },
    sendCommand: async (command) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error(`Plugin "${options.id}" WebSocket is not connected.`);
      }
      socket.send(JSON.stringify(command));
    },
    disconnect: () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socket?.close();
      socket = null;
    },
  };

  registerPlugin(definition);

  return definition;
}

export function setupDefaultPlugins() {
  if (process.env.APOLLO_STATION_WS_URL) {
    createWebSocketPlugin({
      id: 'apollo-station',
      name: 'Apollo Station',
      description: 'Companion broadcasting app for overlay control.',
      url: process.env.APOLLO_STATION_WS_URL,
      autoReconnect: true,
      metadata: {
        capabilities: ['overlay-control', 'scene-events'],
      },
    });
  }

  if (process.env.OBS_WS_URL && process.env.OBS_WS_PASSWORD) {
    createWebSocketPlugin({
      id: 'obs-websocket',
      name: 'OBS WebSocket',
      description: 'Control OBS scenes and sources.',
      url: process.env.OBS_WS_URL,
      headers: {
        Authorization: `Bearer ${process.env.OBS_WS_PASSWORD}`,
      },
      autoReconnect: true,
      metadata: {
        capabilities: ['set-scene', 'toggle-source'],
      },
    });
  }
}
