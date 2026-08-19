const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session: electronSession,
  shell,
  Tray
} = require('electron');
const OBSWebSocket = require('obs-websocket-js').default;
const { autoUpdater } = require('electron-updater');
const { ConfigStore } = require('./lib/config-store.cjs');
const { DiagnosticsStore, redactText } = require('./lib/diagnostics-store.cjs');
const { MediaJobs } = require('./lib/media-jobs.cjs');
const { RelayClient } = require('./lib/relay-client.cjs');
const { createUpdateManager } = require('./lib/update-manager.cjs');
const { WorkflowJobs } = require('./lib/workflow-jobs.cjs');
const { DEFAULT_ORIGIN: SPMT_ORIGIN, resolveSurfaceUrl, resolvePersonalOverlayUrl } = require('./lib/spmt-surfaces.cjs');
const { exchangeTenantBootstrap, findTenantBootstrapUrl, parseTenantBootstrapUrl } = require('./lib/tenant-bootstrap.cjs');

const COMPANION_PROTOCOL = 'spmt-companion';
const COMPANION_WORKSPACE_URL = 'https://spacemountain.live/?companionWorkspace=streamweaver';
const STREAMWEAVER_ORIGIN = 'https://streamweaver-new.fly.dev';
const SPMT_PRESENCE_ENDPOINT = 'https://spmt.live/api/presence/heartbeat';
const COMPANION_PRESENCE_INTERVAL_MS = 25_000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let configStore;
let diagnosticsStore;
let config;
let settingsWindow;
let spaceMountainWindow;
let workspaceWindow;
let overlayWindow;
let socialOverlayWindow;
let tray;
let serverProcess;
let serverRestartTimer;
let serverStopRequested = false;
let serverStatus = { state: 'stopped' };
let relayStatus = { state: 'disabled' };
let obsStatus = { state: 'disabled' };
let relay;
let mediaJobs;
let workflowJobs;
let updateManager;
let obs;
const popoutWindows = new Map();
let quitting = false;
let overlayInteractionActive = false;
let overlayHotkeyRegistered = false;
let overlayHotkeyAccelerator = '';
let bootstrapInFlight = false;
let pendingBootstrapUrl = findTenantBootstrapUrl(process.argv);
let companionPresenceTimer = null;

function logCompanion(message, error) {
  const detail = error instanceof Error ? `${error.stack || error.message}` : error ? String(error) : '';
  try {
    if (diagnosticsStore) return diagnosticsStore.log(message, error);
    const now = new Date();
    const directory = path.join(app.getPath('userData'), 'diagnostics');
    fs.mkdirSync(directory, { recursive: true });
    const line = `[${now.toISOString()}] ${redactText(message)}${detail ? `: ${redactText(detail)}` : ''}\n`;
    fs.appendFileSync(path.join(directory, `companion-${now.toISOString().slice(0, 10)}.log`), line, 'utf8');
  } catch {
    // Logging must never prevent the tray app from starting.
  }
}

function repoRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'runtime');
  return path.resolve(__dirname, '..');
}

function emitStatus() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('companion:status', {
      server: serverStatus,
      relay: relayStatus,
      obs: obsStatus,
      overlay: {
        state: overlayInteractionActive ? 'interactive' : overlayHotkeyRegistered ? 'ready' : 'hotkey-error',
        detail: overlayHotkeyRegistered
          ? `Interaction hotkey: ${config.windows.overlay.interactionHotkey}`
          : `Could not register: ${config.windows.overlay.interactionHotkey || 'empty hotkey'}`
      }
    });
  }
}

function saveConfig() {
  configStore.write(config);
}

function ensureCompanionPresenceConfig() {
  const existing = String(config?.presence?.clientId || '').trim();
  const clientId = /^[A-Za-z0-9._:-]{8,96}$/.test(existing)
    ? existing
    : `companion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`.slice(0, 96);
  const displayName = String(config?.presence?.displayName || 'SpaceMountain Companion').trim().slice(0, 60) || 'SpaceMountain Companion';
  config.presence = { clientId, displayName };
  return config.presence;
}

async function heartbeatCompanionPresence() {
  if (!config) return;
  const presence = ensureCompanionPresenceConfig();
  try {
    await fetch(SPMT_PRESENCE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'companion', clientId: presence.clientId, displayName: presence.displayName }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
    });
  } catch {
    // Presence is observational and must never interfere with Companion.
  }
}

function startCompanionPresence() {
  if (companionPresenceTimer) clearInterval(companionPresenceTimer);
  void heartbeatCompanionPresence();
  companionPresenceTimer = setInterval(() => void heartbeatCompanionPresence(), COMPANION_PRESENCE_INTERVAL_MS);
}

function stopCompanionPresence() {
  if (companionPresenceTimer) clearInterval(companionPresenceTimer);
  companionPresenceTimer = null;
}

function enforceOverlayAlwaysOnTop(target = overlayWindow) {
  if (!target || target.isDestroyed()) return;
  try { target.setAlwaysOnTop(true, 'screen-saver'); } catch { target.setAlwaysOnTop(true); }
  try { target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {
    try { target.setVisibleOnAllWorkspaces(true); } catch {}
  }
  if (config?.windows?.overlay) config.windows.overlay.alwaysOnTop = true;
}

function windowBoundsKey(kind, id = '') {
  return `${kind}${id ? `-${id}` : ''}`;
}

function rememberBounds(window, kind, id = '') {
  const key = windowBoundsKey(kind, id);
  const persist = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    if (kind === 'overlay' && config.windows.overlay.fitToDisplay !== false) return;
    config.windowBounds = { ...(config.windowBounds || {}), [key]: window.getBounds() };
    saveConfig();
  };
  window.on('moved', persist);
  window.on('resized', persist);
}

