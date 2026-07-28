import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeaArtHistory,
  extractSeaArtStreamText,
  normalizeSeaArtCharacterId,
  requestSeaArtCharacterCompletion,
  stableSeaArtDeviceId,
} from '../src/services/seaart-character-chat';

test('normalizes raw SeaArt character IDs and full character URLs', () => {
  assert.equal(normalizeSeaArtCharacterId('character-123'), 'character-123');
  assert.equal(
    normalizeSeaArtCharacterId('https://www.seaart.ai/character/chat/d5f5v2te878c73cmjhhg?from=null'),
    'd5f5v2te878c73cmjhhg',
  );
});

test('derives a stable UUID-shaped tourist device ID per tenant', () => {
  const first = stableSeaArtDeviceId('tenant-a');
  assert.equal(first, stableSeaArtDeviceId('tenant-a'));
  assert.notEqual(first, stableSeaArtDeviceId('tenant-b'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('maps private tenant history to SeaArt roles and keeps server-compatible ending', () => {
  const history = buildSeaArtHistory([
    { type: 'user', username: 'viewer', message: 'hello', timestamp: 'now' },
    { type: 'ai', username: 'Athena', message: 'hi', timestamp: 'now' },
    { type: 'user', username: 'viewer', message: 'remember me', timestamp: 'now' },
  ]);

  assert.deepEqual(history.map(({ role, content }) => ({ role, content })), [
    { role: 1, content: 'hello' },
    { role: 2, content: 'hi' },
    { role: 1, content: 'remember me' },
    { role: 2, content: ' ' },
  ]);
});

test('extracts visible text from SeaArt chunk events', () => {
  const stream = [
    'event: chunk\ndata: {"choices":[{"message":{"content":"Hello "}}]}',
    'event: chunk\ndata: {"choices":[{"message":{"content":"Commander"}}]}',
    'event: end\ndata: {"choices":[{"message":{"content":""}}]}',
  ].join('\n\n');
  assert.equal(extractSeaArtStreamText(stream), 'Hello Commander');
});

test('extracts delta, cumulative, nested, array, JSON-lines, and plain SSE variants', () => {
  assert.equal(extractSeaArtStreamText([
    'data: {"choices":[{"delta":{"content":"Hello "}}]}',
    'data: {"choices":[{"delta":{"content":"Commander"}}]}',
    'data: [DONE]',
  ].join('\n\n')), 'Hello Commander');

  assert.equal(extractSeaArtStreamText([
    'data: {"result":{"message":{"content":"Hello"}}}',
    'data: {"result":{"message":{"content":"Hello Commander"}}}',
  ].join('\n\n')), 'Hello Commander');

  assert.equal(
    extractSeaArtStreamText('{"data":{"output":{"content":[{"type":"text","text":"Array reply"}]}}}\n{"done":true}'),
    'Array reply',
  );
  assert.equal(extractSeaArtStreamText('event: chunk\ndata: Plain reply\n\ndata: [DONE]'), 'Plain reply');
});

test('removes SeaArt animation and voice timing tuples appended to character dialogue', () => {
  const dialogue = 'She smiles softly. I am glad you think so.';
  const leakedMetadata = [
    '[0.9,0.1,0.9,0.1]',
    '[5521,3.90,125,0.40]',
    '[5575,4.00,152,0.50]',
    '[7385,5.30,589,[8819,6.20,600,1.80]',
  ].join('');

  assert.equal(
    extractSeaArtStreamText(`data: ${dialogue}${leakedMetadata}\n\n`),
    dialogue,
  );
  assert.equal(
    extractSeaArtStreamText('data: Meet me between chapters [1, 2, 3, 4].\n\n'),
    'Meet me between chapters [1, 2, 3, 4].',
  );
});

test('creates, chats, and cleans up a SeaArt character session', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (String(url).endsWith('/character/session/create')) {
      return new Response(JSON.stringify({ status: { code: 10000 }, data: { session_id: 'session-1' } }), { status: 200 });
    }
    if (String(url).includes('/api/stream/character/session/chat_new')) {
      return new Response('event: chunk\ndata: {"choices":[{"message":{"content":"SeaArt reply"}}]}\n\nevent: end\ndata: {"choices":[{"message":{"content":""}}]}\n\n', { status: 200 });
    }
    return new Response(JSON.stringify({ status: { code: 10000 } }), { status: 200 });
  };

  const result = await requestSeaArtCharacterCompletion({
    token: 'secret-token',
    tenantId: 'tenant-1',
    characterId: 'character-1',
    message: 'hello',
    history: [],
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, 'SeaArt reply');
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(String(calls[0].init.body)).character_id, 'character-1');
  assert.equal((calls[1].init.headers as Record<string, string>).token, 'secret-token');
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { id: 'session-1' });
});

test('surfaces an application error returned inside a successful SeaArt stream response', async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).endsWith('/character/session/create')) {
      return new Response(JSON.stringify({ status: { code: 10000 }, data: { session_id: 'session-1' } }), { status: 200 });
    }
    if (String(url).includes('/api/stream/character/session/chat_new')) {
      return new Response('data: {"status":{"code":40003,"msg":"Character is unavailable"}}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response('{}', { status: 200 });
  };

  const result = await requestSeaArtCharacterCompletion({
    token: 'secret-token',
    tenantId: 'tenant-1',
    characterId: 'character-1',
    message: 'hello',
    history: [],
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, '');
  assert.equal(result.upstreamError, 'Character is unavailable');
});

