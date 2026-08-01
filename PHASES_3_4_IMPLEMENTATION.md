# StreamWeaver Discord Phases 3–4

## Social overlay

Browser source:

`/overlay/social`

Optional tenant filter:

`/overlay/social?tenant=<tenantId>`

The page polls `/api/overlay/social`, renders command-specific particles, supports reduced motion, and disappears after each event duration.

## DiscordStreamHub contracts

StreamWeaver now attempts these DSH service endpoints:

- `POST /api/points/tenant-balances`
- `POST /api/discord/activity/tenant-summary`
- `POST /api/leaderboard/render`

Points and activity automatically fall back to the existing single-server endpoints when the new cross-tenant routes are unavailable. The rendered `!leaderboard` command requires `/api/leaderboard/render`.

## Pokémon controls

The collection and trade embeds now emit these component IDs:

- `sw_pokemon_collection:mine`
- `sw_pokemon_deck:mine`
- `sw_pokemon_trade_cards:<tradeId>:mine`
- `sw_pokemon_trade_cards:<tradeId>:theirs`
- `sw_pokemon_trade_accept:<tradeId>`
- `sw_pokemon_trade_decline:<tradeId>`

DiscordStreamHub should route card/deck component IDs to its existing collection UI. Trade acceptance continues to use StreamWeaver's atomic swap implementation.


## Personal overlay integration

The SpaceMountain Companion now opens a second transparent, click-through browser window over the personal overlay.

Default effects URL:

`https://streamweaver-new.fly.dev/overlay/social`

The URL and enable switch are available in Companion settings. Showing, hiding, and fitting the personal overlay also manages the social-effects layer.

Cloud-side placement inside `spacemountain.live` still requires the `spacemountain-live` repository because that layout is not part of StreamWeaver.

## Completed Discord interaction helper contract

DiscordStreamHub can forward raw Discord component interactions to:

`POST /api/discord/pokemon-interaction`

Supported component IDs:

- `sw_pokemon_trade_cards:<tradeId>:mine`
- `sw_pokemon_trade_cards:<tradeId>:theirs`
- `sw_pokemon_trade_offer:<tradeId>`
- `sw_pokemon_trade_accept:<tradeId>`
- `sw_pokemon_trade_decline:<tradeId>`

The endpoint now returns ephemeral collection views, a 25-card select menu, updated trade embeds, and atomic accept/decline results.
