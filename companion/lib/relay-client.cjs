const WebSocket = require('ws');

const ACTION_CAPABILITIES = {
  'overlay.show': 'overlay.control',
  'overlay.hide': 'overlay.control',
  'popout.show': 'overlay.control',
  'popout.hide': 'overlay.control',
  'obs.scene.set': 'obs.control',
  'audio.mute': 'audio.control',
  'audio.volume': 'audio.control',
  'media.transcode': 'media.write',
  'companion.status': 'companion.status'
};

class RelayClient {
  constructor({ getConfig, getToken, handlers, onStatus = () => {} }) {
    this.getConfig = getConfig;
    this.getToken = getToken;
    this.handlers = handlers;
    this.onStatus = onStatus;
    this.socket = null;
    this.timer = null;
    this.seen = new Set();
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }

  connect() {
    if (this.stopped) return;
    const config = this.getConfig();
    const token = this.getToken();
    if (!config.relay?.enabled || !/^wss:\/\//i.test(config.relay.url) || !token) {
      this.onStatus({ state: 'disabled' });
      return;
    }
    this.onStatus({ state: 'connecting' });
    const socket = new WebSocket(config.relay.url, {
      headers: { Authorization: `Bearer ${token}`, 'X-SPMT-Device': config.relay.deviceId || '' },
      rejectUnauthorized: true
    });
    this.socket = socket;
    socket.on('open', () => {
      this.onStatus({ state: 'connected' });
      socket.send(JSON.stringify({ type: 'companion.ready', schemaVersion: 1, deviceId: config.relay.deviceId }));
    });
    socket.on('message', (raw) => void this.handle(raw));
    socket.on('error', (error) => this.onStatus({ state: 'error', message: error.message }));
    socket.on('close', () => {
      this.onStatus({ state: 'disconnected' });
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 3000);
    });
  }

  async handle(raw) {
    let command;
    try {
      command = JSON.parse(String(raw));
    } catch {
      return;
    }
    const id = String(command?.id || '');
    const action = String(command?.action || '');
    const expectedCapability = ACTION_CAPABILITIES[action];
    const expiresAt = Date.parse(String(command?.expiresAt || ''));
    const expectedDeviceId = String(this.getConfig().relay?.deviceId || '');
    if (
      command?.schemaVersion !== 1 ||
      !id ||
      this.seen.has(id) ||
      !expectedDeviceId ||
      command.deviceId !== expectedDeviceId ||
      !expectedCapability ||
      command.capability !== expectedCapability ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return this.reply(id, false, null, 'Rejected relay command');
    }
    this.seen.add(id);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    if (command.requiresConfirmation) {
      return this.reply(id, false, null, 'Local confirmation is required but not available for this action');
    }
    try {
      const handler = this.handlers[action];
      if (!handler) throw new Error('Action is not available on this device');
      const result = await handler(command.payload || {});
      this.reply(id, true, result, null);
    } catch (error) {
      this.reply(id, false, null, error instanceof Error ? error.message : 'Command failed');
    }
  }

  reply(id, ok, result, error) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'companion.result', schemaVersion: 1, id, ok, result, error }));
  }
}

module.exports = { RelayClient, ACTION_CAPABILITIES };
