import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, transform) {
  const raw = await readFile(path, 'utf8');
  // Windows Git checkouts may use CRLF while Linux uses LF. Build patches must
  // be deterministic on both platforms, so match and write a normalized form.
  const before = raw.replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before && raw === before) {
    console.log(`local Athena wake already patched: ${path}`);
    return;
  }
  await writeFile(path, after, 'utf8');
  console.log(`patched local Athena wake: ${path}`);
}

function required(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`local Athena wake marker missing: ${label}`);
  return source.replace(from, to);
}

await patch('companion/lib/config-store.cjs', (source) => {
  if (!source.includes('wake: { enabled: false')) {
    source = required(source, '  schemaVersion: 6,', '  schemaVersion: 7,', 'config schema version');
    source = required(
      source,
      "  audio: { muted: false, volume: 0.7, pttKey: 'Space', outputDeviceId: '' },\n",
      "  audio: { muted: false, volume: 0.7, pttKey: 'Space', outputDeviceId: '' },\n  wake: { enabled: false, phrase: 'hey athena', localOnly: true },\n",
      'default local wake config',
    );
    source = required(
      source,
      '      audio: { ...DEFAULT_CONFIG.audio, ...(stored.audio || {}) },\n',
      '      audio: { ...DEFAULT_CONFIG.audio, ...(stored.audio || {}) },\n      wake: { ...DEFAULT_CONFIG.wake, ...(stored.wake || {}), phrase: \'hey athena\', localOnly: true },\n',
      'stored local wake config',
    );
  }
  return source;
});

await patch('companion/main.cjs', (source) => {
  if (!source.includes("require('./lib/local-athena-wake.cjs')")) {
    source = required(
      source,
      "const { RelayClient } = require('./lib/relay-client.cjs');\n",
      "const { RelayClient } = require('./lib/relay-client.cjs');\nconst { LocalAthenaWake } = require('./lib/local-athena-wake.cjs');\n",
      'local wake import',
    );
  }

  if (!source.includes("let wakeStatus = { state: 'disabled'")) {
    source = required(
      source,
      "let relayStatus = { state: 'disabled' };\nlet obsStatus = { state: 'disabled' };\n",
      "let relayStatus = { state: 'disabled' };\nlet wakeStatus = { state: 'disabled', localOnly: true, phrase: 'hey athena' };\nlet localAthenaWake;\nlet obsStatus = { state: 'disabled' };\n",
      'wake runtime state',
    );
  }

  if (!source.includes('wake: wakeStatus,')) {
    source = required(
      source,
      '      server: serverStatus,\n      relay: relayStatus,\n      obs: obsStatus,\n',
      '      server: serverStatus,\n      relay: relayStatus,\n      wake: wakeStatus,\n      obs: obsStatus,\n',
      'wake status surface',
    );
  }

  if (!source.includes('function findActiveHearMeOutRoomWindow()')) {
    const marker = `function saveConfig() {\n  configStore.write(config);\n}\n`;
    const helper = `${marker}\nfunction findActiveHearMeOutRoomWindow() {\n  const candidates = [workspaceWindow, spaceMountainWindow, ...Array.from(popoutWindows.values())];\n  for (const window of candidates) {\n    if (!window || window.isDestroyed()) continue;\n    try {\n      const parsed = new URL(window.webContents.getURL());\n      if (parsed.hostname === 'hearmeout-main.fly.dev' && /^\\/rooms\\/[^/]+/.test(parsed.pathname)) return window;\n    } catch {}\n  }\n  return null;\n}\n\nasync function dispatchLocalAthenaWake(event) {\n  const transcript = String(event?.transcript || '').trim();\n  if (!transcript) return;\n  const target = findActiveHearMeOutRoomWindow();\n  if (!target) {\n    wakeStatus = { ...wakeStatus, state: 'heard-no-room', detail: transcript, localOnly: true };\n    emitStatus();\n    logCompanion('Local Hey Athena wake heard, but no Companion-managed HearMeOut room is open');\n    return;\n  }\n  const detail = {\n    transcript,\n    source: 'windows-companion-local',\n    capturedAt: Number(event?.capturedAt || Date.now()),\n  };\n  const script = \"window.dispatchEvent(new CustomEvent('spmt-companion-athena-command', { detail: \" + JSON.stringify(detail) + \" }))\";\n  try {\n    await target.webContents.executeJavaScript(script, true);\n    wakeStatus = { ...wakeStatus, state: 'delivered', detail: transcript, localOnly: true };\n    emitStatus();\n  } catch (error) {\n    wakeStatus = { ...wakeStatus, state: 'error', detail: error instanceof Error ? error.message : String(error), localOnly: true };\n    emitStatus();\n    logCompanion('Could not deliver local Athena wake to HearMeOut', error);\n  }\n}\n\nfunction syncLocalAthenaWake() {\n  if (localAthenaWake) {\n    localAthenaWake.stop();\n    localAthenaWake = null;\n  }\n  const enabled = config?.wake?.enabled === true;\n  if (!enabled) {\n    wakeStatus = { state: 'disabled', phrase: 'hey athena', localOnly: true };\n    emitStatus();\n    return wakeStatus;\n  }\n  localAthenaWake = new LocalAthenaWake({\n    phrase: 'hey athena',\n    onWake: (event) => void dispatchLocalAthenaWake(event),\n    onStatus: (status) => { wakeStatus = status; emitStatus(); },\n    onError: (error) => logCompanion('Local Athena wake listener error', error),\n  });\n  wakeStatus = localAthenaWake.start();\n  emitStatus();\n  return wakeStatus;\n}\n`;
    source = required(source, marker, helper, 'wake integration helpers');
  }

  if (!source.includes('wake: { ...config.wake')) {
    source = required(
      source,
      '      audio: { ...config.audio, ...(next.audio || {}) },\n',
      "      audio: { ...config.audio, ...(next.audio || {}) },\n      wake: { ...config.wake, ...(next.wake || {}), phrase: 'hey athena', localOnly: true },\n",
      'wake config save merge',
    );
  }

  if (!source.includes('relay.start();\n    syncLocalAthenaWake();\n    rebuildTrayMenu();')) {
    source = required(
      source,
      '    relay.stop();\n    relay.start();\n    rebuildTrayMenu();',
      '    relay.stop();\n    relay.start();\n    syncLocalAthenaWake();\n    rebuildTrayMenu();',
      'wake settings restart',
    );
  }

  if (!source.includes('startCompanionPresence();\n  syncLocalAthenaWake();')) {
    source = required(
      source,
      '  startCompanionPresence();',
      '  startCompanionPresence();\n  syncLocalAthenaWake();',
      'wake startup',
    );
  }

  if (!source.includes("localAthenaWake?.stop();")) {
    source = required(
      source,
      "app.on('before-quit', () => {\n  quitting = true;",
      "app.on('before-quit', () => {\n  quitting = true;\n  localAthenaWake?.stop();",
      'wake shutdown',
    );
  }
  return source;
});