function managedWindowOptions(kind, id = '') {
  const key = windowBoundsKey(kind, id);
  const saved = config.windowBounds?.[key] || {};
  const overlayDisplay = kind === 'overlay' && config.windows.overlay.fitToDisplay !== false
    ? screen.getDisplayMatching(Object.keys(saved).length ? saved : screen.getPrimaryDisplay().bounds)
    : null;
  const bounds = overlayDisplay?.bounds || saved;
  const appWindow = kind === 'workspace' || kind === 'spaceMountain';
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || (kind === 'overlay' ? 1280 : appWindow ? 1280 : 520),
    height: bounds.height || (kind === 'overlay' ? 720 : appWindow ? 820 : 420),
    show: false,
    skipTaskbar: !appWindow,
    autoHideMenuBar: true,
    backgroundColor: kind === 'overlay' ? '#00000000' : '#080b14',
    transparent: kind === 'overlay',
    frame: kind !== 'overlay',
    alwaysOnTop: kind === 'overlay' && config.windows.overlay.alwaysOnTop !== false,
    webPreferences: {
      preload: kind === 'overlay' ? path.join(__dirname, 'overlay-preload.cjs') : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

const trustedWorkspaceOrigins = new Set([
  'https://spacemountain.live',
  'https://spacemountain-live.fly.dev',
  'https://spmt.live',
  STREAMWEAVER_ORIGIN
]);

function trustManagedUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') trustedWorkspaceOrigins.add(parsed.origin);
  } catch {}
}

function isTrustedWorkspaceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && trustedWorkspaceOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

function loadManagedUrl(window, value) {
  const url = String(value || '').trim();
  if (!/^(https?:\/\/)/i.test(url)) throw new Error('Managed window URL must use HTTP or HTTPS');
  return window.loadURL(url);
}

function ensureWorkspaceWindow() {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) return workspaceWindow;
  workspaceWindow = new BrowserWindow(managedWindowOptions('workspace'));
  workspaceWindow.setTitle('StreamWeaver · SpaceMountain Companion');
  rememberBounds(workspaceWindow, 'workspace');
  workspaceWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedWorkspaceUrl(url)) {
      void workspaceWindow.loadURL(url);
    } else if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  workspaceWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedWorkspaceUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  workspaceWindow.webContents.on('did-navigate', (_event, url) => {
    if (url.startsWith('https://spacemountain.live/') && overlayWindow && !overlayWindow.isDestroyed()) {
      void refreshCanonicalPersonalOverlay(overlayWindow);
    }
  });
  workspaceWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    workspaceWindow.hide();
  });
  void loadManagedUrl(workspaceWindow, config.windows.workspace.url);
  return workspaceWindow;
}

function showWorkspace() {
  const window = ensureWorkspaceWindow();
  const target = String(config.windows.workspace.url || COMPANION_WORKSPACE_URL).trim() || COMPANION_WORKSPACE_URL;
  trustManagedUrl(target);
  if (window.webContents.getURL() !== target) void loadManagedUrl(window, target);
  window.setTitle('StreamWeaver · SpaceMountain Companion');
  window.show();
  window.focus();
  return { visible: true };
}

async function showSpmtSurface(surface = 'worktray') {
  const allowed = new Set(['worktray', 'settings', 'overlays']);
  const selected = allowed.has(surface) ? surface : 'worktray';
  const window = ensureWorkspaceWindow();
  let target = '';
  try {
    target = await resolveSurfaceUrl(window.webContents.session, selected, 'companion', SPMT_ORIGIN);
  } catch (error) {
    logCompanion(`Canonical SPMT surface could not be resolved (${selected})`, error);
  }
  if (!target) target = SPMT_ORIGIN;
  trustManagedUrl(target);
  await loadManagedUrl(window, target);
  window.setTitle(`SPMT ${selected === 'worktray' ? 'Workspace' : selected === 'settings' ? 'Settings' : 'Overlay Bay'} · Companion`);
  window.show();
  window.focus();
  return { visible: true, surface: selected, canonical: target !== SPMT_ORIGIN };
}

async function refreshCanonicalPersonalOverlay(targetWindow = overlayWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return '';
  const browserSession = workspaceWindow && !workspaceWindow.isDestroyed()
    ? workspaceWindow.webContents.session
    : targetWindow.webContents.session;
  let resolved = '';
  try {
    resolved = await resolvePersonalOverlayUrl(browserSession, SPMT_ORIGIN);
  } catch (error) {
    logCompanion('Canonical Personal overlay URL could not be resolved', error);
  }
  const cached = String(config.windows.overlay.url || '').trim();
  const next = resolved || cached;
  if (!next) return '';
  trustManagedUrl(next);
  if (resolved && resolved !== cached) {
    config.windows.overlay.url = resolved;
    saveConfig();
  }
  if (targetWindow.webContents.getURL() !== next) await loadManagedUrl(targetWindow, next);
  return next;
}

