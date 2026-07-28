'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createUpdateManager } = require('../lib/update-manager.cjs');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.installs = 0;
  }

  async checkForUpdates() {
    this.checks += 1;
    return { updateInfo: { version: '0.3.1' } };
  }

  quitAndInstall() {
    this.installs += 1;
  }
}

test('development builds do not contact the release provider', async () => {
  const updater = new FakeUpdater();
  const manager = createUpdateManager({
    updater,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    isPackaged: false,
    currentVersion: '0.3.0'
  });

  await manager.check({ manual: true });
  assert.equal(updater.checks, 0);
  assert.equal(manager.snapshot().state, 'development');
});

test('packaged update checks expose download state and install only after approval', async () => {
  const updater = new FakeUpdater();
  const statuses = [];
  const manager = createUpdateManager({
    updater,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    isPackaged: true,
    currentVersion: '0.3.0',
    onStatus: (status) => statuses.push(status),
    initialDelayMs: 60_000,
    intervalMs: 60_000
  });

  manager.start();
  await manager.check({ manual: true });
  updater.emit('update-available', { version: '0.3.1' });
  updater.emit('download-progress', { percent: 42.4 });
  updater.emit('update-downloaded', { version: '0.3.1' });
  await new Promise((resolve) => setImmediate(resolve));
  manager.stop();

  assert.equal(updater.checks, 1);
  assert.equal(updater.installs, 1);
  assert.equal(statuses.some((status) => status.state === 'downloading' && status.percent === 42), true);
  assert.equal(manager.snapshot().state, 'ready');
});
