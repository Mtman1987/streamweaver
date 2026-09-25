import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('live social commands use durable no-repeat AI copy and the social overlay carries it', () => {
  const replies = read('src/services/social-command-replies.ts');
  const events = read('src/services/social-overlay-events.ts');
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const overlay = read('src/app/overlay/social/page.tsx');

  assert.match(replies, /social-reaction-history\.json/);
  assert.match(replies, /generateAIResponse/);
  assert.match(replies, /Never repeat an exact previous reaction/);
  assert.match(replies, /Use no private memory or personal facts/);
  assert.match(replies, /uniqueSocialFallback/);
  assert.doesNotMatch(replies, /chat-with-memory/);

  assert.match(events, /reaction\?: string/);
  assert.match(events, /'dance'/);
  assert.match(dispatcher, /reaction: response/);
  assert.match(overlay, /social-astronaut/);
  assert.match(overlay, /🧑‍🚀/);
  assert.match(overlay, /social-reaction/);
  assert.match(overlay, /astronaut-boop/);
  assert.match(overlay, /astronaut-bump/);
});

test('live Stella translation supports one-shot and target-aware auto translation', () => {
  const manager = read('src/services/translation-manager.ts');
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const directory = read('src/lib/lounge-command-directory.ts');
  const discord = read('src/services/discord-command-catalog.ts');

  assert.match(manager, /!t es hello \| !t hello \| !t @user en \| !t @user off/);
  assert.match(manager, /requesterUsername/);
  assert.match(manager, /canManageOthers/);
  assert.match(manager, /autoTranslateTargets/);
  assert.match(manager, /translateToLanguage\(message, targetLanguage\)/);
  assert.match(manager, /sameText\(message, result\.translatedText\)/);

  assert.match(dispatcher, /publishTranslationSubtitleEvent/);
  assert.match(dispatcher, /translated\.targetLanguage/);
  assert.match(dispatcher, /translated\.translatedText/);
  assert.match(dispatcher, /hasEffectiveDiscordModAccess/);
  assert.match(directory, /!t @user en \/ !t @user off/);
  assert.match(discord, /!t <language> <message>/);
});

test('translation subtitles are a dedicated shell-free overlay', () => {
  const events = read('src/services/translation-subtitle-events.ts');
  const route = read('src/app/api/overlay/translation/route.ts');
  const overlay = read('src/app/overlay/translation/page.tsx');

  assert.match(events, /translation-subtitle/);
  assert.match(events, /sourceText/);
  assert.match(events, /translatedText/);
  assert.match(route, /resolveOverlayTenantId/);
  assert.match(overlay, /translation-subtitle/);
  assert.match(overlay, /background:transparent/);
  assert.doesNotMatch(overlay, /workspace|sidebar|navigation/i);
});
