const fs = require('fs');
const path = require('path');

const root = process.cwd();
const commandsDir = path.join(root, 'commands');
const actionsDir = path.join(root, 'actions');
const docsDir = path.join(root, 'docs');
const outputJsonPath = path.join(docsDir, 'freeze-inventory.json');
const outputMdPath = path.join(docsDir, 'freeze-inventory-summary.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listJsonFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json') && file !== '_metadata.json')
    .sort((a, b) => a.localeCompare(b));
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function compact(values) {
  return values.filter(Boolean);
}

function classifyModule(entry) {
  const text = [
    entry.file,
    entry.name,
    entry.group,
    entry.command,
    entry.handler,
    entry.type,
  ]
    .map(normalizeText)
    .join(' ');

  if (hasAny(text, ['tag game', 'tag-pass', 'check-tag', 'tagpasses', 'tag-command', '!tag', '!tagpasses'])) {
    return 'deprecated-app-owned';
  }
  if (hasAny(text, ['channel point style redeems', 'channel point redeems', 'channel points cost'])) {
    return 'redeem-pack';
  }
  if (hasAny(text, ['events', 'follow', 'subscriber', 'resub', 'gift sub', 'gift bomb', 'raid'])) {
    return 'event-hooks';
  }
  if (hasAny(text, ['chatrd'])) {
    return 'chat-bridge';
  }
  if (hasAny(text, ['links'])) {
    return 'links';
  }
  if (hasAny(text, ['fun commands'])) {
    return 'starter-social';
  }
  if (hasAny(text, ['secret commands'])) {
    return 'secret-legacy';
  }
  if (hasAny(text, ['champion of the hill', 'special actions'])) {
    return 'game-pack';
  }
  if (hasAny(text, ['pokemon', 'pokecard', 'poketrade', 'pokepack', 'pokepack', 'pokedex'])) {
    return 'pokemon';
  }
  if (hasAny(text, ['partner check', 'crewcheckin', 'crew checkin', 'modcheckin', 'mod checkin', 'spmt', 'space mountain', 'partnermessage'])) {
    return 'checkins';
  }
  if (hasAny(text, ['menumode', 'menu mode', 'cursor', 'showgroup', 'showcategory', 'showhelpoverlay', 'showinvalidgroupoverlay', 'hidemenuoverlay'])) {
    return 'menu-mode';
  }
  if (hasAny(text, ['deathcounter'])) {
    return 'deathcounter';
  }
  if (hasAny(text, ['blerp'])) {
    return 'blerps';
  }
  if (hasAny(text, ['clip'])) {
    return 'clips';
  }
  if (hasAny(text, ['chatgpt', 'athena', 'aibot', 'voice reply', 'whisper', 'chat call', 'commander'])) {
    return 'ai-bot';
  }
  if (hasAny(text, ['currency', 'points', 'gamble', 'coinflip', 'duel', 'watchtime', 'leaderboard', 'leader', 'wleader', 'pleader', 'bleader', 'cleader', 'bitsleader', 'shop', 'givepoints', 'addpoints', 'setpoints'])) {
    return 'economy';
  }
  if (hasAny(text, ['welcome', 'walk-on', 'walk on', 'gptwalkon', 'lurk', 'unlurk'])) {
    return 'welcome';
  }
  if (hasAny(text, ['!boop', '!hug', '!headpat', '!fistbump', '!cuddle', '!dance', '!tickle', '!love', '!roll', '!show', '!no', '!yes', '!yup', '!bic', '!highfive', '!date'])) {
    return 'starter-social';
  }
  if (hasAny(text, ['mod commands', 'chat commands', '!so', 'shoutout', '!settitle', '!setgame', '!followage', '!followed', '!followers', '!stats', '!uptime', '!time', '!commands', '!created', '!raidmessage', '!brb', '!accept'])) {
    return 'core-utility';
  }
  if (hasAny(text, ['kick'])) {
    return 'kick';
  }
  if (hasAny(text, ['tiktok'])) {
    return 'tiktok';
  }
  if (hasAny(text, ['discord'])) {
    return 'discord';
  }
  if (hasAny(text, ['song request', 'hearmeout', '!sr'])) {
    return 'music';
  }
  if (hasAny(text, ['translation'])) {
    return 'translation';
  }
  if (hasAny(text, ['toolkit', 'toolbelt', 'fasttrack', 'random video'])) {
    return 'toolkits';
  }
  if (hasAny(text, ['error -', 'unable to afford', 'fail'])) {
    return 'internal-support';
  }
  if (hasAny(text, ['system', 'welcome wagon toggle'])) {
    return 'system';
  }
  return 'uncategorized';
}

