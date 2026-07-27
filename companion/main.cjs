const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} = require('electron');
const OBSWebSocket = require('obs-websocket-js').default;
const { ConfigStore } = require('./lib/config-store.cjs');
const { MediaJobs } = require('./lib/media-jobs.cjs');
const { RelayClient } = require('./lib/relay-client.cjs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let configStore;
let config;
let settingsWindow;
let overlayWindow;
let tray;
let serverProcess;
let serverStatus = { state: 'stopped' };
let relayStatus = { state: 'disabled' };
let obsStatus = { state: 'disabled' };
let relay;
let mediaJobs;
let obs;
const popoutWindows = new Map();
let quitting = false;

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function emitStatus() {
  if (!settingsWindow?.isDestroyed()) {
    settingsWindow.webContents.send('companion:status', {
      server: serverStatus,
      relay: relayStatus,
      obs: obsStatus
    });
  }
}

function saveConfig() {
  configStore.write(config);
}

function windowBoundsKey(kind, id = '') {
  return `${kind}${id ? `-${id}` : ''}`;
}

function rememberBounds(window, kind, id = '') {
  const key = windowBoundsKey(kind, id);
  const persist = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    config.windowBounds = { ...(config.windowBounds || {}), [key]: window.getBounds() };
    saveConfig();
  };
  window.on('moved', persist);
  window.on('resized', persist);
}

function managedWindowOptions(kind, id = '') {
  const key = windowBoundsKey(kind, id);
  const saved = config.windowBounds?.[key] || {};
  return {
    x: saved.x,
    y: saved.y,
    width: saved.width || (kind === 'overlay' ? 1280 : 520),
    height: saved.height || (kind === 'overlay' ? 720 : 420),
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: kind === 'overlay' ? '#00000000' : '#080b14',
    transparent: kind === 'overlay',
    frame: kind !== 'overlay',
    alwaysOnTop: kind === 'overlay',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

function loadManagedUrl(window, value) {
  const url = String(value || '').trim();
  if (!/^(https?:\/\/)/i.test(url)) throw new Error('Managed window URL must use HTTP or HTTPS');
  return window.loadURL(url);
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  overlayWindow = new BrowserWindow(managedWindowOptions('overlay'));
  overlayWindow.setIgnoreMouseEvents(config.windows.overlay.clickThrough !== false, { forward: true });
  rememberBounds(overlayWindow, 'overlay');
  overlayWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    overlayWindow.hide();
    config.windows.overlay.visible = false;
    saveConfig();
  });
  void loadManagedUrl(overlayWindow, config.windows.overlay.url);
  return overlayWindow;
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
  window.showInactive();
  config.windows.overlay.visible = true;
  saveConfig();
  return { visible: true };
}

