const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

const DEFAULT_CONFIG = {
  schemaVersion: 6,
  server: { host: '127.0.0.1', port: 3100, wsPort: 8090 },
  startup: { openAtLogin: false, startMinimized: true },
  relay: { url: 'wss://spmt.live/api/companion/relay', deviceId: '', enabled: false },
  obs: { url: 'ws://127.0.0.1:4455', enabled: false, mediaInputName: 'SpaceMountain Jingles' },
  audio: { muted: false, volume: 0.7, pttKey: 'Space', outputDeviceId: '' },
  windows: {
    spaceMountain: {
      url: 'https://spacemountain.live/crew'
    },
    workspace: {
      url: 'https://spacemountain.live/?companionWorkspace=streamweaver'
    },
    overlay: {
      // This is a last-known canonical Personal launch URL cache, not a user setting.
      url: '',
      socialUrl: 'https://streamweaver-new.fly.dev/overlay/social',
      socialEnabled: true,
      visible: false,
      clickThrough: true,
      alwaysOnTop: true,
      opacity: 1,
      fitToDisplay: true,
      interactionHotkey: 'CommandOrControl+Shift+O'
    },
    popouts: [
      { id: 1, title: 'ChatTag Overlay', url: 'https://chat-tag-new.fly.dev/overlay', visible: false },
      { id: 2, title: 'All-Tenant TTS Studio', url: 'http://127.0.0.1:3100/tts-mixer', visible: false },
      { id: 3, title: 'HearMeOut', url: 'https://hearmeout-main.fly.dev', visible: false }
    ]
  },
  media: {
    libraryPath: '',
    localRelayEnabled: false,
    downloadsEnabled: false,
    cacheBudgetBytes: 20 * 1024 * 1024 * 1024,
    transcodeEngine: 'auto'
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class ConfigStore {
  constructor(userDataPath) {
    this.root = userDataPath;
    this.configPath = path.join(this.root, 'companion.json');
    this.secretPath = path.join(this.root, 'companion.secrets');
    fs.mkdirSync(this.root, { recursive: true });
  }

  read() {
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {}
    const storedVersion = Number(stored.schemaVersion || 1);
    if (storedVersion < 2
      && stored.windows?.overlay?.url === 'http://127.0.0.1:3100/tts-mixer') {
      stored.windows.overlay.url = '';
    }
    if (storedVersion < 4) {
      if (stored.windows?.workspace) stored.windows.workspace.url = DEFAULT_CONFIG.windows.workspace.url;
      if (stored.windows?.overlay
        && String(stored.windows.overlay.url || '').includes('desktopOverlay=1')) {
        stored.windows.overlay.url = '';
      }
    }
    if (storedVersion < 5 && stored.windows?.workspace) {
      stored.windows.workspace.url = DEFAULT_CONFIG.windows.workspace.url;
    }
    return {
      ...clone(DEFAULT_CONFIG),
      ...stored,
      schemaVersion: DEFAULT_CONFIG.schemaVersion,
      server: { ...DEFAULT_CONFIG.server, ...(stored.server || {}) },
      startup: { ...DEFAULT_CONFIG.startup, ...(stored.startup || {}) },
      relay: { ...DEFAULT_CONFIG.relay, ...(stored.relay || {}) },
      obs: { ...DEFAULT_CONFIG.obs, ...(stored.obs || {}) },
      audio: { ...DEFAULT_CONFIG.audio, ...(stored.audio || {}) },
      windows: {
        ...clone(DEFAULT_CONFIG.windows),
        ...(stored.windows || {}),
        spaceMountain: { ...DEFAULT_CONFIG.windows.spaceMountain, ...(stored.windows?.spaceMountain || {}) },
        workspace: { ...DEFAULT_CONFIG.windows.workspace, ...(stored.windows?.workspace || {}) },
        overlay: { ...DEFAULT_CONFIG.windows.overlay, ...(stored.windows?.overlay || {}) },
        popouts: Array.isArray(stored.windows?.popouts) ? stored.windows.popouts.slice(0, 3) : clone(DEFAULT_CONFIG.windows.popouts)
      },
      media: { ...DEFAULT_CONFIG.media, ...(stored.media || {}) }
    };
  }

  write(next) {
    const tmp = `${this.configPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.configPath);
    return next;
  }

  readSecrets() {
    try {
      const encoded = fs.readFileSync(this.secretPath);
      if (!safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(encoded));
    } catch {
      return {};
    }
  }

  writeSecrets(secrets) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
    fs.writeFileSync(this.secretPath, safeStorage.encryptString(JSON.stringify(secrets)));
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
