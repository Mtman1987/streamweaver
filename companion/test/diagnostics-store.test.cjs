'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DiagnosticsStore } = require('../lib/diagnostics-store.cjs');

test('diagnostics store keeps local and Fly logs together while redacting secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-diagnostics-'));
  const store = new DiagnosticsStore({ rootPath: root, maxSnapshots: 2 });
  store.log('relay connected Authorization: Bearer this-is-a-secret-token');
  const result = store.writeSnapshot({
    snapshotId: '../unsafe/id',
    capturedAt: '2026-08-16T10:00:00.000Z',
    mode: 'verbose',
    states: { token: 'do-not-save', appCount: 2 },
    logs: [{ appName: 'streamweaver-new', message: 'failed api_key="private-key"' }],
  });

  assert.match(result.filename, /^fly-snapshot-/);
  assert.doesNotMatch(result.filename, /[\\/]/);
  const directory = path.join(root, 'diagnostics');
  const combined = fs.readdirSync(directory).map((name) => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /this-is-a-secret-token|do-not-save|private-key/);
  assert.match(combined, /\[REDACTED\]/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'latest-fly-snapshot.json'), 'utf8')).logs.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('diagnostics store keeps only the configured number of dated snapshots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-diagnostics-'));
  const store = new DiagnosticsStore({ rootPath: root, maxSnapshots: 2 });
  for (let index = 0; index < 3; index += 1) {
    store.writeSnapshot({ snapshotId: `snapshot-${index}`, capturedAt: `2026-08-16T10:00:0${index}.000Z`, logs: [] });
  }
  const snapshots = fs.readdirSync(path.join(root, 'diagnostics')).filter((name) => name.startsWith('fly-snapshot-'));
  assert.equal(snapshots.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
