import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('each tenant resolves its own bot identity, personality, voice, and avatar route', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-personas-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const {
      getBotVoice,
      reloadBotSettings,
    } = await import('../src/lib/bot-settings-store');
    const { buildBotAvatarUrl } = await import('../src/services/discord-branding');
    const { resolveTenantPersonaForAthena } = await import('../src/services/athena-gateway');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      AI_BOT_PERSONALITY: 'Responsible starship archive steward.',
      TTS_VOICE: 'edenai:openai:nova',
    }, 'tenant-athena');
    await writeUserConfig({
      AI_BOT_NAME: 'Scarlett',
      AI_BOT_ALIASES: 'Scar',
      AI_BOT_PERSONALITY: 'Sarcastic fisher-witch bartender.',
      TTS_VOICE: 'edenai:openai:onyx',
    }, 'tenant-scarlett');
    reloadBotSettings('tenant-athena');
    reloadBotSettings('tenant-scarlett');

    const athena = resolveTenantPersonaForAthena({ tenantId: 'tenant-athena' });
    const scarlett = resolveTenantPersonaForAthena({ tenantId: 'tenant-scarlett' });

    assert.equal(athena.botName, 'Athena');
    assert.deepEqual(athena.aliases, ['Annie', 'Athenabot87']);
    assert.match(athena.prompt, /archive steward/i);
    assert.equal(scarlett.botName, 'Scarlett');
    assert.deepEqual(scarlett.aliases, ['Scar']);
    assert.match(scarlett.prompt, /fisher-witch/i);
    assert.notEqual(athena.botName, scarlett.botName);

    assert.equal(getBotVoice('tenant-athena'), 'edenai:openai:nova');
    assert.equal(getBotVoice('tenant-scarlett'), 'edenai:openai:onyx');
    assert.notEqual(getBotVoice('tenant-athena'), getBotVoice('tenant-scarlett'));

    const athenaAvatar = buildBotAvatarUrl('tenant-athena');
    const scarlettAvatar = buildBotAvatarUrl('tenant-scarlett');
    assert.match(athenaAvatar, /tenant-athena/);
    assert.match(scarlettAvatar, /tenant-scarlett/);
    assert.notEqual(athenaAvatar, scarlettAvatar);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