function ensureSpaceMountainWindow() {
  if (spaceMountainWindow && !spaceMountainWindow.isDestroyed()) return spaceMountainWindow;
  spaceMountainWindow = new BrowserWindow(managedWindowOptions('spaceMountain'));
  spaceMountainWindow.setTitle('SpaceMountain · Companion');
  rememberBounds(spaceMountainWindow, 'spaceMountain');
  spaceMountainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedWorkspaceUrl(url)) {
      void spaceMountainWindow.loadURL(url);
    } else if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  spaceMountainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedWorkspaceUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  spaceMountainWindow.webContents.on('did-navigate', (_event, url) => {
    if (url.startsWith('https://spacemountain.live/')) overlayWindow?.webContents.reload();
  });
  spaceMountainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    spaceMountainWindow.hide();
  });
  void loadManagedUrl(spaceMountainWindow, config.windows.spaceMountain.url);
  return spaceMountainWindow;
}

function showSpaceMountain() {
  const window = ensureSpaceMountainWindow();
  window.show();
  window.focus();
  return { visible: true };
}

function fitOverlayToDisplay() {
  const window = ensureOverlayWindow();
  const display = screen.getDisplayMatching(window.getBounds());
  window.setBounds(display.bounds);
  syncSocialOverlayBounds();
  config.windowBounds = { ...(config.windowBounds || {}), overlay: { ...display.bounds } };
  saveConfig();
  return { displayId: display.id, bounds: display.bounds };
}

function emitOverlayInteractionState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('companion:overlay-interaction', {
    active: overlayInteractionActive,
    hotkey: config.windows.overlay.interactionHotkey
  });
}

function setOverlayInteraction(active) {
  const window = ensureOverlayWindow();
  enforceOverlayAlwaysOnTop(window);
  overlayInteractionActive = Boolean(active);
  if (overlayInteractionActive) {
    if (config.windows.overlay.fitToDisplay !== false) fitOverlayToDisplay();
    window.setIgnoreMouseEvents(false);
    window.show();
    window.focus();
    syncSocialOverlayBounds();
    config.windows.overlay.visible = true;
  } else {
    window.setIgnoreMouseEvents(config.windows.overlay.clickThrough !== false, { forward: true });
    if (config.windows.overlay.visible) window.showInactive();
  }
  emitOverlayInteractionState();
  saveConfig();
  rebuildTrayMenu();
  emitStatus();
  return { active: overlayInteractionActive, hotkey: config.windows.overlay.interactionHotkey };
}

function toggleOverlayInteraction() {
  return setOverlayInteraction(!overlayInteractionActive);
}

function registerOverlayHotkey() {
  const accelerator = String(config.windows.overlay.interactionHotkey || '').trim();
  if (overlayHotkeyAccelerator) globalShortcut.unregister(overlayHotkeyAccelerator);
  overlayHotkeyRegistered = Boolean(accelerator) && globalShortcut.register(accelerator, toggleOverlayInteraction);
  overlayHotkeyAccelerator = overlayHotkeyRegistered ? accelerator : '';
  if (!overlayHotkeyRegistered) {
    logCompanion(`Overlay interaction hotkey could not be registered (${accelerator || 'empty'})`);
  }
  emitStatus();
  return overlayHotkeyRegistered;
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  overlayWindow = new BrowserWindow(managedWindowOptions('overlay'));
  overlayWindow.setTitle('SPMT Personal Overlay');
  config.windows.overlay.alwaysOnTop = true;
  enforceOverlayAlwaysOnTop(overlayWindow);
  overlayWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
    if (!isAlwaysOnTop && !quitting) setTimeout(() => enforceOverlayAlwaysOnTop(overlayWindow), 0);
  });
  overlayWindow.setFullScreenable(false);
  overlayWindow.setOpacity(1);
  overlayWindow.setIgnoreMouseEvents(
    overlayInteractionActive ? false : config.windows.overlay.clickThrough !== false,
    { forward: true }
  );
  rememberBounds(overlayWindow, 'overlay');
  overlayWindow.webContents.on('did-finish-load', emitOverlayInteractionState);
  overlayWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    overlayInteractionActive = false;
    overlayWindow.hide();
    config.windows.overlay.visible = false;
    saveConfig();
  });
  const cachedPersonalUrl = String(config.windows.overlay.url || '').trim();
  if (cachedPersonalUrl) {
    trustManagedUrl(cachedPersonalUrl);
    void loadManagedUrl(overlayWindow, cachedPersonalUrl);
  } else {
    void overlayWindow.loadURL('about:blank');
  }
  void refreshCanonicalPersonalOverlay(overlayWindow);
  return overlayWindow;
}


function ensureSocialOverlayWindow() {
  if (socialOverlayWindow && !socialOverlayWindow.isDestroyed()) return socialOverlayWindow;
  socialOverlayWindow = new BrowserWindow({
    ...managedWindowOptions('overlay'),
    focusable: false,
  });
  socialOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  socialOverlayWindow.webContents.setAudioMuted(true);
  socialOverlayWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    socialOverlayWindow.hide();
  });
  void loadManagedUrl(socialOverlayWindow, config.windows.overlay.socialUrl || 'https://streamweaver-new.fly.dev/overlay/social');
  return socialOverlayWindow;
}

