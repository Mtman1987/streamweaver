const fs = require('fs');
const path = require('path');

const root = process.cwd();
const commandsDir = path.join(root, 'commands');
const actionsDir = path.join(root, 'actions');
const inventoryPath = path.join(root, 'docs', 'freeze-inventory.json');
const outJson = path.join(root, 'docs', 'flow-package-proposal.json');
const outMd = path.join(root, 'docs', 'flow-package-proposal-summary.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listJsonFiles(dir) {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json') && file !== '_metadata.json').sort((a, b) => a.localeCompare(b));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\!+/, '')
    .replace(/^\~+/, '')
    .replace(/\(\?i\)\.\*@\?/g, '')
    .replace(/\{\{bot_name\}\}/g, 'bot_name')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getCollection(moduleName) {
  const map = {
    'ai-bot': 'AI',
    'economy': 'Economy',
    'core-utility': 'Core Utility',
    'starter-social': 'Social',
    'welcome': 'Welcome',
    'pokemon': 'Pokemon',
    'redeem-pack': 'Redeems',
    'checkins': 'Check-Ins',
    'clips': 'Clips',
    'deathcounter': 'Counters',
    'menu-mode': 'Overlays',
    'blerps': 'Audio',
    'music': 'Music',
    'translation': 'Utility',
    'event-hooks': 'Events',
    'kick': 'Integrations',
    'discord': 'Integrations',
    'tiktok': 'Integrations',
    'chat-bridge': 'Integrations',
    'game-pack': 'Games',
    'deprecated-app-owned': 'Deprecated',
    'secret-legacy': 'Hidden',
    'toolkits': 'Advanced',
    'internal-support': 'Internal',
    'system': 'System',
  };
  return map[moduleName] || 'Misc';
}

function shouldPackageCommand(entry) {
  return entry.freezeTier !== 'internal_only';
}

function shouldPackageStandaloneAction(entry) {
  if (entry.freezeTier === 'internal_only') return false;
  if (entry.module === 'deprecated-app-owned') return true;
  if (entry.module === 'internal-support') return false;
  if (entry.module === 'menu-mode' && entry.triggerCount === 0) return false;
  if (entry.triggerCount === 0 && !entry.handler && !entry.type) return false;
  return true;
}

function buildActionIndexes(actions) {
  const byId = new Map();
  const bySlug = new Map();

  for (const action of actions) {
    byId.set(action.id, action);
    const candidates = new Set([
      slugify(action.name),
      slugify(action.file),
      slugify(action.path),
    ]);
    for (const slug of candidates) {
      if (!slug) continue;
      const arr = bySlug.get(slug) || [];
      arr.push(action);
      bySlug.set(slug, arr);
    }
  }

  return { byId, bySlug };
}