function classifyTier(entry) {
  const text = [
    entry.file,
    entry.name,
    entry.group,
    entry.command,
    entry.handler,
    entry.type,
  ]
    .map(normalizeText)
    .join(' ');

  const moduleName = entry.module;
  const isCopy = hasAny(text, ['copy', '__copy__']);
  const isDeprecated = moduleName === 'deprecated-app-owned';
  const isInternalSupport =
    moduleName === 'internal-support' ||
    hasAny(text, ['cursor', 'showgroup', 'showcategory', 'showinvalidgroupoverlay', 'hidemenuoverlay', 'chatdispatcher', 'update checker']) ||
    (!entry.isCommand && entry.triggerCount === 0 && entry.subActionCount === 0 && !entry.handler && !entry.type);

  if (isDeprecated) {
    return 'legacy_hold';
  }
  if (isCopy || isInternalSupport) {
    return 'internal_only';
  }
  if (moduleName === 'pokemon') {
    return 'built_in_module';
  }
  if (['checkins', 'menu-mode', 'deathcounter', 'blerps', 'clips', 'music', 'translation', 'toolkits', 'kick', 'tiktok', 'discord', 'links', 'redeem-pack', 'event-hooks', 'game-pack', 'chat-bridge'].includes(moduleName)) {
    return 'official_library';
  }
  if (['ai-bot', 'economy', 'welcome', 'starter-social', 'core-utility', 'system'].includes(moduleName)) {
    return 'starter';
  }
  if (moduleName === 'secret-legacy') {
    return 'legacy_hold';
  }
  return 'legacy_hold';
}

function classifyVisibility(entry) {
  if (entry.freezeTier === 'internal_only') return 'hidden';
  if (entry.freezeTier === 'legacy_hold') return 'hidden';
  if (entry.freezeTier === 'official_library') return 'advanced';
  return 'default';
}

function classifyRequiresSetup(entry) {
  const text = [
    entry.file,
    entry.name,
    entry.group,
    entry.command,
    entry.handler,
    entry.type,
  ]
    .map(normalizeText)
    .join(' ');

  return hasAny(text, [
    'kick',
    'tiktok',
    'discord',
    'obs',
    'blerp',
    'song request',
    'hearmeout',
    'clip',
    'translation',
    'partner',
    'crew',
    'space mountain',
    'modcheckin',
    'mod checkin',
  ]);
}

function buildRationale(entry) {
  const notes = [];

  if (entry.module === 'deprecated-app-owned') {
    notes.push('Deprecated app-owned feature; keep only as migration reference.');
  }
  if (entry.freezeTier === 'built_in_module') {
    notes.push('Pokemon stays built-in for now because it is interconnected and universally configured.');
  }
  if (entry.freezeTier === 'official_library') {
    notes.push('Optional or setup-heavy feature; better as installable library content than default onboarding.');
  }
  if (entry.freezeTier === 'starter') {
    notes.push('Part of the intended default tenant experience.');
  }
  if (entry.freezeTier === 'internal_only') {
    notes.push('Internal support, duplicate, or non-user-facing implementation artifact.');
  }
  if (entry.requiresSetup) {
    notes.push('Requires external setup or integration-specific configuration.');
  }
  if (!entry.enabled) {
    notes.push('Currently disabled in the seeded bundle.');
  }

  return notes;
}

