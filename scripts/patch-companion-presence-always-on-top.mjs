import { readFile, writeFile } from 'node:fs/promises';

const file = 'companion/main.cjs';
let source = await readFile(file, 'utf8');

if (source.includes('SPMT_PRESENCE_ENDPOINT') && source.includes('enforceOverlayAlwaysOnTop')) {
  console.log('Companion presence and always-on-top patch already applied');
  process.exit(0);
}

function replaceRequired(from, to, label) {
  if (!source.includes(from)) throw new Error(`Companion patch could not apply ${label}; marker missing`);
  source = source.replace(from, to);
}

replaceRequired(
  "const STREAMWEAVER_ORIGIN = 'https://streamweaver-new.fly.dev';",
  "const STREAMWEAVER_ORIGIN = 'https://streamweaver-new.fly.dev';\nconst SPMT_PRESENCE_ENDPOINT = 'https://spmt.live/api/presence/heartbeat';\nconst COMPANION_PRESENCE_INTERVAL_MS = 25_000;",
  'presence constants',
);

replaceRequired(
  "let pendingBootstrapUrl = findTenantBootstrapUrl(process.argv);",
  "let pendingBootstrapUrl = findTenantBootstrapUrl(process.argv);\nlet companionPresenceTimer = null;",
  'presence timer state',
);

replaceRequired(
  `function saveConfig() {\n  configStore.write(config);\n}`,
  `function saveConfig() {\n  configStore.write(config);\n}\n\nfunction ensureCompanionPresenceConfig() {\n  const existing = String(config?.presence?.clientId || '').trim();\n  const clientId = /^[A-Za-z0-9._:-]{8,96}$/.test(existing)\n    ? existing\n    : \`companion-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2)}\`.slice(0, 96);\n  const displayName = String(config?.presence?.displayName || 'SpaceMountain Companion').trim().slice(0, 60) || 'SpaceMountain Companion';\n  config.presence = { clientId, displayName };\n  return config.presence;\n}\n\nasync function heartbeatCompanionPresence() {\n  if (!config) return;\n  const presence = ensureCompanionPresenceConfig();\n  try {\n    await fetch(SPMT_PRESENCE_ENDPOINT, {\n      method: 'POST',\n      headers: { 'content-type': 'application/json' },\n      body: JSON.stringify({ appId: 'companion', clientId: presence.clientId, displayName: presence.displayName }),\n      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,\n    });\n  } catch {\n    // Presence is observational and must never interfere with Companion.\n  }\n}\n\nfunction startCompanionPresence() {\n  if (companionPresenceTimer) clearInterval(companionPresenceTimer);\n  void heartbeatCompanionPresence();\n  companionPresenceTimer = setInterval(() => void heartbeatCompanionPresence(), COMPANION_PRESENCE_INTERVAL_MS);\n}\n\nfunction stopCompanionPresence() {\n  if (companionPresenceTimer) clearInterval(companionPresenceTimer);\n  companionPresenceTimer = null;\n}\n\nfunction enforceOverlayAlwaysOnTop(target = overlayWindow) {\n  if (!target || target.isDestroyed()) return;\n  try { target.setAlwaysOnTop(true, 'screen-saver'); } catch { target.setAlwaysOnTop(true); }\n  try { target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {\n    try { target.setVisibleOnAllWorkspaces(true); } catch {}\n  }\n  if (config?.windows?.overlay) config.windows.overlay.alwaysOnTop = true;\n}`,
  'presence and topmost helpers',
);

replaceRequired(
  `function setOverlayInteraction(active) {\n  const window = ensureOverlayWindow();`,
  `function setOverlayInteraction(active) {\n  const window = ensureOverlayWindow();\n  enforceOverlayAlwaysOnTop(window);`,
  'interaction topmost enforcement',
);

replaceRequired(
  `  overlayWindow.setTitle('SPMT Personal Overlay');\n  overlayWindow.setAlwaysOnTop(config.windows.overlay.alwaysOnTop !== false, 'floating');\n  overlayWindow.setVisibleOnAllWorkspaces(config.windows.overlay.alwaysOnTop !== false);`,
  `  overlayWindow.setTitle('SPMT Personal Overlay');\n  config.windows.overlay.alwaysOnTop = true;\n  enforceOverlayAlwaysOnTop(overlayWindow);\n  overlayWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {\n    if (!isAlwaysOnTop && !quitting) setTimeout(() => enforceOverlayAlwaysOnTop(overlayWindow), 0);\n  });`,
  'overlay window topmost enforcement',
);

replaceRequired(
  `function showOverlay() {\n  const window = ensureOverlayWindow();`,
  `function showOverlay() {\n  const window = ensureOverlayWindow();\n  enforceOverlayAlwaysOnTop(window);`,
  'show overlay topmost enforcement',
);

replaceRequired(
  `    saveConfig();\n    relay.stop();\n    relay.start();`,
  `    const linkedDisplayName = String(payload.user?.displayName || payload.user?.username || '').trim().slice(0, 60);\n    if (linkedDisplayName) {\n      const presence = ensureCompanionPresenceConfig();\n      config.presence = { ...presence, displayName: linkedDisplayName };\n    }\n    saveConfig();\n    void heartbeatCompanionPresence();\n    relay.stop();\n    relay.start();`,
  'tenant-linked presence name',
);

replaceRequired(
  `  relay?.stop();\n  updateManager?.stop();`,
  `  relay?.stop();\n  stopCompanionPresence();\n  updateManager?.stop();`,
  'presence shutdown',
);

replaceRequired(
  `  configStore = new ConfigStore(app.getPath('userData'));\n  config = configStore.read();\n  saveConfig();`,
  `  configStore = new ConfigStore(app.getPath('userData'));\n  config = configStore.read();\n  config.windows.overlay.alwaysOnTop = true;\n  ensureCompanionPresenceConfig();\n  saveConfig();\n  startCompanionPresence();`,
  'presence startup',
);

await writeFile(file, source, 'utf8');
console.log('patched Companion with mandatory topmost overlay and canonical SPMT presence');
