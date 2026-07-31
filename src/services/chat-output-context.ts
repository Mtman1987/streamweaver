import { AsyncLocalStorage } from 'async_hooks';

type DiscordChatOutputContext = {
  platform: 'discord';
  channelId: string;
  guildId?: string;
  userId?: string;
  username?: string;
  displayName?: string;
  userAvatarUrl?: string;
  messageId?: string;
  messageContent?: string;
  speakerMode?: 'command' | 'bot' | 'system';
};

type ChatOutputContext = DiscordChatOutputContext;

const storage = new AsyncLocalStorage<ChatOutputContext>();

export function runWithChatOutputContext<T>(context: ChatOutputContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getChatOutputContext(): ChatOutputContext | undefined {
  return storage.getStore();
}
