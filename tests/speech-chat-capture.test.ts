import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSpeechChat } from '../src/services/speech-chat-capture';
import { createSayChatRequestCache } from '../src/services/say-chat-request';

function fixture() {
  const sent: string[] = [];
  let errors = 0;
  let stops = 0;
  const recognition = {
    continuous: true, interimResults: true, lang: '',
    onresult: null as any, onerror: null as any, onend: null as any,
    stop() { stops++; }, abort() { this.onend?.(); },
  };
  const capture = captureSpeechChat(recognition, {
    preview() {}, complete(text) { if (text) sent.push(text); }, error() { errors++; },
  });
  const result = (texts: string[], final = true) => recognition.onresult({
    results: texts.map(transcript => Object.assign([{ transcript }], { isFinal: final })),
  });
  return { recognition, capture, sent, result, errors: () => errors, stops: () => stops };
}

test('word-by-word revisions publish only the completed sentence once', () => {
  const f = fixture();
  for (const text of ['like', 'like this', 'like this it sends STT']) f.result([text]);
  assert.deepEqual(f.sent, []);
  f.recognition.onend();
  f.recognition.onend();
  f.result(['late duplicate']);
  assert.deepEqual(f.sent, ['like this it sends STT']);
});

test('cumulative segments are merged while distinct phrases remain intact', () => {
  const f = fixture();
  f.result(['like', 'like this', 'like this it sends STT', 'please fix it']);
  f.recognition.onend();
  assert.deepEqual(f.sent, ['like this it sends STT please fix it']);
});

test('curse words and punctuation pass through without masking or rewriting', () => {
  const f = fixture();
  const transcript = 'What the fuck? This shit works!';
  f.result(['What the fuck?']);
  f.result([transcript]);
  f.recognition.onend();
  assert.deepEqual(f.sent, [transcript]);
});

test('normal single-result speech still sends once and interim-only speech never posts', () => {
  const f = fixture();
  f.result(['unfinished'], false);
  f.result(['A complete sentence']);
  f.recognition.onend();
  assert.deepEqual(f.sent, ['A complete sentence']);
  const interim = fixture();
  interim.result(['not finalized'], false);
  interim.recognition.onend();
  assert.deepEqual(interim.sent, []);
});

test('PTT release waits for the final result and ignores repeated stop requests', () => {
  const f = fixture();
  f.result(['first draft']);
  f.capture.stop();
  f.capture.stop();
  assert.equal(f.stops(), 1);
  assert.deepEqual(f.sent, []);
  f.result(['finished after release']);
  f.recognition.onend();
  assert.deepEqual(f.sent, ['finished after release']);
});

test('navigation cancellation and recognition errors cannot publish captured speech', () => {
  for (const cancel of [true, false]) {
    const f = fixture();
    f.result(['do not send']);
    if (cancel) f.capture.cancel(); else f.recognition.onerror();
    f.recognition.onend();
    f.result(['late callback']);
    assert.deepEqual(f.sent, []);
    assert.equal(f.errors(), cancel ? 0 : 1);
  }
});

test('concurrent retries share a single post and independently readable responses', async () => {
  const once = createSayChatRequestCache();
  let posts = 0;
  const send = async () => { posts++; return Response.json({ posted: true, voice: 'edenai:amazon:Joanna' }); };
  const responses = await Promise.all([once('user:room:capture', 'payload', send), once('user:room:capture', 'payload', send)]);
  assert.equal(posts, 1);
  for (const response of responses) assert.equal((await response.json()).voice, 'edenai:amazon:Joanna');
  assert.equal((await once('user:room:capture', 'different transcript', send)).status, 409);
  assert.equal(posts, 1);
});

test('new captures and different users can deliberately say the same words', async () => {
  const once = createSayChatRequestCache();
  let posts = 0;
  const send = async () => { posts++; return Response.json({ posted: true }); };
  for (const key of ['user1:room:capture1', 'user1:room:capture2', 'user2:room:capture1']) await once(key, 'same words', send);
  assert.equal(posts, 3);
});

test('a TTS failure after posting is replayed without sending the chat again', async () => {
  const once = createSayChatRequestCache();
  let posts = 0;
  const send = async () => { posts++; return Response.json({ posted: true, error: 'TTS failed' }, { status: 502 }); };
  assert.equal((await once('capture', 'payload', send)).status, 502);
  assert.equal((await once('capture', 'payload', send)).status, 502);
  assert.equal(posts, 1);
});

test('a full replay cache rejects new work without evicting an in-flight capture', async () => {
  const once = createSayChatRequestCache(120_000, 1);
  let finish!: (response: Response) => void;
  let posts = 0;
  const send = () => { posts++; return new Promise<Response>(resolve => { finish = resolve; }); };
  const original = once('capture', 'payload', send);
  await Promise.resolve();
  const retry = once('capture', 'payload', send);
  assert.equal((await once('other', 'payload', send)).status, 503);
  finish(Response.json({ posted: true }));
  await Promise.all([original, retry]);
  assert.equal(posts, 1);
});