function getActionMatchesForCommand(command, actionIndexes) {
  const matches = [];
  const seen = new Set();

  const add = (action, reason) => {
    if (!action) return;
    if (seen.has(action.path)) return;
    seen.add(action.path);
    matches.push({ action, reason });
  };

  if (command.actionId && actionIndexes.byId.has(command.actionId)) {
    add(actionIndexes.byId.get(command.actionId), 'direct-actionId');
  }

  const commandSlug = slugify(command.command || command.name || command.file);
  const nameSlug = slugify(command.name);
  const fileSlug = slugify(command.file);
  const groupModule = command.module;

  for (const slug of [commandSlug, nameSlug, fileSlug]) {
    for (const action of actionIndexes.bySlug.get(slug) || []) {
      add(action, 'slug-match');
    }
  }

  for (const action of actionIndexes.bySlug.get(commandSlug.replace(/^command-/, '')) || []) {
    add(action, 'fallback-slug-match');
  }

  const allActions = [...actionIndexes.byId.values()];
  const lowerName = String(command.name || '').toLowerCase();
  const lowerCommand = String(command.command || '').toLowerCase();
  const addFiltered = (predicate, reason) => {
    for (const action of allActions) {
      if (predicate(action)) add(action, reason);
    }
  };

  if (groupModule === 'ai-bot') {
    addFiltered(
      (action) => action.module === 'ai-bot' && action.freezeTier !== 'internal_only' && !String(action.name || '').toLowerCase().includes('copy'),
      'ai-module-cluster'
    );
  }

  if (groupModule === 'economy') {
    if (/(watchtime|wleader)/.test(commandSlug)) {
      addFiltered(
        (action) => action.module === 'economy' && /watchtime/.test(`${String(action.name || '').toLowerCase()} ${String(action.group || '').toLowerCase()}`),
        'economy-watchtime-cluster'
      );
    }

    if (/(gamble|coinflip|roll|shop|duel)/.test(commandSlug)) {
      addFiltered(
        (action) => action.module === 'economy' && /(\[ccg\]|classic chat gamble|duel|shop|coinflip)/.test(`${String(action.name || '').toLowerCase()} ${String(action.group || '').toLowerCase()}`),
        'economy-gamble-cluster'
      );
    }

    if (/(leader|pleader|bleader|cleader|bitsleader)/.test(commandSlug)) {
      addFiltered(
        (action) => action.module === 'economy' && /(leaderboard|leader|top doner)/.test(`${String(action.name || '').toLowerCase()} ${String(action.group || '').toLowerCase()}`),
        'economy-leader-cluster'
      );
    }

    if (/(points|addpoints|addtoall|setpoints|settoall|resetallpoints|givepoints|stealpoints)/.test(commandSlug)) {
      addFiltered(
        (action) => action.module === 'economy' && /(currency system|streamup currency|give points)/.test(`${String(action.name || '').toLowerCase()} ${String(action.group || '').toLowerCase()}`),
        'economy-currency-cluster'
      );
    }
  }

  if (groupModule === 'welcome' && (!Array.isArray(command.actions) || command.actions.length === 0)) {
    addFiltered(
      (action) =>
        action.module === 'welcome' &&
        (
          String(action.name || '').toLowerCase().includes(commandSlug) ||
          String(action.file || '').toLowerCase().includes(commandSlug) ||
          (commandSlug === 'lurk' && /(lurk)/.test(`${String(action.name || '').toLowerCase()} ${String(action.file || '').toLowerCase()}`)) ||
          (commandSlug === 'welcomemode' && /(welcome)/.test(`${String(action.name || '').toLowerCase()} ${String(action.group || '').toLowerCase()}`))
        ),
      'welcome-cluster'
    );
  }

  if (groupModule === 'starter-social' || groupModule === 'core-utility') {
    addFiltered(
      (action) => {
        const actionText = `${String(action.name || '').toLowerCase()} ${String(action.file || '').toLowerCase()}`;
        return action.module === groupModule && commandSlug.length >= 4 && actionText.includes(commandSlug);
      },
      'module-fuzzy-match'
    );
  }

  if (groupModule === 'clips') {
    addFiltered((action) => action.module === 'clips', 'clips-cluster');
  }

  if (groupModule === 'music') {
    addFiltered((action) => action.module === 'music', 'music-cluster');
  }

  if (groupModule === 'pokemon') {
    addFiltered(
      (action) => action.module === 'pokemon' && (String(action.name || '').toLowerCase().includes(commandSlug) || String(action.file || '').toLowerCase().includes(commandSlug)),
      'pokemon-cluster'
    );
  }

  return matches;
}

function createCommandPackage(command, matchedActions) {
  const displayName = command.command || command.name || command.file;
  const baseSlug = slugify(command.command || command.name || command.file || command.id);

  return {
    packageId: `flow.${baseSlug || command.id}`,
    kind: 'command_flow',
    name: displayName.startsWith('!') || displayName.startsWith('~') ? displayName : command.name,
    installUnit: 'flow',
    sourceModule: command.module,
    freezeTier: command.freezeTier,
    visibility: command.visibility,
    collection: getCollection(command.module),
    commandFiles: [command.path],
    actionFiles: matchedActions.map((item) => item.action.path),
    dependencies: [],
    matchingNotes: matchedActions.map((item) => ({ action: item.action.path, reason: item.reason })),
    notes: command.rationale,
  };
}

function createStandaloneActionPackage(action) {
  const baseSlug = slugify(action.name || action.file || action.id);
  return {
    packageId: `flow.${baseSlug || action.id}`,
    kind: action.triggerCount > 0 || action.handler || action.type ? 'action_flow' : 'support_flow',
    name: action.name,
    installUnit: 'flow',
    sourceModule: action.module,
    freezeTier: action.freezeTier,
    visibility: action.visibility,
    collection: getCollection(action.module),
    commandFiles: [],
    actionFiles: [action.path],
    dependencies: [],
    matchingNotes: [],
    notes: action.rationale,
  };
}

