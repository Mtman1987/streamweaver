#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = process.cwd();

const dirs = [
  'logs',
  'tokens',
  'data',
  path.join('data', 'masterstats', 'overlay'),
  'MasterStats',
  'actions',
  'commands',
  'sb',
  'plugin-exports',
  path.join('public', 'avatars'),
  'tmp',
];

const files = [
  { file: path.join('tokens', 'discord-channels.json'), value: {} },
  { file: path.join('tokens', 'automation-variables.json'), value: {} },
  { file: path.join('tokens', 'app-config.json'), value: {} },
  { file: path.join('tokens', 'discord-webhooks.json'), value: {} },
  { file: path.join('tokens', 'raid-message.json'), value: { message: '' } },
  { file: path.join('tokens', 'welcome-wagon.json'), value: {} },
  { file: path.join('tokens', 'chat-memory.json'), value: {} },
  { file: path.join('tokens', 'partners.txt'), value: '' },
  { file: path.join('data', 'discord-last-tag-message.json'), value: {} },
  { file: path.join('data', 'bingo-state.json'), value: {} },
  { file: path.join('data', 'carmen-state.json'), value: {} },
  { file: path.join('data', 'gamble-settings.json'), value: {} },
  { file: path.join('data', 'user-stats.json'), value: {} },
  { file: path.join('src', 'data', 'discord-channels.json'), value: {} },
  { file: path.join('src', 'data', 'message-counter.json'), value: { count: 0 } },
  { file: path.join('src', 'data', 'stream-metrics.json'), value: { sessions: [] } },
  { file: path.join('src', 'data', 'private-chat.json'), value: [] },
];

function ensureDir(relPath) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(fullPath, { recursive: true });
}

function ensureFile(relPath, value) {
  const fullPath = path.join(root, relPath);
  if (fs.existsSync(fullPath)) return false;
  ensureDir(path.dirname(relPath));
  const data = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(fullPath, data, 'utf8');
  return true;
}

let createdDirs = 0;
let createdFiles = 0;

for (const dir of dirs) {
  ensureDir(dir);
  createdDirs++;
}

for (const item of files) {
  if (ensureFile(item.file, item.value)) {
    createdFiles++;
  }
}

console.log(`[bootstrap-runtime] ensured ${createdDirs} directories, created ${createdFiles} missing files`);