test('retries character chat as tourist when SeaArt rejects the account token', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let sessionNumber = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (String(url).endsWith('/character/session/create')) {
      sessionNumber += 1;
      return new Response(JSON.stringify({
        status: { code: 10000 },
        data: { session_id: `session-${sessionNumber}` },
      }), { status: 200 });
    }
    if (String(url).includes('/api/stream/character/session/chat_new')) {
      return new Response('data: {"status":{"code":401,"msg":"auth token invalid"}}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (String(url).includes('/tourist_chat')) {
      return new Response('data: {"choices":[{"delta":{"content":"Tourist fallback reply"}}]}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response('{}', { status: 200 });
  };

  const result = await requestSeaArtCharacterCompletion({
    token: 'expired-account-token',
    tenantId: 'tenant-1',
    characterId: 'character-1',
    message: 'hello',
    history: [],
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, 'Tourist fallback reply');
  assert.equal(result.authMode, 'tourist');
  assert.equal(calls.filter((call) => call.url.endsWith('/character/session/create')).length, 2);
  assert.equal((calls.find((call) => call.url.includes('/tourist_chat'))?.init.headers as Record<string, string>).token, undefined);
});

test('reports safe stream shape diagnostics when SeaArt returns no visible content', async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).endsWith('/character/session/create')) {
      return new Response(JSON.stringify({ status: { code: 10000 }, data: { session_id: 'session-1' } }), { status: 200 });
    }
    if (String(url).includes('/api/stream/character/session/chat_new')) {
      return new Response('data: {"event":"complete","request_id":"private-value"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    }
    return new Response('{}', { status: 200 });
  };

  const result = await requestSeaArtCharacterCompletion({
    token: 'secret-token',
    tenantId: 'tenant-1',
    characterId: 'character-1',
    message: 'hello',
    history: [],
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.match(result.upstreamError || '', /^SeaArt character returned no visible text \(content-type=text\/event-stream, bytes=\d+, frames=1, shapes=event\+request_id\)$/);
  assert.doesNotMatch(result.upstreamError || '', /private-value/);
});

test('uses the tourist stream with a stable device ID when no character API token exists', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (String(url).endsWith('/character/session/create')) {
      return new Response(JSON.stringify({ status: { code: 10000 }, data: { session_id: 'tourist-1' } }), { status: 200 });
    }
    if (String(url).includes('/tourist_chat')) {
      return new Response('event: chunk\ndata: {"choices":[{"message":{"content":"Tourist reply"}}]}\n\nevent: end\ndata: {"choices":[{"message":{"content":""}}]}\n\n', { status: 200 });
    }
    return new Response(JSON.stringify({ status: { code: 10000 } }), { status: 200 });
  };

  const result = await requestSeaArtCharacterCompletion({
    tenantId: 'tenant-tourist',
    characterId: 'character-1',
    message: 'hello',
    history: [],
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.text, 'Tourist reply');
  assert.equal(result.authMode, 'tourist');
  assert.match(calls[1].url, /tourist_chat$/);
  assert.equal((calls[1].init.headers as Record<string, string>).token, undefined);
  assert.equal((calls[1].init.headers as Record<string, string>)['x-device-id'], stableSeaArtDeviceId('tenant-tourist'));
});
