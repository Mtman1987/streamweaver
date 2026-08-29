import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectDiscordAdminCalendarCommand,
  formatDiscordAdminCalendarEvent,
} from '../src/services/discord-admin-calendar-command';

test('routes an explicit Athena Admin Calendar request into a validated UTC event', () => {
  const command = detectDiscordAdminCalendarCommand(
    'Athena add an event to Discord Stream Hubs admin calendar with a title that says "record help vid with mama" for 3 AM Tuesday UTC August 4th 2026',
  );

  assert.equal(command.matched, true);
  assert.deepEqual(command.event, {
    missionName: 'record help vid with mama',
    missionDescription: undefined,
    missionDate: '2026-08-04',
    missionTime: '03:00',
    missionTimeZone: 'UTC',
  });
  assert.match(formatDiscordAdminCalendarEvent(command.event!), /^Tuesday, August 4, 2026 at 3:00 AM UTC$/);
});

test('does not write when the stated weekday conflicts with the explicit date', () => {
  const command = detectDiscordAdminCalendarCommand(
    'Athena add an event to Discord Stream Hubs admin calendar with a title that says "record help vid with mama" for 3 AM Tuesday UTC August 1st 2026',
  );

  assert.equal(command.matched, true);
  assert.equal(command.event, undefined);
  assert.match(command.error || '', /August 1, 2026 is Saturday, not Tuesday/);
  assert.match(command.error || '', /did not add/i);
});

test('ordinary Athena conversation does not become a calendar write', () => {
  assert.deepEqual(detectDiscordAdminCalendarCommand('Athena, what is on the calendar?'), { matched: false });
});

test('Admin Calendar routing runs before open-command and conversational AI fallbacks', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/discord/chat/route.ts'), 'utf8');
  const calendarIndex = route.indexOf('const calendarCommand = detectDiscordAdminCalendarCommand(message)');
  const openCommandIndex = route.indexOf('const openCommand = await detectOpenBotCommandWithAi', calendarIndex);
  const aiIndex = route.indexOf("const aiRes = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`", calendarIndex);
  assert.ok(calendarIndex > 0);
  assert.ok(openCommandIndex > calendarIndex);
  assert.ok(aiIndex > calendarIndex);
  assert.match(route, /calendarAdded = true/);
  assert.match(route, /Nothing was added/);
});
