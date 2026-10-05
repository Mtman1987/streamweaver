'use strict';

const crypto = require('node:crypto');
const ORIGIN = 'https://spmt.live';
function trustedRestreamUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'restream.io' || u.hostname.endsWith('.restream.io')); } catch { return false; }
}
function allowedNavigation(value) {
  if (trustedRestreamUrl(value)) return true;
  try { const u = new URL(value); return u.protocol === 'https:' && ['id.twitch.tv', 'accounts.google.com'].includes(u.hostname); } catch { return false; }
}
function localPreviewRedirect(details, username) {
  if (details.resourceType !== 'subFrame') return null;
  try {
    const u = new URL(details.url);
    if (u.origin !== ORIGIN || !['/tenant/' + encodeURIComponent(username) + '/public', '/tenant/' + encodeURIComponent(username) + '/lounge'].includes(u.pathname) || u.searchParams.get('localControllerPreview') === 'off') return null;
    u.searchParams.set('localControllerPreview', 'off'); return u.href;
  } catch { return null; }
}
class RestreamHost {
  constructor({ electron, getConfig, getToken, onStatus = () => {} }) {
    this.electron = electron; this.getConfig = getConfig; this.getToken = getToken; this.onStatus = onStatus;
    this.window = null; this.children = new Set(); this.timer = null; this.expiryTimer = null; this.expiresAt = 0; this.busy = false; this.opening = false; this.identity = null;
  }
  status() { return { running: Boolean(this.window && !this.window.isDestroyed()), host: 'local', expiresAt: this.expiresAt || null }; }
  async request(action, identity = this.identity) {
    if (!identity?.deviceId || !identity.token) throw new Error('Connect Companion to your SPMT account first.');
    const r = await this.electron.session.defaultSession.fetch(ORIGIN + '/api/stream-host/local/' + action, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json', 'X-SPMT-Device': identity.deviceId, 'X-SPMT-Device-Token': identity.token },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || 'Local host reservation failed.');
    return d;
  }
  guardWindow(win) {
    win.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
    win.webContents.setWindowOpenHandler(({ url }) => allowedNavigation(url) ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined } } } : { action: 'deny' });
    win.webContents.on('did-create-window', child => {
      this.children.add(child); child.on('closed', () => this.children.delete(child)); this.guardWindow(child);
    });
  }
  armDeadline() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => { const identity = this.identity; this.destroy(); this.identity = null; void this.request('release', identity).catch(() => {}); this.onStatus(this.status()); }, Math.max(0, this.expiresAt - Date.now() - 5000));
  }
  async open() {
    if (this.status().running) { this.window.show(); this.window.focus(); return this.status(); }
    if (this.opening) throw new Error('Local Studio is already opening.');
    this.opening = true;
    this.identity = { deviceId: this.getConfig().relay?.deviceId, token: this.getToken() };
    let claimed = false;
    try {
      const reservation = await this.request('claim'); claimed = true; this.expiresAt = reservation.expiresAt;
      const partition = 'persist:spmt-restream-' + crypto.createHash('sha256').update(reservation.username).digest('hex').slice(0,24);
      const ses = this.electron.session.fromPartition(partition);
      ses.webRequest.onBeforeRequest({ urls: ['https://spmt.live/tenant/*'] }, (details, done) => {
        const redirectURL = localPreviewRedirect(details, reservation.username); done(redirectURL ? { redirectURL } : {});
      });
      ses.setPermissionRequestHandler(async (contents, permission, done, details) => {
        if (permission !== 'media' || !trustedRestreamUrl(details.requestingUrl || contents.getURL())) return done(false);
        try {
          const result = await this.electron.dialog.showMessageBox(this.window, { type: 'question', title: 'Restream microphone and camera', message: 'Allow Restream to use your microphone or camera?', buttons: ['Allow', 'Keep off'], defaultId: 1, cancelId: 1 });
          done(result.response === 0);
        } catch { done(false); }
      });
      ses.setDisplayMediaRequestHandler(async (request, done) => {
        if (!trustedRestreamUrl(request.securityOrigin)) return done({});
        try {
          const sources = await this.electron.desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
          if (!sources.length) return done({});
          const visible = sources.slice(0,30);
          const choice = await this.electron.dialog.showMessageBox(this.window, { type: 'question', title: 'Share gameplay with Restream', message: 'Choose the window or screen to share.', detail: 'System audio shares sound from your computer.', buttons: ['Cancel', ...visible.map(s => s.name)], defaultId: 0, cancelId: 0, checkboxLabel: 'Include system audio', checkboxChecked: false });
          if (!choice.response || !visible[choice.response - 1]) return done({});
          done({ video: visible[choice.response - 1], ...(request.audioRequested && choice.checkboxChecked && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
        } catch { done({}); }
      }, { useSystemPicker: true });
      this.window = new this.electron.BrowserWindow({ width: 1000, height: 700, title: 'Restream · Local Companion host', backgroundColor: '#080d19', webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      this.window.webContents.setUserAgent(ses.getUserAgent().replace(/\sElectron\/\S+/g, '').replace(/\sSpaceMountain\S*\/\S+/g, ''));
      this.guardWindow(this.window);
      this.window.on('close', event => { event.preventDefault(); this.window.hide(); });
      this.window.webContents.on('render-process-gone', () => void this.stop(false));
      this.timer = setInterval(() => void this.heartbeat(), 25000);
      this.armDeadline();
      await this.window.loadURL('https://studio.restream.io');
      this.onStatus(this.status()); return this.status();
    } catch (error) {
      this.destroy(); if (claimed) await this.request('release').catch(() => {}); this.identity = null; throw error;
    } finally { this.opening = false; }
  }
  async heartbeat() {
    if (this.busy || !this.status().running) return;
    this.busy = true;
    try { const d = await this.request('heartbeat'); if (this.status().running) { this.expiresAt = d.expiresAt; this.armDeadline(); } }
    catch { if (Date.now() >= this.expiresAt - 5000) { this.destroy(); this.identity = null; } }
    finally { this.busy = false; this.onStatus(this.status()); }
  }
  destroy() {
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.expiryTimer); this.expiryTimer = null;
    for (const child of this.children) if (!child.isDestroyed()) child.destroy(); this.children.clear();
    if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; this.expiresAt = 0;
  }
  async stop(confirm = true) {
    if (confirm && this.status().running) {
      const answer = await this.electron.dialog.showMessageBox({ type: 'question', title: 'Stop local Restream host', message: 'Stop the local Studio host? This can end its broadcast.', buttons: ['Keep running', 'Stop host'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return { stopped: false };
    }
    this.destroy(); await this.request('release').catch(() => {}); this.identity = null;
    this.onStatus(this.status()); return { stopped: true };
  }
}
module.exports = { RestreamHost, allowedNavigation, trustedRestreamUrl, localPreviewRedirect };
