import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const source = fs.readFileSync(new URL('../docker-entrypoint.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function migrateFreeVoicePolicy()'));

test('migration preserves the paid pause and worker startup inherits no provider credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'free-voice-entrypoint-'));
  try {
    fs.mkdirSync(path.join(root, 'config'));
    const file = path.join(root, 'config', 'ai-cost-policy.json');
    fs.writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false, speechWorkerUrl: 'http://spmt-free-tts.internal:8080', femaleTrialVoice: 'af_bella' }));
    const processStub = new EventEmitter();
    processStub.cwd = () => root;
    let spawned;
    const child = new EventEmitter(); child.kill = () => {};
    const context = {
      fs: { ...fs, existsSync: () => true }, path, process: processStub,
      env: { PATH: '/usr/bin', OPENAI_API_KEY: 'must-not-inherit', DEEPGRAM_API_KEY: 'must-not-inherit' },
      console: { log() {}, info() {} },
      spawn: (...args) => { spawned = args; return child; },
      setTimeout: (_callback, delay) => { assert.equal(delay, 60_000); return { unref() {} }; },
    };
    vm.runInNewContext(helpers, context);
    context.migrateFreeVoicePolicy();
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { paidRoutesEnabled: false, speechWorkerUrl: 'http://127.0.0.1:8080', femaleTrialVoice: 'af_bella' });
    context.startFreeVoiceWorker();
    assert.equal(spawned[0], '/usr/bin/nice');
    assert.deepEqual(Array.from(spawned[1]).slice(0, 3), ['-n', '10', '/opt/kokoro-venv/bin/python']);
    assert.equal(spawned[2].env.OMP_NUM_THREADS, '2');
    assert.equal(spawned[2].env.OPENAI_API_KEY, undefined);
    assert.equal(spawned[2].env.DEEPGRAM_API_KEY, undefined);
    assert.equal(processStub.listenerCount('exit'), 1);
    child.emit('close', 1);
    assert.equal(processStub.listenerCount('exit'), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