function syncSocialOverlayBounds() {
  if (!socialOverlayWindow || socialOverlayWindow.isDestroyed() || !overlayWindow || overlayWindow.isDestroyed()) return;
  socialOverlayWindow.setBounds(overlayWindow.getBounds());
  socialOverlayWindow.setAlwaysOnTop(config.windows.overlay.alwaysOnTop !== false, 'screen-saver');
}

function popoutConfig(id) {
  return config.windows.popouts.find((entry) => Number(entry.id) === Number(id));
}

function ensurePopoutWindow(id) {
  const numericId = Number(id);
  const existing = popoutWindows.get(numericId);
  if (existing && !existing.isDestroyed()) return existing;
  const entry = popoutConfig(numericId);
  if (!entry) throw new Error('Unknown popout');
  const window = new BrowserWindow(managedWindowOptions('popout', String(numericId)));
  popoutWindows.set(numericId, window);
  rememberBounds(window, 'popout', String(numericId));
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
    entry.visible = false;
    saveConfig();
  });
  void loadManagedUrl(window, entry.url);
  return window;
}

function showOverlay() {
  const window = ensureOverlayWindow();
  enforceOverlayAlwaysOnTop(window);
  if (config.windows.overlay.fitToDisplay !== false) fitOverlayToDisplay();
  window.showInactive();
  if (config.windows.overlay.socialEnabled !== false) {
    const socialWindow = ensureSocialOverlayWindow();
    syncSocialOverlayBounds();
    socialWindow.showInactive();
  }
  config.windows.overlay.visible = true;
  saveConfig();
  rebuildTrayMenu();
  return { visible: true };
}

function hideOverlay() {
  overlayInteractionActive = false;
  overlayWindow?.hide();
  socialOverlayWindow?.hide();
  config.windows.overlay.visible = false;
  saveConfig();
  rebuildTrayMenu();
  return { visible: false };
}

function showPopout(id) {
  const entry = popoutConfig(id);
  if (!entry) throw new Error('Unknown popout');
  const window = ensurePopoutWindow(id);
  window.show();
  entry.visible = true;
  saveConfig();
  return { id: Number(id), visible: true };
}

function hidePopout(id) {
  const entry = popoutConfig(id);
  if (!entry) throw new Error('Unknown popout');
  popoutWindows.get(Number(id))?.hide();
  entry.visible = false;
  saveConfig();
  return { id: Number(id), visible: false };
}

function applyAudio(payload = {}) {
  if (typeof payload.muted === 'boolean') config.audio.muted = payload.muted;
  if (Number.isFinite(Number(payload.volume))) config.audio.volume = Math.max(0, Math.min(1, Number(payload.volume)));
  const windows = [overlayWindow, ...popoutWindows.values()].filter((window) => window && !window.isDestroyed());
  for (const window of windows) {
    window.webContents.setAudioMuted(Boolean(config.audio.muted));
    const volume = Number(config.audio.volume);
    const outputDeviceId = String(config.audio.outputDeviceId || '');
    void window.webContents.executeJavaScript(
      `document.querySelectorAll('audio,video').forEach((item)=>{item.volume=${JSON.stringify(volume)};if(${JSON.stringify(outputDeviceId)}&&typeof item.setSinkId==='function'){item.setSinkId(${JSON.stringify(outputDeviceId)}).catch(()=>{})}})`,
      true
    ).catch(() => {});
  }
  saveConfig();
  return { muted: config.audio.muted, volume: config.audio.volume };
}

async function connectObs() {
  try {
    await obs?.disconnect().catch(() => {});
  } catch {}
  obs = null;
  if (!config.obs.enabled) {
    obsStatus = { state: 'disabled' };
    emitStatus();
    return;
  }
  const password = configStore.readSecrets().obsPassword || '';
  obsStatus = { state: 'connecting' };
  emitStatus();
  try {
    obs = new OBSWebSocket();
    await obs.connect(config.obs.url, password);
    obs.on('ConnectionClosed', () => {
      obsStatus = { state: 'disconnected' };
      emitStatus();
    });
    obsStatus = { state: 'connected' };
  } catch (error) {
    obs = null;
    obsStatus = { state: 'error', message: error instanceof Error ? error.message : 'OBS connection failed' };
  }
  emitStatus();
}

async function setObsScene(payload) {
  if (!obs) throw new Error('OBS is not connected');
  const sceneName = String(payload.sceneName || '').trim();
  if (!sceneName) throw new Error('sceneName is required');
  await obs.call('SetCurrentProgramScene', { sceneName });
  return { sceneName };
}

async function getObsScenes() {
  if (!obs) return { connected: false, scenes: [] };
  const response = await obs.call('GetSceneList');
  return { connected: true, currentScene: response.currentProgramSceneName, scenes: response.scenes || [] };
}

async function playObsMedia(payload) {
  if (!obs) throw new Error('OBS is not connected');
  const inputName = String(payload.obsInputName || config.obs.mediaInputName || '').trim();
  if (!inputName) throw new Error('An OBS media input name is required');
  const mediaName = path.basename(String(payload.mediaName || ''));
  const localFile = mediaJobs.resolve(mediaName);
  await obs.call('SetInputSettings', {
    inputName,
    inputSettings: { is_local_file: true, local_file: localFile },
    overlay: true
  });
  await obs.call('TriggerMediaInputAction', {
    inputName,
    mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
  });
  return { inputName, mediaName, playing: true };
}

