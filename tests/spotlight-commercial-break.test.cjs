const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(relative, imports, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, module: { exports },
    require: name => name in imports ? imports[name] : require(name),
    Date, AbortSignal, process, ...extra });
  return exports;
}
const service = load('src/services/commercial-break.ts', { '@/lib/tenant': { tenantPath() {} } });
const idle = { schemaVersion: 1, phase: 'IDLE', breakStartedAt: 0, activeUntil: 0,
  cooldownUntil: 0, lastEventMessageId: '', lastEventStartedAt: 0,
  durationSeconds: 0, isAutomatic: false, updatedAt: 0 };
const now = 1_000_000;
const program = { commercialBreak: { active: true, id: 'ad-1', breakStartedAt: now - 10_000, activeUntil: now + 32_000 } };

test('selected Spotlight ad activates the existing GIF state without a tenant EventSub event', () => {
  const state = service.withSpotlightCommercialBreak(idle, program, now);
  assert.equal(state.phase, 'ACTIVE');
  assert.equal(state.activeUntil, now + 32_000);
  assert.equal(state.lastEventMessageId, 'spotlight:ad-1');
  assert.equal(idle.phase, 'IDLE', 'overlay state does not mutate stored EventSub state');
  assert.equal(service.withSpotlightCommercialBreak(idle, program, now + 32_000), idle);
  const cooldown = { ...idle, phase: 'COOLDOWN', cooldownUntil: now + 300_000 };
  assert.equal(service.withSpotlightCommercialBreak(cooldown, program, now).phase, 'ACTIVE');
});
test('unknown, future and expired markers cannot fire the GIF; longer tenant commercials remain active', () => {
  for (const marker of [null, {}, { ...program.commercialBreak, active: false },
    { ...program.commercialBreak, breakStartedAt: now + 1 },
    { ...program.commercialBreak, activeUntil: NaN }]) {
    assert.equal(service.withSpotlightCommercialBreak(idle, { commercialBreak: marker }, now), idle);
  }
  const active = { ...idle, phase: 'ACTIVE', activeUntil: now + 180_000 };
  assert.equal(service.withSpotlightCommercialBreak(active, program, now), active);
});
test('commercial API carries relay markers to the existing player and preserves HMO audio protection', async () => {
  let time = now, fail = false, reads = 0;
  const route = load('src/app/api/lounge/commercial-break/route.ts', {
    'next/server': { NextResponse: { json: value => value } },
    '@/lib/tenant': { SPACEMOUNTAIN_SYSTEM_TENANT_ID: 'spacemountainlive' },
    '@/services/commercial-break': { ...service, getCommercialBreakState: async () => idle,
      withSpotlightCommercialBreak: (s, p) => service.withSpotlightCommercialBreak(s, p, time) },
  }, { Date: { now: () => time }, fetch: async url => {
    if (url.endsWith('/spotlight/program')) {
      reads++; if (fail) throw Error('transient outage');
      return { ok: true, json: async () => program };
    }
    return { ok: true, json: async () => ({ movie: { current: { title: 'Movie' }, playback: { status: 'playing' } } }) };
  } });
  let result = await route.GET();
  assert.equal(result.phase, 'ACTIVE');
  assert.equal(result.mediaActive, true);
  await route.GET(); assert.equal(reads, 1, 'one-second player polls reuse the worker status briefly');
  time += 3000; fail = true;
  result = await route.GET(); assert.equal(result.phase, 'ACTIVE');
  time = now + 32_000;
  result = await route.GET(); assert.equal(result.phase, 'IDLE', 'a failed worker request never extends an ad');
});


test('buffered playback keeps the cover after the source expires and clears it after the ad tail', () => {
  const relay = { commercialBreak: null, recentCommercialBreak: { active: true, id: 'buffered-ad',
    breakStartedAt: now - 47000, sourceEndsAt: now - 17000, activeUntil: now - 5000 } };
  const covered = service.withSpotlightCommercialBreak(idle, relay, now, 36000);
  assert.equal(covered.phase, 'ACTIVE');
  assert.equal(covered.activeUntil, now + 19000);
  assert.equal(service.withSpotlightCommercialBreak(idle, relay, now, 12000), idle);
  assert.equal(service.withSpotlightCommercialBreak(idle, relay, now + 19000, 36000), idle);
  // Pausing grows live latency by the same amount that wall time advances.
  assert.equal(service.withSpotlightCommercialBreak(idle, relay, now + 30000, 66000).phase, 'ACTIVE');
});

test('commercial theme waits for a loaded GIF, respects active media, and stays capped', () => {
  function render({ ready, mediaActive }) {
    const effects = [], now = Date.now(), gif = { url: 'https://example.test/community.gif', user: 'Crew' };
    const audio = { paused: true, volume: 1, currentTime: 0, plays: 0, pause() { this.paused = true; }, load() {},
      play() { this.paused = false; this.plays++; return Promise.resolve(); } };
    const states = [{ phase: 'ACTIVE', breakStartedAt: now - 1000, activeUntil: now + 30000, mediaActive }, [gif], 0, ready ? gif.url : ''];
    let ref = 0, state = 0;
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/commercial-break-player/page.tsx'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, module: { exports }, Date,
      require(name) {
        if (name === 'react') return { useEffect(fn) { effects.push(fn); }, useRef(value) { return { current: ref++ === 1 ? audio : value }; },
          useState() { return [states[state++], () => {}]; } };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name === '@/lib/lounge-broadcast-volume') return { useLoungeBroadcastVolume: () => 1 };
        throw Error(name);
      } });
    exports.default();
    effects[0](); effects[2]();
    return audio;
  }
  assert.equal(render({ ready: false, mediaActive: false }).plays, 0, 'no audio before the visible GIF loads');
  assert.equal(render({ ready: true, mediaActive: true }).plays, 0, 'a movie or music session suppresses the commercial theme');
  const playing = render({ ready: true, mediaActive: false });
  assert.equal(playing.plays, 1);
  assert.equal(playing.volume, .15);
});
