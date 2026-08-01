# StreamWeaver Discord and Overlay Handoff

## Production overlay

- `https://streamweaver-new.fly.dev/overlay/social`
- Tenant filter: `https://streamweaver-new.fly.dev/overlay/social?tenant=<tenantId>`

## Included

- Character-branded Discord embeds without Twitch author URLs.
- Categorized `!commands` directory.
- Unique AI social command styles.
- Social overlay event publication and browser-source renderer.
- Companion personal-overlay effects layer using the Fly.io URL.
- Cross-tenant points and watchtime adapters with single-tenant fallback.
- DiscordStreamHub leaderboard rendering helper and rank button.
- Pokémon collection summary and `!collections` alias.
- Stateful Pokémon trade buttons, card selector, acceptance indicators, and atomic swap.
- Discord Pokémon interaction API for DSH forwarding.

## DSH contracts still required in DiscordStreamHub

StreamWeaver expects DiscordStreamHub to expose:

- `POST /api/points/tenant-balances`
- `POST /api/discord/activity/tenant-summary`
- `POST /api/leaderboard/render`

DiscordStreamHub should forward Pokémon components to:

- `POST https://streamweaver-new.fly.dev/api/discord/pokemon-interaction`

using the shared service bearer secret.

Native DSH handlers are still needed for:

- `sw_pokemon_collection:mine`
- `sw_pokemon_deck:mine`
- `sw_dsh_rank:<serverId>`

## Deployment verification

1. Merge this repository into `main`.
2. Confirm the existing GitHub Action deploys successfully.
3. Open `/overlay/social` in a browser source.
4. Run `!hug @user` in a connected Discord channel.
5. Confirm the Discord worker and overlay route use the same Fly application and tenant.
6. Verify `DSH_SERVICE_SECRET` matches on both applications.

## Validation performed

- `node --check companion/main.cjs`
- `node --check companion/ui/renderer.js`
- `node --check companion/lib/config-store.cjs`

A full TypeScript build was not completed in this environment because dependency installation could not finish.