function startManagedServer() {
  if (serverProcess && serverProcess.exitCode == null) return;
  clearTimeout(serverRestartTimer);
  serverStopRequested = false;
  const packagedNode = path.join(repoRoot(), process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const usePackagedRuntime = app.isPackaged && fs.existsSync(packagedNode);
  const command = process.env.STREAMWEAVER_SERVER_COMMAND
    || (usePackagedRuntime ? packagedNode : (process.platform === 'win32' ? 'npm.cmd' : 'npm'));
  const args = process.env.STREAMWEAVER_SERVER_ARGS
    ? JSON.parse(process.env.STREAMWEAVER_SERVER_ARGS)
    : (usePackagedRuntime ? ['node_modules/tsx/dist/cli.mjs', 'server.ts'] : ['run', 'start:local']);
  serverStatus = { state: 'starting' };
  emitStatus();
  serverProcess = spawn(command, args, {
    cwd: repoRoot(),
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: usePackagedRuntime ? 'production' : (process.env.NODE_ENV || 'development'),
      STREAMWEAVER_PACKAGED_RUNTIME: usePackagedRuntime ? '1' : '',
      OPEN_BROWSER: 'false',
      PORT: String(config.server.port),
      WS_PORT: String(config.server.wsPort),
      NEXT_PUBLIC_STREAMWEAVE_PORT: String(config.server.port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.on('spawn', () => logCompanion(`Managed server started (pid ${serverProcess.pid})`));
  serverProcess.stdout.on('data', (chunk) => {
    serverStatus = { state: 'running', detail: String(chunk).trim().slice(-300) };
    emitStatus();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverStatus = { ...serverStatus, detail: String(chunk).trim().slice(-300) };
    emitStatus();
  });
  serverProcess.on('error', (error) => {
    logCompanion('Managed server failed to start', error);
    serverStatus = { state: 'error', message: error.message };
    emitStatus();
  });
  serverProcess.on('exit', (code) => {
    const requested = serverStopRequested;
    serverStatus = { state: 'stopped', code };
    serverProcess = null;
    emitStatus();
    if (!quitting && !requested) {
      serverStatus = { state: 'restarting', code };
      emitStatus();
      serverRestartTimer = setTimeout(startManagedServer, 2_000);
    }
  });
}

function stopManagedServer() {
  if (!serverProcess || serverProcess.exitCode != null) return;
  serverStopRequested = true;
  serverProcess.kill();
}

function showSettings() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 720,
      minHeight: 580,
      show: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#080b14',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    void settingsWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
    settingsWindow.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      settingsWindow.hide();
    });
  }
  settingsWindow.show();
  settingsWindow.focus();
}

function rebuildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Companion Settings', click: showSettings },
    { type: 'separator' },
    { label: config.windows.overlay.visible ? 'Hide Overlay' : 'Show Overlay', click: () => config.windows.overlay.visible ? hideOverlay() : showOverlay() },
    { label: overlayInteractionActive ? 'Finish Overlay Interaction' : `Interact With Overlay (${config.windows.overlay.interactionHotkey})`, click: toggleOverlayInteraction },
    { label: 'Fit Overlay to Current Screen', click: fitOverlayToDisplay },
    ...config.windows.popouts.map((entry) => ({
      label: `${entry.visible ? 'Hide' : 'Show'} Popout ${entry.id}: ${entry.title}`,
      click: () => entry.visible ? hidePopout(entry.id) : showPopout(entry.id)
    })),
    { type: 'separator' },
    { label: 'Open StreamWeaver', click: showWorkspace },
    { label: 'Open SPMT Workspace', click: () => void showSpmtSurface('worktray') },
    { label: 'Open Universal Settings', click: () => void showSpmtSurface('settings') },
    { label: 'Open Overlay Bay', click: () => void showSpmtSurface('overlays') },
    { label: 'Open SpaceMountain', click: showSpaceMountain },
    { label: 'Open Diagnostics Folder', click: () => void shell.openPath(diagnosticsStore.directory) },
    { label: 'Restart Local Service', click: () => { stopManagedServer(); setTimeout(startManagedServer, 800); } },
    { label: 'Check for Updates', click: () => void updateManager?.check({ manual: true }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

function setupIpc() {
  ipcMain.handle('companion:get-state', async () => ({
    config,
    status: {
      server: serverStatus,
      relay: relayStatus,
      obs: obsStatus,
      overlay: {
        state: overlayInteractionActive ? 'interactive' : overlayHotkeyRegistered ? 'ready' : 'hotkey-error',
        detail: `Interaction hotkey: ${config.windows.overlay.interactionHotkey}`
      }
    },
    media: mediaJobs.list(),
    mediaCache: mediaJobs.cacheStatus(),
    hardware: mediaJobs.hardware(),
    jobs: mediaJobs.snapshot(),
    workflowCatalog: workflowJobs.catalog(),
    workflowJobs: workflowJobs.snapshot(),
    confirmations: relay.confirmations(),
    diagnostics: diagnosticsStore.snapshot(),
    obs: await getObsScenes(),
    update: updateManager?.snapshot() || { state: 'unavailable', currentVersion: app.getVersion() }
  }));
  ipcMain.handle('companion:save-config', async (_event, updates) => {
    const next = updates && typeof updates === 'object' ? updates : {};
    const previousOverlayUrl = config.windows.overlay.url;
    config = {
      ...config,
      ...next,
      server: { ...config.server, ...(next.server || {}) },
      startup: { ...config.startup, ...(next.startup || {}) },
      relay: { ...config.relay, ...(next.relay || {}) },
      obs: { ...config.obs, ...(next.obs || {}) },
      audio: { ...config.audio, ...(next.audio || {}) },
      windows: {
        ...config.windows,
        ...(next.windows || {}),
        spaceMountain: { ...config.windows.spaceMountain, ...(next.windows?.spaceMountain || {}) },
        workspace: { ...config.windows.workspace, ...(next.windows?.workspace || {}) },
        overlay: { ...config.windows.overlay, ...(next.windows?.overlay || {}) },
        popouts: Array.isArray(next.windows?.popouts) ? next.windows.popouts.slice(0, 3) : config.windows.popouts
      },
      media: { ...config.media, ...(next.media || {}) }
    };
    saveConfig();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(config.windows.overlay.alwaysOnTop !== false, 'floating');
      overlayWindow.setVisibleOnAllWorkspaces(config.windows.overlay.alwaysOnTop !== false);
      overlayWindow.setOpacity(1);
      overlayWindow.setIgnoreMouseEvents(
        overlayInteractionActive ? false : config.windows.overlay.clickThrough !== false,
        { forward: true }
      );
      if (config.windows.overlay.fitToDisplay !== false) fitOverlayToDisplay();
      if (previousOverlayUrl !== config.windows.overlay.url) {
        await loadManagedUrl(overlayWindow, config.windows.overlay.url);
      }
    }
    registerOverlayHotkey();
    app.setLoginItemSettings({ openAtLogin: Boolean(config.startup.openAtLogin), args: ['--hidden'] });
    applyAudio(config.audio);
    mediaJobs.configure({
      maxCacheBytes: config.media.cacheBudgetBytes,
      downloadsEnabled: config.media.downloadsEnabled,
      transcodeEngine: config.media.transcodeEngine,
    });
    await connectObs();
    relay.stop();
    relay.start();
    rebuildTrayMenu();
    return { ok: true, config };
  });
  ipcMain.handle('companion:save-secrets', async (_event, next) => {
    const current = configStore.readSecrets();
    configStore.writeSecrets({ ...current, ...(next || {}) });
    await connectObs();
    relay.stop();
    relay.start();
    return { ok: true };
  });
  ipcMain.handle('companion:window', (_event, action, id) => {
    if (action === 'spacemountain.show') return showSpaceMountain();
    if (action === 'workspace.show') return showWorkspace();
    if (action === 'spmt.worktray') return showSpmtSurface('worktray');
    if (action === 'spmt.settings') return showSpmtSurface('settings');
    if (action === 'spmt.overlays') return showSpmtSurface('overlays');
    if (action === 'overlay.show') return showOverlay();
    if (action === 'overlay.hide') return hideOverlay();
    if (action === 'overlay.interact') return setOverlayInteraction(true);
    if (action === 'overlay.fit') return fitOverlayToDisplay();
    if (action === 'popout.show') return showPopout(id);
    if (action === 'popout.hide') return hidePopout(id);
    throw new Error('Unsupported window action');
  });
  ipcMain.handle('companion:overlay-interaction-get', () => ({
    active: overlayInteractionActive,
    hotkey: config.windows.overlay.interactionHotkey
  }));
  ipcMain.handle('companion:overlay-interaction-set', (_event, active) => setOverlayInteraction(active));
  ipcMain.handle('companion:media-import', async () => {
    const selection = await dialog.showOpenDialog(settingsWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: ['mp3', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return mediaJobs.importFile(selection.filePaths[0]);
  });
  ipcMain.handle('companion:media-transcode', (_event, inputName, preset) => mediaJobs.transcode(inputName, preset));
  ipcMain.handle('companion:media-download', (_event, payload) => mediaJobs.download(payload || {}));
  ipcMain.handle('companion:media-cancel', (_event, jobId) => mediaJobs.cancel(jobId));
  ipcMain.handle('companion:media-cache-prune', (_event, targetBytes) => mediaJobs.pruneDownloads(targetBytes));
  ipcMain.handle('companion:obs-play-media', (_event, mediaName, obsInputName) => playObsMedia({ mediaName, obsInputName }));
  ipcMain.handle('companion:workflow-create', (_event, workflowId, payload) => workflowJobs.createReviewRequest(workflowId, payload, 'local'));
  ipcMain.handle('companion:workflow-review', (_event, jobId, approved) => workflowJobs.review(jobId, Boolean(approved)));
  ipcMain.handle('companion:workflow-test', () => workflowJobs.run('test.echo', { message: 'Companion workflow test passed' }, 'local'));
  ipcMain.handle('companion:confirmation-resolve', (_event, commandId, approved) => relay.resolveConfirmation(commandId, Boolean(approved)));
  ipcMain.handle('companion:choose-library', async () => {
    const selection = await dialog.showOpenDialog(settingsWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    config.media.libraryPath = selection.filePaths[0];
    saveConfig();
    mediaJobs = createMediaJobs();
    workflowJobs = createWorkflowJobs();
    return config.media.libraryPath;
  });
  ipcMain.handle('companion:obs-scenes', getObsScenes);
  ipcMain.handle('companion:obs-set-scene', (_event, sceneName) => setObsScene({ sceneName }));
  ipcMain.handle('companion:audio', (_event, payload) => applyAudio(payload));
  ipcMain.handle('companion:update-check', () => updateManager?.check({ manual: true }));
  ipcMain.handle('companion:open-diagnostics', () => shell.openPath(diagnosticsStore.directory));
  ipcMain.handle('companion:open-external', (_event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only HTTP(S) URLs are allowed');
    return shell.openExternal(url);
  });
}

function createMediaJobs() {
  const libraryPath = config.media.libraryPath || path.join(app.getPath('userData'), 'media');
  return new MediaJobs({
    libraryPath,
    maxCacheBytes: config.media.cacheBudgetBytes,
    downloadsEnabled: config.media.downloadsEnabled === true,
    transcodeEngine: config.media.transcodeEngine,
    onUpdate: (job) => settingsWindow?.webContents.send('companion:media-job', job)
  });
}

function createWorkflowJobs() {
  return new WorkflowJobs({
    rootPath: app.getPath('userData'),
    mediaJobs,
    playObsMedia,
    onUpdate: (job) => settingsWindow?.webContents.send('companion:workflow-job', job)
  });
}

function createRelay() {
  return new RelayClient({
    getConfig: () => config,
    getToken: () => configStore.readSecrets().relayToken || '',
    onStatus: (status) => {
      relayStatus = status;
      emitStatus();
    },
    onConfirmationRequired: (command) => {
      settingsWindow?.webContents.send('companion:confirmation', command);
      showSettings();
    },
    handlers: {
      'companion.status': async () => ({
        server: serverStatus,
        relay: relayStatus,
        obs: obsStatus,
        media: mediaJobs.cacheStatus(),
        hardware: mediaJobs.hardware(),
      }),
      'diagnostics.snapshot.write': async (payload) => {
        const saved = diagnosticsStore.writeSnapshot(payload);
        logCompanion(`Saved production Fly diagnostics snapshot ${saved.filename} (${saved.logCount} entries)`);
        settingsWindow?.webContents.send('companion:status', {
          server: serverStatus,
          relay: relayStatus,
          obs: obsStatus,
          diagnostics: { state: 'updated', detail: saved.capturedAt },
        });
        return { filename: saved.filename, bytes: saved.bytes, logCount: saved.logCount, capturedAt: saved.capturedAt };
      },
      'overlay.show': async () => showOverlay(),
      'overlay.hide': async () => hideOverlay(),
      'popout.show': async (payload) => showPopout(payload.id),
      'popout.hide': async (payload) => hidePopout(payload.id),
      'obs.scene.set': setObsScene,
      'audio.mute': async (payload) => applyAudio({ muted: payload.muted }),
      'audio.volume': async (payload) => applyAudio({ volume: payload.volume }),
      'media.transcode': async (payload) => mediaJobs.transcode(payload.inputName, payload.preset),
      'media.cache.status': async () => mediaJobs.cacheStatus(),
      'media.download': async (payload) => {
        if (config.media.localRelayEnabled !== true) throw new Error('HearMeOut local media relay is disabled on this device');
        return mediaJobs.download(payload);
      },
      'media.download.cancel': async (payload) => mediaJobs.cancel(payload.jobId),
      'media.cache.prune': async (payload) => {
        if (config.media.localRelayEnabled !== true) throw new Error('HearMeOut local media relay is disabled on this device');
        return mediaJobs.pruneDownloads(payload.targetBytes);
      },
      'obs.media.play': playObsMedia,
      'workflow.run': async (payload) => {
        const workflowId = String(payload.workflowId || '');
        const workflowPayload = payload.input && typeof payload.input === 'object' ? payload.input : {};
        return workflowJobs.runApproved(workflowId, workflowPayload, 'relay');
      }
    }
  });
}

async function setTenantCookie(url, name, value, expirationDate, sameSite = 'lax') {
  await electronSession.defaultSession.cookies.set({
    url,
    name,
    value: String(value),
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/',
    expirationDate,
  });
}

async function seedTenantSessions(sessionToken, expiresIn = 30 * 24 * 60 * 60) {
  const token = String(sessionToken || '').trim();
  if (!token) throw new Error('Tenant link did not provide an SPMT session');
  const lifetime = Math.max(300, Number(expiresIn) || 30 * 24 * 60 * 60);
  const expirationDate = Math.floor(Date.now() / 1000) + lifetime;

  await setTenantCookie(SPMT_ORIGIN, 'spmt_token', token, expirationDate, 'no_restriction');
  await setTenantCookie('https://spacemountain.live', 'spacemountain_spmt_session', token, expirationDate);

  const response = await electronSession.defaultSession.fetch(`${STREAMWEAVER_ORIGIN}/api/auth/companion/bootstrap`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `StreamWeaver tenant link failed (${response.status})`);
  const cookies = await electronSession.defaultSession.cookies.get({
    url: STREAMWEAVER_ORIGIN,
    name: 'streamweaver-session',
  });
  if (!cookies.length) throw new Error('StreamWeaver did not persist the linked tenant session');
}

async function refreshLinkedTenantSessions() {
  const response = await electronSession.defaultSession.fetch(`${SPMT_ORIGIN}/api/auth/refresh`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  if (!payload?.token) return false;
  await seedTenantSessions(payload.token, 30 * 24 * 60 * 60);
  return true;
}

async function handleTenantBootstrap(value) {
  const parsed = parseTenantBootstrapUrl(value);
  if (!parsed || bootstrapInFlight) return false;
  bootstrapInFlight = true;
  try {
    const payload = await exchangeTenantBootstrap(fetch, parsed.code);
    await seedTenantSessions(payload.sessionToken, payload.expiresIn);

    config.relay = {
      ...config.relay,
      url: String(payload.relayUrl || 'wss://spmt.live/api/companion/relay'),
      deviceId: String(payload.device.id),
      enabled: true,
    };
    const currentSecrets = configStore.readSecrets();
    configStore.writeSecrets({ ...currentSecrets, relayToken: String(payload.pairingToken) });
    const linkedDisplayName = String(payload.user?.displayName || payload.user?.username || '').trim().slice(0, 60);
    if (linkedDisplayName) {
      const presence = ensureCompanionPresenceConfig();
      config.presence = { ...presence, displayName: linkedDisplayName };
    }
    saveConfig();
    void heartbeatCompanionPresence();
    relay.stop();
    relay.start();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.reload();
    showWorkspace();
    void refreshCanonicalPersonalOverlay(overlayWindow);
    await dialog.showMessageBox({
      type: 'info',
      title: 'Companion connected',
      message: `Connected to ${payload.user.displayName || payload.user.username || 'your SPMT tenant'}`,
      detail: 'StreamWeaver, SpaceMountain, your Personal overlay, and the secure Companion relay are now tenant linked.',
    });
    logCompanion('Companion tenant bootstrap completed');
    return true;
  } catch (error) {
    logCompanion('Companion tenant bootstrap failed', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Companion link failed',
      message: 'This tenant link could not be completed.',
      detail: `${error instanceof Error ? error.message : String(error)}\n\nReturn to SPMT and choose Connect installed Companion to create a fresh one-time link.`,
    });
    return false;
  } finally {
    bootstrapInFlight = false;
  }
}

app.on('second-instance', (_event, argv) => {
  const bootstrapUrl = findTenantBootstrapUrl(argv);
  if (bootstrapUrl) void handleTenantBootstrap(bootstrapUrl);
  else if (argv.includes('--spacemountain')) showSpaceMountain();
  else if (argv.includes('--workspace')) showWorkspace();
  else if (argv.includes('--overlay-interact')) setOverlayInteraction(true);
  else showSettings();
});
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (!parseTenantBootstrapUrl(url)) return;
  if (app.isReady() && configStore) void handleTenantBootstrap(url);
  else pendingBootstrapUrl = url;
});
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  clearTimeout(serverRestartTimer);
  relay?.stop();
  stopCompanionPresence();
  updateManager?.stop();
  stopManagedServer();
  void obs?.disconnect().catch(() => {});
});
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  diagnosticsStore = new DiagnosticsStore({ rootPath: app.getPath('userData') });
  logCompanion('Companion starting');
  app.setAsDefaultProtocolClient(COMPANION_PROTOCOL);
  configStore = new ConfigStore(app.getPath('userData'));
  config = configStore.read();
  config.windows.overlay.alwaysOnTop = true;
  ensureCompanionPresenceConfig();
  saveConfig();
  startCompanionPresence();
  mediaJobs = createMediaJobs();
  workflowJobs = createWorkflowJobs();
  relay = createRelay();
  updateManager = createUpdateManager({
    updater: autoUpdater,
    dialog,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    getWindow: () => settingsWindow,
    onStatus: (update) => settingsWindow?.webContents.send('companion:update', update),
    log: logCompanion
  });
  setupIpc();

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'app-icon.png')
    : path.join(repoRoot(), 'public', 'app-icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('SpaceMountain Companion');
  tray.on('double-click', showSettings);
  registerOverlayHotkey();
  rebuildTrayMenu();
  screen.on('display-metrics-changed', () => {
    if (overlayWindow && !overlayWindow.isDestroyed() && config.windows.overlay.fitToDisplay !== false) {
      fitOverlayToDisplay();
    }
  });
  screen.on('display-removed', () => {
    if (overlayWindow && !overlayWindow.isDestroyed() && config.windows.overlay.fitToDisplay !== false) {
      fitOverlayToDisplay();
    }
  });

  app.setLoginItemSettings({ openAtLogin: Boolean(config.startup.openAtLogin), args: ['--hidden'] });
  startManagedServer();
  relay.start();
  updateManager.start();
  await connectObs();
  await refreshLinkedTenantSessions().catch((error) => logCompanion('Existing Companion tenant session could not be refreshed', error));
  if (pendingBootstrapUrl) {
    const bootstrapUrl = pendingBootstrapUrl;
    pendingBootstrapUrl = '';
    await handleTenantBootstrap(bootstrapUrl);
  }
  if (config.windows.overlay.visible) showOverlay();
  if (parseTenantBootstrapUrl(findTenantBootstrapUrl(process.argv))) {
    // Tenant bootstrap already selected the correct workspace.
  } else if (process.argv.includes('--spacemountain')) showSpaceMountain();
  else if (process.argv.includes('--workspace')) showWorkspace();
  else if (process.argv.includes('--overlay-interact')) setOverlayInteraction(true);
  else if (!process.argv.includes('--hidden') && !config.startup.startMinimized) showSettings();
  logCompanion('Companion ready');
}).catch((error) => {
  logCompanion('Companion startup failed', error);
});
