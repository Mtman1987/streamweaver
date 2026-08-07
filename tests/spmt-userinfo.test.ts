import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  getSpmtAthenaActor,
  getSpmtIdentity,
  getSpmtTenantId,
  readSpmtAccessToken,
} from '../src/lib/spmt-userinfo';

test('SPMT OAuth bearer identity becomes the verified Athena tenant and actor', async () => {
  const originalFetch = global.fetch;
  let userinfoAuthorization = '';
  let userinfoUrl = '';
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    userinfoUrl = String(input);
    userinfoAuthorization = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify({
      user: {
        id: 'spmt-user-1',
        username: 'space-user',
        displayName: 'Space User',
        twitchId: '94371378',
        twitchUsername: 'mtman1987',
        role: 'owner',
        isAdmin: true,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const request = new NextRequest('http://localhost/api/athena/respond', {
      headers: { authorization: 'Bearer real-spmt-oauth-token' },
    });
    const identity = await getSpmtIdentity(request);
    assert.ok(identity);
    assert.equal(userinfoUrl, 'https://spmt.live/api/oauth/userinfo');
    assert.equal(userinfoAuthorization, 'Bearer real-spmt-oauth-token');
    assert.equal(getSpmtTenantId(identity), '94371378');
    assert.deepEqual(getSpmtAthenaActor(identity!), {
      userId: '94371378',
      username: 'mtman1987',
      displayName: 'Space User',
      isOwner: true,
      isAdmin: true,
      isModerator: false,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('the existing SPMT login cookie is accepted without asking the streamer for a secret', () => {
  const request = new NextRequest('http://localhost/api/athena/respond', {
    headers: { cookie: 'streamweaver-spmt-token=cookie-issued-by-spmt' },
  });
  assert.equal(readSpmtAccessToken(request), 'cookie-issued-by-spmt');
});