await patch('companion/ui/index.html', (source) => {
  if (source.includes('id="wake-enabled"')) return source;
  return required(
    source,
    '      <label class="check"><input id="relay-enabled" type="checkbox"> Enable outbound command relay</label>\n',
    '      <label class="check"><input id="relay-enabled" type="checkbox"> Enable outbound command relay</label>\n      <label class="check"><input id="wake-enabled" type="checkbox"> Enable local “Hey Athena” wake listener</label>\n      <p class="section-copy">Wake detection runs on this Windows PC with its installed offline speech recognizer. Ordinary room speech is never uploaded to cloud STT for wake detection. If no offline recognizer is installed, use the HearMeOut Talk button instead.</p>\n',
    'wake settings UI',
  );
});

await patch('companion/ui/renderer.js', (source) => {
  if (!source.includes("byId('wake-enabled').checked")) {
    source = required(
      source,
      "  byId('relay-enabled').checked = config.relay.enabled;\n",
      "  byId('relay-enabled').checked = config.relay.enabled;\n  byId('wake-enabled').checked = config.wake?.enabled === true;\n",
      'wake settings load',
    );
    source = required(
      source,
      '    relay: {\n      url: byId(\'relay-url\').value.trim(),\n      deviceId: byId(\'relay-device-id\').value.trim(),\n      enabled: byId(\'relay-enabled\').checked\n    },\n',
      "    relay: {\n      url: byId('relay-url').value.trim(),\n      deviceId: byId('relay-device-id').value.trim(),\n      enabled: byId('relay-enabled').checked\n    },\n    wake: { enabled: byId('wake-enabled').checked, phrase: 'hey athena', localOnly: true },\n",
      'wake settings save',
    );
  }
  return source;
});
