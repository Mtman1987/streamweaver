import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionCookie, serializeSessionCookie } from '../src/lib/session-cookie';

test('StreamWeaver session rejects unsigned and tampered tenant cookies', () => {
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';
  const unsigned = JSON.stringify({ id: 'tenant-a', username: 'owner' });
  assert.equal(parseSessionCookie(unsigned), null);

  const signed = serializeSessionCookie({ id: 'tenant-a', username: 'owner' });
  assert.equal(parseSessionCookie(signed)?.id, 'tenant-a');
  const tampered = `${signed[0] === 'A' ? 'B' : 'A'}${signed.slice(1)}`;
  assert.equal(parseSessionCookie(tampered), null);
});
