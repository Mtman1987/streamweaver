import * as fs from 'fs/promises';
import { resolve } from 'path';

const COUNTER_FILE = resolve(process.cwd(), 'src', 'data', 'message-counter.json');
const MAX_MESSAGES = 50;

interface ChannelCounter {
  count: number;
  messageIds: string[];
}

interface CounterData {
  [channelId: string]: ChannelCounter;
}

let counterData: CounterData = {};

export async function loadCounter(): Promise<void> {
  try {
    const data = await fs.readFile(COUNTER_FILE, 'utf-8');
    counterData = JSON.parse(data);
  } catch (error) {
    await saveCounter();
  }
}

export async function saveCounter(): Promise<void> {
  try {
    await fs.writeFile(COUNTER_FILE, JSON.stringify(counterData, null, 2));
  } catch (error) {
    console.error('Error saving message counter:', error);
  }
}

export async function getNextMessageNumber(channelId: string): Promise<{ number: number; shouldDelete?: string }> {
  await loadCounter();
  
  if (!counterData[channelId]) {
    counterData[channelId] = { count: 0, messageIds: [] };
  }
  
  const channel = counterData[channelId];
  channel.count++;
  
  // Use rolling counter 1-50
  const displayNumber = ((channel.count - 1) % MAX_MESSAGES) + 1;
  
  let shouldDelete: string | undefined;
  
  // If we have 50+ messages, delete the old message at this position
  if (channel.messageIds.length >= MAX_MESSAGES) {
    const deleteIndex = (displayNumber - 1) % MAX_MESSAGES;
    shouldDelete = channel.messageIds[deleteIndex];
  }
  
  await saveCounter();
  console.log(`[Counter] Generated message number: ${displayNumber} (total: ${channel.count})`);
  
  return { number: displayNumber, shouldDelete };
}

export async function storeMessageId(channelId: string, messageId: string, displayNumber: number): Promise<void> {
  await loadCounter();
  
  if (!counterData[channelId]) {
    counterData[channelId] = { count: 0, messageIds: [] };
  }
  
  const channel = counterData[channelId];
  const index = (displayNumber - 1) % MAX_MESSAGES;
  
  // Ensure array is large enough
  while (channel.messageIds.length <= index) {
    channel.messageIds.push('');
  }
  
  channel.messageIds[index] = messageId;
  await saveCounter();
}

export async function cleanupOldMessages(channelId: string): Promise<void> {
  // This function is now handled by the rolling counter system
  console.log('[Counter] Using rolling counter system - no separate cleanup needed');
}