import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('Pokemon collection show and trade commands are browser-first', () => {
  const twitch = read('src/services/chat-dispatcher.ts');
  const kick = read('src/services/kick-dispatcher.ts');
  const browser = read('src/services/pokemon-browser.ts');

  assert.match(browser, /buildPokemonBrowserUrl/);
  assert.match(twitch, /Pokédex, decks and trades/);
  assert.match(twitch, /buildPokemonBrowserUrl\(actualUsername, \{ card:/);
  assert.match(twitch, /buildPokemonBrowserUrl\(actualUsername, targetUser \? \{ tradeWith: targetUser \}/);
  assert.doesNotMatch(twitch, /type: 'pokemon-show-card'/);

  assert.match(kick, /case 'pokedex'/);
  assert.match(kick, /buildPokemonBrowserUrl\(pointsUsername, \{ card:/);
  assert.match(kick, /trade with @\$\{targetUser\} from your Pokédex/);
  assert.doesNotMatch(kick, /type: 'pokemon-show-card'/);
});

test('Pokemon trade events no longer drive stream overlays', () => {
  const trade = read('src/services/pokemon-trade-manager.ts');
  const swap = read('src/services/pokemon-swap.ts');

  assert.doesNotMatch(trade, /pokemon-trade-preview/);
  assert.doesNotMatch(trade, /pokemon-trade-execute/);
  assert.doesNotMatch(swap, /pokemon-trade-preview/);
  assert.doesNotMatch(swap, /pokemon-trade-execute/);
});

test('Pokemon browser renders live collections and supports card/trade deep links', () => {
  const route = read('src/app/api/pokedex/route.ts');
  const html = read('src/services/pokedex-html.ts');

  assert.match(route, /getUserCollection\(username\)/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(html, /const FOCUS_CARD=/);
  assert.match(html, /const TRADE_WITH=/);
  assert.match(html, /if\(TRADE_WITH&&ALL_USERS\[TRADE_WITH\]/);
  assert.match(html, /if\(FOCUS_CARD\)/);
});