function summarize(packages) {
  const byKind = new Map();
  const byTier = new Map();
  const byCollection = new Map();
  const add = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const pkg of packages) {
    add(byKind, pkg.kind);
    add(byTier, pkg.freezeTier);
    add(byCollection, pkg.collection);
  }

  return {
    total: packages.length,
    byKind: [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    byTier: [...byTier.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    byCollection: [...byCollection.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

function formatTable(rows) {
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
  return rows.map((row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ')).join('\n');
}

function main() {
  const inventory = readJson(inventoryPath);
  const commandsRaw = listJsonFiles(commandsDir).map((file) => ({
    path: `commands/${file}`,
    json: readJson(path.join(commandsDir, file)),
  }));
  const actionsRaw = listJsonFiles(actionsDir).map((file) => ({
    path: `actions/${file}`,
    json: readJson(path.join(actionsDir, file)),
  }));

  const inventoryByPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));

  const commands = commandsRaw.map(({ path: filePath, json }) => ({
    ...inventoryByPath.get(filePath),
    ...json,
    path: filePath,
    file: path.basename(filePath),
  }));

  const actions = actionsRaw.map(({ path: filePath, json }) => ({
    ...inventoryByPath.get(filePath),
    ...json,
    path: filePath,
    file: path.basename(filePath),
  }));

  const actionIndexes = buildActionIndexes(actions);
  const claimedActions = new Set();
  const packageMap = new Map();

  const upsertPackage = (pkg) => {
    const existing = packageMap.get(pkg.packageId);
    if (!existing) {
      packageMap.set(pkg.packageId, pkg);
      return;
    }

    const mergeUnique = (left, right) => [...new Set([...(left || []), ...(right || [])])];
    existing.commandFiles = mergeUnique(existing.commandFiles, pkg.commandFiles);
    existing.actionFiles = mergeUnique(existing.actionFiles, pkg.actionFiles);
    existing.dependencies = mergeUnique(existing.dependencies, pkg.dependencies);
    existing.notes = mergeUnique(existing.notes, pkg.notes);
    existing.matchingNotes = [...(existing.matchingNotes || []), ...(pkg.matchingNotes || [])].filter(
      (item, index, arr) => arr.findIndex((other) => other.action === item.action && other.reason === item.reason) === index
    );
  };

  for (const command of commands) {
    if (!shouldPackageCommand(command)) continue;
    const matchedActions = getActionMatchesForCommand(command, actionIndexes).filter((item) => item.action.freezeTier !== 'internal_only');
    for (const item of matchedActions) claimedActions.add(item.action.path);
    upsertPackage(createCommandPackage(command, matchedActions));
  }

  for (const action of actions) {
    if (claimedActions.has(action.path)) continue;
    if (!shouldPackageStandaloneAction(action)) continue;
    upsertPackage(createStandaloneActionPackage(action));
  }

  const packages = [...packageMap.values()];
  packages.sort((a, b) => a.packageId.localeCompare(b.packageId));

  const payload = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    manifestShape: {
      packageId: 'string',
      kind: 'command_flow | action_flow | support_flow',
      installUnit: 'flow',
      sourceModule: 'string',
      freezeTier: 'starter | built_in_module | official_library | internal_only | legacy_hold',
      visibility: 'default | advanced | hidden',
      collection: 'string',
      commandFiles: 'string[]',
      actionFiles: 'string[]',
      dependencies: 'string[]',
      matchingNotes: 'object[]',
      notes: 'string[]',
    },
    summary: summarize(packages),
    packages,
  };

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const summary = payload.summary;
  const lines = [
    '# Flow Package Proposal Summary',
    '',
    `Generated on ${payload.generatedAt}.`,
    '',
    '## Totals',
    '',
    `- Flow packages: \`${summary.total}\``,
    '',
    '## Package Kinds',
    '',
    formatTable([
      ['Kind', 'Count'],
      ['---', '---'],
      ...summary.byKind,
    ]),
    '',
    '## Freeze Tiers',
    '',
    formatTable([
      ['Freeze Tier', 'Count'],
      ['---', '---'],
      ...summary.byTier,
    ]),
    '',
    '## Collections',
    '',
    formatTable([
      ['Collection', 'Count'],
      ['---', '---'],
      ...summary.byCollection,
    ]),
    '',
    '## Rules',
    '',
    '- The install/export unit is one flow package, not a broad bundle.',
    '- Similar commands like `!fistbump` and `!highfive` remain separate flow packages.',
    '- Multiple commands/actions stay together only when they appear to implement one user-facing flow.',
    '- Hidden support files are excluded from standalone flow packaging unless they are still needed for migration visibility.',
    '',
  ];

  fs.writeFileSync(outMd, lines.join('\n'));

  console.log(`Wrote ${path.relative(root, outJson)}`);
  console.log(`Wrote ${path.relative(root, outMd)}`);
}

main();