function hideOverlay() {
  overlayWindow?.hide();
  config.windows.overlay.visible = false;
  saveConfig();
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
    void window.webContents.executeJavaScript(
      `document.querySelectorAll('audio,video').forEach((item)=>{item.volume=${JSON.stringify(volume)}})`,
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

function startManagedServer() {
  if (serverProcess && serverProcess.exitCode == null) return;
  const command = process.env.STREAMWEAVER_SERVER_COMMAND || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = process.env.STREAMWEAVER_SERVER_ARGS
    ? JSON.parse(process.env.STREAMWEAVER_SERVER_ARGS)
    : ['run', 'start:local'];
  serverStatus = { state: 'starting' };
  emitStatus();
  serverProcess = spawn(command, args, {
    cwd: repoRoot(),
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      OPEN_BROWSER: 'false',
      PORT: String(config.server.port),
      WS_PORT: String(config.server.wsPort),
      NEXT_PUBLIC_STREAMWEAVE_PORT: String(config.server.port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (chunk) => {
    serverStatus = { state: 'running', detail: String(chunk).trim().slice(-300) };
    emitStatus();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverStatus = { ...serverStatus, detail: String(chunk).trim().slice(-300) };
    emitStatus();
  });
  serverProcess.on('error', (error) => {
    serverStatus = { state: 'error', message: error.message };
    emitStatus();
  });
  serverProcess.on('exit', (code) => {
    serverStatus = { state: 'stopped', code };
    serverProcess = null;
    emitStatus();
  });
}

function stopManagedServer() {
  if (!serverProcess || serverProcess.exitCode != null) return;
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
    ...config.windows.popouts.map((entry) => ({
      label: `${entry.visible ? 'Hide' : 'Show'} Popout ${entry.id}: ${entry.title}`,
      click: () => entry.visible ? hidePopout(entry.id) : showPopout(entry.id)
    })),
    { type: 'separator' },
    { label: 'Open StreamWeaver', click: () => shell.openExternal(`http://127.0.0.1:${config.server.port}/dashboard`) },
    { label: 'Restart Local Service', click: () => { stopManagedServer(); setTimeout(startManagedServer, 800); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

function setupIpc() {
  ipcMain.handle('companion:get-state', async () => ({
    config,
    status: { server: serverStatus, relay: relayStatus, obs: obsStatus },
    media: mediaJobs.list(),
    jobs: mediaJobs.snapshot(),
    obs: await getObsScenes()
  }));
  ipcMain.handle('companion:save-config', async (_event, updates) => {
    const next = updates && typeof updates === 'object' ? updates : {};
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
        overlay: { ...config.windows.overlay, ...(next.windows?.overlay || {}) },
        popouts: Array.isArray(next.windows?.popouts) ? next.windows.popouts.slice(0, 3) : config.windows.popouts
      },
      media: { ...config.media, ...(next.media || {}) }
    };
    saveConfig();
    app.setLoginItemSettings({ openAtLogin: Boolean(config.startup.openAtLogin), args: ['--hidden'] });
    applyAudio(config.audio);
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
    if (action === 'overlay.show') return showOverlay();
    if (action === 'overlay.hide') return hideOverlay();
    if (action === 'popout.show') return showPopout(id);
    if (action === 'popout.hide') return hidePopout(id);
    throw new Error('Unsupported window action');
  });
  ipcMain.handle('companion:media-import', async () => {
    const selection = await dialog.showOpenDialog(settingsWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: ['mp3', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return mediaJobs.importFile(selection.filePaths[0]);
  });
  ipcMain.handle('companion:media-transcode', (_event, inputName, preset) => mediaJobs.transcode(inputName, preset));
  ipcMain.handle('companion:choose-library', async () => {
    const selection = await dialog.showOpenDialog(settingsWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    config.media.libraryPath = selection.filePaths[0];
    saveConfig();
    mediaJobs = createMediaJobs();
    return config.media.libraryPath;
  });
  ipcMain.handle('companion:obs-scenes', getObsScenes);
  ipcMain.handle('companion:obs-set-scene', (_event, sceneName) => setObsScene({ sceneName }));
  ipcMain.handle('companion:audio', (_event, payload) => applyAudio(payload));
  ipcMain.handle('companion:open-external', (_event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only HTTP(S) URLs are allowed');
    return shell.openExternal(url);
  });
}

function createMediaJobs() {
  const libraryPath = config.media.libraryPath || path.join(app.getPath('userData'), 'media');
  return new MediaJobs({
    libraryPath,
    onUpdate: (job) => settingsWindow?.webContents.send('companion:media-job', job)
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
    handlers: {
      'companion.status': async () => ({ server: serverStatus, relay: relayStatus, obs: obsStatus }),
      'overlay.show': async () => showOverlay(),
      'overlay.hide': async () => hideOverlay(),
      'popout.show': async (payload) => showPopout(payload.id),
      'popout.hide': async (payload) => hidePopout(payload.id),
      'obs.scene.set': setObsScene,
      'audio.mute': async (payload) => applyAudio({ muted: payload.muted }),
      'audio.volume': async (payload) => applyAudio({ volume: payload.volume }),
      'media.transcode': async (payload) => mediaJobs.transcode(payload.inputName, payload.preset)
    }
  });
}

app.on('second-instance', () => showSettings());
app.on('before-quit', () => {
  quitting = true;
  relay?.stop();
  stopManagedServer();
  void obs?.disconnect().catch(() => {});
});
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath('userData'));
  config = configStore.read();
  saveConfig();
  mediaJobs = createMediaJobs();
  relay = createRelay();
  setupIpc();

  const iconPath = path.join(repoRoot(), 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('SpaceMountain Companion');
  tray.on('double-click', showSettings);
  rebuildTrayMenu();

  app.setLoginItemSettings({ openAtLogin: Boolean(config.startup.openAtLogin), args: ['--hidden'] });
  startManagedServer();
  relay.start();
  await connectObs();
  if (!process.argv.includes('--hidden') && !config.startup.startMinimized) showSettings();
});
