import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPublicDiscordControlField,
  createDiscordMessageControlToken,
  verifyDiscordMessageControlToken,
} from '../src/services/private-dm-controls';

process.env.PRIVATE_DM_CONTROL_SECRET = 'test-discord-control-secret-with-enough-entropy';
process.env.APP_URL = 'https://streamweaver.example';

const channelId = '1234567890123456789';
const messageId = '9876543210987654321';
const tenantId = '94371378';

test('public Discord controls are tenant-bound and contain every DM control except Adult Mode', () => {
  const token = createDiscordMessageControlToken({
    channelId,
    messageId,
    tenantId,
    scope: 'public',
    nowSeconds: 1_000,
    ttlSeconds: 600,
  });
  assert.deepEqual(verifyDiscordMessageControlToken(token, 1_100), {
    channelId,
    messageId,
    tenantId,
    scope: 'public',
    expiresAt: 1_600,
  });

  const field = buildPublicDiscordControlField({
    channelId,
    messageId,
    tenantId,
    nowSeconds: 1_000,
  });
  assert.equal((field.value.match(/\]\(/g) || []).length, 4);
  assert.match(field.value, /\[🖼️\]/u);
  assert.match(field.value, /\[🔊\]/u);
  assert.match(field.value, /\[⚙️\]/u);
  assert.match(field.value, /\[🗑️\]/u);
  assert.doesNotMatch(field.value, /🔞/u);
  assert.match(field.value, /\/discord\/control/);
});

test('public replies keep configured GIF hidden until the public control is used', () => {
  const source = readFileSync(
    new URL('../src/services/discord-structured-replies.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /attachPublicDiscordControls/);
  assert.match(source, /gifVisible:\s*false/);
  assert.match(source, /Boolean\(effectiveInput\.isPrivate\) && effectiveInput\.gifEnabled !== false/);
});

test('public control API never exposes Adult Mode or private memory deletion', () => {
  const source = readFileSync(
    new URL('../src/app/api/discord/control/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /action === 'adult'/);
  assert.match(source, /resolvePublicDiscordMediaUrl/);
  assert.doesNotMatch(source, /deletePrivateChatAiMessage/);
  assert.doesNotMatch(source, /readPrivateChatMessages/);
  assert.doesNotMatch(source, /writePrivateChatSettings/);
});

test('public AI uses the shared EdenAI-first provider with local Qwen fallback', () => {
  const chatSource = readFileSync(
    new URL('../src/app/api/ai/chat-with-memory/route.ts', import.meta.url),
    'utf8',
  );
  const providerSource = readFileSync(
    new URL('../src/services/ai-provider.ts', import.meta.url),
    'utf8',
  );

  assert.match(chatSource, /generateAIResponse\(prompt, systemIdentity, tenantId/);
  assert.doesNotMatch(chatSource, /api\.edenai\.run\/v3\/llm\/chat\/completions/);
  const edenCall = providerSource.indexOf('await generateEdenAIFallbackResponse(');
  const qwenCall = providerSource.indexOf('await requestSpmtLocalLlm(');
  assert.ok(edenCall >= 0 && qwenCall > edenCall);
  assert.match(providerSource, /EdenAI primary failed/);
  assert.match(providerSource, /falling back to local Qwen/);
});

test('private tenant chat uses Qwen only when Adult Mode is enabled', () => {
  const source = readFileSync(
    new URL('../src/app/api/private-chat/respond/route.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('async function completePrivateTurn');
  const end = source.indexOf('async function checkAndCondensePrivateMemory');
  const completionSource = source.slice(start, end);

  assert.match(
    completionSource,
    /if \(input\.adultMode\) \{[\s\S]*await requestQwenPrivateChatCompletion\([\s\S]*provider: 'self-hosted-qwen-adult'/,
  );
  assert.match(completionSource, /adultMode: true/);
  assert.match(completionSource, /await generateEdenAIFallbackResponse\(/);
  assert.match(completionSource, /provider: 'edenai-primary'/);
  assert.match(completionSource, /local Qwen remains disabled because Adult Mode is off/);
  assert.doesNotMatch(completionSource, /falling back to local Qwen/);
  assert.match(source, /Local Qwen is only used when Adult Mode is turned on/);
  assert.match(source, /EdenAI is not used while Adult Mode is on/);
});

test('private chat can see recent public context while public chat remains blind to private stores', () => {
  const privateSource = readFileSync(
    new URL('../src/app/api/private-chat/respond/route.ts', import.meta.url),
    'utf8',
  );
  const publicSource = readFileSync(
    new URL('../src/app/api/ai/chat-with-memory/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(privateSource, /readPublicChatMessages\(12, tenantId\)/);
  assert.match(privateSource, /Recent public\/shared context available to this private conversation/);
  assert.match(privateSource, /Never expose private history back into public chat/);
  assert.doesNotMatch(publicSource, /private-chat-store/);
  assert.doesNotMatch(publicSource, /private-ltm-store/);
  assert.doesNotMatch(publicSource, /readPrivateChatMessages/);
});

test('every public control action requires the owning signed-in tenant before GIF mutation or paid TTS', () => {
  const source = readFileSync(
    new URL('../src/app/api/discord/control/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /getTenantFromRequest/);
  assert.match(source, /session\?\.tenantId === tenantId/);
  const authGateIndex = source.indexOf('if (!requireOwningTenant(request, control.tenantId))');
  const gifIndex = source.indexOf("if (action === 'gif')");
  const ttsIndex = source.indexOf('const audioDataUris = await generatePublicAudio');
  assert.ok(authGateIndex >= 0);
  assert.ok(gifIndex > authGateIndex);
  assert.ok(ttsIndex > authGateIndex);
  assert.match(source, /repeatedly trigger paid TTS synthesis/);
});
