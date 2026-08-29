import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { detectDiscordNaturalCommand } from '../src/services/discord-natural-commands';

test('keeps shared read-only commands in the open command router', () => {
  assert.equal(detectDiscordNaturalCommand("Athena, who's live?"), null);
  assert.equal(detectDiscordNaturalCommand('spmt status'), null);
  assert.equal(detectDiscordNaturalCommand('show the ChatTag leaderboard'), null);
});

test('routes explicit SPMT namespace commands that are not shared lookups', () => {
  assert.equal(detectDiscordNaturalCommand('spmt points'), '!points');
  assert.equal(detectDiscordNaturalCommand('@spmt !watchtime'), '!watchtime');
  assert.equal(detectDiscordNaturalCommand('spmt pack'), '!pack');
});

test('routes natural profile, balance, activity, and command-directory requests', () => {
  assert.equal(detectDiscordNaturalCommand('Athena, what is my points balance?'), '!points');
  assert.equal(
    detectDiscordNaturalCommand('Athena, what is my points balance?', '<@111111111111111111> what is my points balance?'),
    '!points',
  );
  assert.equal(detectDiscordNaturalCommand('Athena, how long have I watched?'), '!watchtime');
  assert.equal(detectDiscordNaturalCommand('Athena show my global profile'), '!leader');
  assert.equal(detectDiscordNaturalCommand('what time is it?'), '!time');
  assert.equal(detectDiscordNaturalCommand('how long has the stream been live?'), '!uptime');
  assert.equal(detectDiscordNaturalCommand('how many followers do we have?'), '!followers');
  assert.equal(detectDiscordNaturalCommand('show all Discord commands'), '!commands');
  assert.equal(detectDiscordNaturalCommand('show moderator commands'), '!admin');
});

test('routes named native leaderboards without stealing ChatTag requests', () => {
  assert.equal(detectDiscordNaturalCommand('show the points leaderboard'), '!pleader');
  assert.equal(detectDiscordNaturalCommand('open the watchtime rankings'), '!wleader');
  assert.equal(detectDiscordNaturalCommand('show the top 10 cards'), '!cleader');
  assert.equal(detectDiscordNaturalCommand('display the badge leaderboard'), '!bleader');
  assert.equal(detectDiscordNaturalCommand('show the leaderboard'), '!leaderboard');
  assert.equal(detectDiscordNaturalCommand('show the Chat Tag leaderboard'), null);
});

test('routes natural Pokemon collection commands', () => {
  assert.equal(detectDiscordNaturalCommand('open a Pokemon pack from Scarlet and Violet'), '!pack Scarlet and Violet');
  assert.equal(detectDiscordNaturalCommand('show my card collection'), '!collection');
  assert.equal(detectDiscordNaturalCommand('show my Pokemon deck'), '!deck');
  assert.equal(detectDiscordNaturalCommand('show my Eevee'), '!eevee');
  assert.equal(detectDiscordNaturalCommand('show card Charizard ex'), '!show Charizard ex');
});

test('routes explicit social, trade, point-transfer, and game actions', () => {
  const rawSocial = '<@111111111111111111> please high five <@222222222222222222>';
  assert.equal(
    detectDiscordNaturalCommand('Athena please high five @MamaFeisty', rawSocial),
    '!highfive <@222222222222222222>',
  );
  assert.equal(detectDiscordNaturalCommand('give @MamaFeisty a shoutout'), '!so @MamaFeisty');
  assert.equal(detectDiscordNaturalCommand('start a trade with @MamaFeisty'), '!trade @MamaFeisty');
  assert.equal(detectDiscordNaturalCommand('offer card Charizard ex'), '!offer Charizard ex');
  assert.equal(detectDiscordNaturalCommand('give @MamaFeisty 1,500 points'), '!givepoints @MamaFeisty 1500');
  assert.equal(detectDiscordNaturalCommand('steal 50 points from @MamaFeisty'), '!stealpoints @MamaFeisty 50');
  assert.equal(detectDiscordNaturalCommand('flip a coin'), '!coinflip');
  assert.equal(detectDiscordNaturalCommand('roll the dice for 20'), '!roll 20');
  assert.equal(detectDiscordNaturalCommand('gamble 500'), '!gamble 500');
  assert.equal(detectDiscordNaturalCommand('double down on 250'), '!double 250');
});

test('does not turn conversation, relays, calendars, or ambiguous admin writes into native commands', () => {
  assert.equal(detectDiscordNaturalCommand('Athena, how are you today?'), null);
  assert.equal(detectDiscordNaturalCommand('Athena tell MamaFeisty I will call after stream'), null);
  assert.equal(detectDiscordNaturalCommand('Athena add an event to the admin calendar tomorrow'), null);
  assert.equal(detectDiscordNaturalCommand('turn greeting mode on'), null);
  assert.equal(detectDiscordNaturalCommand('do you think love is important?'), null);
  assert.equal(detectDiscordNaturalCommand('I love @MamaFeisty'), null);
});

test('native natural commands run before conversational AI in DMs and guild bot requests', () => {
  const route = fs.readFileSync('src/app/api/discord/chat/route.ts', 'utf8');
  const privateNatural = route.indexOf('const privateNativeCommand =');
  const firstOpenAi = route.indexOf('const openCommand = await detectOpenBotCommandWithAi', privateNatural);
  const calendar = route.indexOf('const calendarCommand = detectDiscordAdminCalendarCommand(message)');
  const publicNatural = route.indexOf('const naturalCommand = detectDiscordNaturalCommand(message, rawMessage)', calendar);
  const secondOpenAi = route.indexOf('const openCommand = await detectOpenBotCommandWithAi', publicNatural);

  assert.ok(privateNatural > 0 && firstOpenAi > privateNatural);
  assert.ok(calendar > 0 && publicNatural > calendar && secondOpenAi > publicNatural);
  assert.match(route, /dispatchNativeDiscordCommand\(naturalCommand, false, botTenantId \|\| tenantId\)/);
});