function buildEntry(kind, file, json) {
  const entry = {
    kind,
    isCommand: kind === 'command',
    file,
    path: `${kind === 'command' ? 'commands' : 'actions'}/${file}`,
    id: json.id || '',
    name: json.name || '',
    group: json.group || '',
    enabled: json.enabled !== false,
    command: json.command || '',
    actionId: json.actionId || '',
    handler: json.handler || '',
    type: json.type || '',
    triggerCount: Array.isArray(json.triggers) ? json.triggers.length : 0,
    subActionCount: Array.isArray(json.subActions) ? json.subActions.length : 0,
    permittedGroups: Array.isArray(json.permittedGroups) ? json.permittedGroups : [],
  };

  entry.module = classifyModule(entry);
  entry.freezeTier = classifyTier(entry);
  entry.visibility = classifyVisibility(entry);
  entry.requiresSetup = classifyRequiresSetup(entry);
  entry.defaultEnabled = entry.freezeTier === 'starter' || entry.freezeTier === 'built_in_module';
  entry.legacyHold = entry.freezeTier === 'legacy_hold';
  entry.rationale = buildRationale(entry);

  return entry;
}

function loadEntries(dir, kind) {
  return listJsonFiles(dir).map((file) => buildEntry(kind, file, readJson(path.join(dir, file))));
}

function summarize(entries) {
  const byTier = new Map();
  const byModule = new Map();
  const add = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const entry of entries) {
    add(byTier, entry.freezeTier);
    add(byModule, entry.module);
  }

  return {
    total: entries.length,
    byTier: [...byTier.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    byModule: [...byModule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

function formatTable(rows) {
  if (!rows.length) return '';
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
  return rows
    .map((row, rowIndex) =>
      row
        .map((cell, index) => String(cell).padEnd(widths[index]))
        .join(' | ')
        .replace(/^/, rowIndex === 1 ? '' : '')
    )
    .join('\n');
}

function writeSummary(allEntries, commands, actions) {
  const allSummary = summarize(allEntries);
  const commandSummary = summarize(commands);
  const actionSummary = summarize(actions);

  const tierRows = [
    ['Freeze Tier', 'Count'],
    ['---', '---'],
    ...allSummary.byTier.map(([tier, count]) => [tier, count]),
  ];

  const moduleRows = [
    ['Module', 'Count'],
    ['---', '---'],
    ...allSummary.byModule.map(([moduleName, count]) => [moduleName, count]),
  ];

  const lines = [
    '# Freeze Inventory Summary',
    '',
    `Generated from \`commands/\` and \`actions/\` on ${new Date().toISOString()}.`,
    '',
    '## Totals',
    '',
    `- Commands: \`${commands.length}\``,
    `- Actions: \`${actions.length}\``,
    `- Entries: \`${allEntries.length}\``,
    '',
    '## Freeze Tiers',
    '',
    formatTable(tierRows),
    '',
    '## Modules',
    '',
    formatTable(moduleRows),
    '',
    '## Notes',
    '',
    '- `legacy_hold` is used for deprecated or migration-only content, including Tag Game carryover.',
    '- `official_library` is used for optional modules that should not clutter default onboarding.',
    '- `built_in_module` is currently reserved for Pokemon.',
    '- `internal_only` captures duplicates, support actions, and implementation artifacts that should stay hidden.',
    '',
    '## Per-Kind Breakdown',
    '',
    `- Command tiers: ${commandSummary.byTier.map(([tier, count]) => `${tier}=${count}`).join(', ')}`,
    `- Action tiers: ${actionSummary.byTier.map(([tier, count]) => `${tier}=${count}`).join(', ')}`,
    '',
  ];

  fs.writeFileSync(outputMdPath, lines.join('\n'));
}

function main() {
  const commands = loadEntries(commandsDir, 'command');
  const actions = loadEntries(actionsDir, 'action');
  const allEntries = [...commands, ...actions].sort((a, b) => a.path.localeCompare(b.path));

  const payload = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    summary: {
      commands: summarize(commands),
      actions: summarize(actions),
      all: summarize(allEntries),
    },
    entries: allEntries,
  };

  fs.writeFileSync(outputJsonPath, JSON.stringify(payload, null, 2));
  writeSummary(allEntries, commands, actions);

  console.log(`Wrote ${path.relative(root, outputJsonPath)}`);
  console.log(`Wrote ${path.relative(root, outputMdPath)}`);
}

main();
