import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoungeCommandMarquee,
  loungeMarqueeMoment,
  LOUNGE_MARQUEE_INTERVAL_MS,
  LOUNGE_MARQUEE_WINDOW_MS,
  LOUNGE_THANKS_MESSAGE,
} from '../src/lib/lounge-marquee';

test('the footer expands every ten minutes and alternates commands with thanks', () => {
  const commands = loungeMarqueeMoment(0);
  assert.equal(commands.expanded, true);
  assert.equal(commands.mode, 'commands');
  assert.equal(loungeMarqueeMoment(LOUNGE_MARQUEE_WINDOW_MS + 1).expanded, false);
  const thanks = loungeMarqueeMoment(LOUNGE_MARQUEE_INTERVAL_MS);
  assert.equal(thanks.expanded, true);
  assert.equal(thanks.mode, 'thanks');
  assert.equal(loungeMarqueeMoment(LOUNGE_MARQUEE_INTERVAL_MS * 2).mode, 'commands');
});

test('the command pass contains always-on, media, and only supplied active games', () => {
  const text = buildLoungeCommandMarquee([{ id: 'pixelbattle', name: 'Mosaic', command: 'mosaic', playerCommands: [
    { trigger: '!mosaic owl' },
    { trigger: 'spmt D12Y' },
  ] }]);
  assert.match(text, /ALWAYS AVAILABLE/);
  assert.match(text, /!commands/);
  assert.match(text, /!checkin/);
  assert.match(text, /HEARMEOUT MEDIA/);
  assert.match(text, /!sr <song or URL>/);
  assert.match(text, /MOSAIC/);
  assert.match(text, /spmt D12Y/);
  assert.doesNotMatch(text, /TREASURE/);
});

test('the thank-you pass includes partners, services, and viewers', () => {
  assert.match(LOUNGE_THANKS_MESSAGE, /Twitch/);
  assert.match(LOUNGE_THANKS_MESSAGE, /OpenAI/);
  assert.match(LOUNGE_THANKS_MESSAGE, /partner communities/);
  assert.match(LOUNGE_THANKS_MESSAGE, /viewers like you/);
});
