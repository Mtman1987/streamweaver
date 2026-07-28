const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WorkflowJobs, validateWorkflowPayload } = require('../lib/workflow-jobs.cjs');

function fixture() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'spmt-companion-workflow-'));
  const played = [];
  const manager = new WorkflowJobs({
    rootPath,
    mediaJobs: {
      has: () => false,
      writeJson: (name, value) => {
        fs.writeFileSync(path.join(rootPath, name), JSON.stringify(value));
        return { name };
      }
    },
    playObsMedia: async (payload) => {
      played.push(payload);
      return { playing: true, mediaName: payload.mediaName };
    }
  });
  return { rootPath, manager, played };
}

test('harmless workflow test runs without confirmation or external work', async (t) => {
  const { rootPath, manager } = fixture();
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const job = await manager.run('test.echo', { message: 'hello' });
  assert.equal(job.status, 'completed');
  assert.equal(job.result.echoed, 'hello');
  assert.equal(job.result.touchedLocalState, false);
});

test('song render request requires review and becomes an engine-neutral render brief', async (t) => {
  const { rootPath, manager } = fixture();
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const pending = manager.createReviewRequest('song.render.request', {
    title: 'Station Theme',
    brief: 'A short synth-pop arrival theme',
    engine: 'VOCALOID6'
  });
  assert.equal(pending.status, 'awaiting_review');
  const completed = await manager.review(pending.id, true);
  assert.equal(completed.status, 'waiting_for_renderer');
  assert.equal(completed.result.readyForRender, true);
  assert.equal(completed.result.renderer, 'VOCALOID6');
  assert.equal(fs.existsSync(path.join(rootPath, completed.result.manifestName)), true);
});

test('relay-approved creative request does not require a second local review', async (t) => {
  const { rootPath, manager } = fixture();
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const completed = await manager.runApproved('song.render.request', {
    title: 'Approved Theme',
    brief: 'Already approved through the relay confirmation UI'
  });
  assert.equal(completed.status, 'waiting_for_renderer');
  assert.equal(completed.reviewSource, 'relay-confirmation');
});

test('jingle workflow validates bounded library and OBS names', () => {
  assert.deepEqual(validateWorkflowPayload('audio.jingle.play', {
    mediaName: '../arrival.wav',
    obsInputName: 'SpaceMountain Jingles'
  }), {
    mediaName: 'arrival.wav',
    obsInputName: 'SpaceMountain Jingles',
    title: 'arrival.wav'
  });
  assert.throws(() => validateWorkflowPayload('shell.run', {}), /not allowlisted/);
});
