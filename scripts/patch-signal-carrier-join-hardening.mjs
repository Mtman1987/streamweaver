import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'services', 'twitch-client.ts');
const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let source = original;

const rawJoinLogin = "  const channelLogin = channel.toLowerCase();";
const sanitizedJoinLogin = "  const channelLogin = String(channel || '').trim().replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);\n  if (!channelLogin) return null;";
if (source.includes(rawJoinLogin)) {
  source = source.replace(rawJoinLogin, sanitizedJoinLogin);
}

const oldJoinFailure = "      console.error(`[Twitch:community-bot] Failed to join #${channelLogin}:`, error);";
const newJoinFailure = "      const detail = error instanceof Error ? error.message : String(error);\n      console.error(`[Twitch:community-bot] Failed to join carrier ${channelLogin}: ${detail}`);";
if (source.includes(oldJoinFailure)) {
  source = source.replace(oldJoinFailure, newJoinFailure);
}

const oldFatalCarrier = "      if (!client || !communityBotChannels.has(channel)) {\n        throw new Error(`Community bot could not join Signal carrier #${channel}`);\n      }\n      joined.push(channel);";
const newNonFatalCarrier = "      if (!client || !communityBotChannels.has(channel)) {\n        console.warn(`[Signal] Skipping carrier ${channel}: community bot could not join; continuing with remaining live carriers`);\n        continue;\n      }\n      joined.push(channel);";
if (source.includes(oldFatalCarrier)) {
  source = source.replace(oldFatalCarrier, newNonFatalCarrier);
}

for (const marker of [
  "replace(/^#+/, '')",
  "replace(/[^a-z0-9_]/g, '')",
  'Failed to join carrier ${channelLogin}',
  'continuing with remaining live carriers',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Signal carrier join hardening marker missing: ${marker}`);
  }
}

if (source !== original) fs.writeFileSync(file, source, 'utf8');
console.log('Signal carrier join hardening patch applied.');
