'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MediaJobs, mediaFileNameFromUrl } = require('../lib/media-jobs.cjs');

function createJobs(options = {}) {
  const libraryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'spmt-media-jobs-'));
  return {
    libraryPath,
    jobs: new MediaJobs({ libraryPath, ffmpegPath: '__missing_ffmpeg__', ...options }),
  };
}

test('download cache names are deterministic and cannot escape the media library', () => {
  const first = mediaFileNameFromUrl('https://media.example/path/movie.mkv?token=redacted', '../../Movie Night.mkv');
  const second = mediaFileNameFromUrl('https://media.example/path/movie.mkv?token=redacted', '../../Movie Night.mkv');
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{12}-Movie-Night\.mkv$/);
  assert.equal(first.includes('..'), false);
});

test('local downloads are opt-in and HTTPS-only', () => {
  const disabled = createJobs({ downloadsEnabled: false }).jobs;
  assert.throws(() => disabled.download({ url: 'https://media.example/movie.mp4' }), /disabled/i);

  const enabled = createJobs({ downloadsEnabled: true }).jobs;
  assert.throws(() => enabled.download({ url: 'http://media.example/movie.mp4' }), /HTTPS/i);
});

test('downloads never adopt an untagged local file into the prunable cache', () => {
  const { libraryPath, jobs } = createJobs({ downloadsEnabled: true });
  const url = 'https://media.example/movie.mp4';
  const target = mediaFileNameFromUrl(url);
  fs.writeFileSync(path.join(libraryPath, target), Buffer.alloc(8));
  assert.throws(() => jobs.download({ url }), /non-cache media file/i);
});

test('LRU pruning removes only tagged download-cache files', () => {
  const { libraryPath, jobs } = createJobs({ downloadsEnabled: true });
  fs.writeFileSync(path.join(libraryPath, 'imported.mp4'), Buffer.alloc(10));
  fs.writeFileSync(path.join(libraryPath, 'cached.mp4'), Buffer.alloc(20));
  fs.writeFileSync(path.join(libraryPath, 'cached.mp4.cache.json'), JSON.stringify({ completedAt: '2026-01-01T00:00:00.000Z' }));

  const result = jobs.pruneDownloads(0);
  assert.equal(result.removed.length, 1);
  assert.equal(fs.existsSync(path.join(libraryPath, 'cached.mp4')), false);
  assert.equal(fs.existsSync(path.join(libraryPath, 'imported.mp4')), true);
});

test('relay exposes bounded media actions and forces approval for download/prune', () => {
  const relaySource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'relay-client.cjs'), 'utf8');
  assert.match(relaySource, /'media\.download': 'media\.write'/);
  assert.match(relaySource, /'media\.cache\.status': 'media\.read'/);
  assert.match(relaySource, /'media\.cache\.prune': 'media\.write'/);
  assert.match(relaySource, /LOCAL_CONFIRMATION_ACTIONS = new Set\(\['media\.download', 'media\.cache\.prune'\]\)/);
});
