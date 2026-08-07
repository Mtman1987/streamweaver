# AthenaOS Private Vertical Slice

## Goal

Run one shared AthenaOS and Local Qwen runtime across StreamWeaver, Twitch, Kick, Discord, Rotator, MountainView, private app layouts, and future SPMT apps while preserving the tenant bot model already present in StreamWeaver.

The runtime is shared. The characters are not.

- The Commander tenant can run Athena.
- Another tenant can run Scarlett, Reaper, Moonbeam, or another configured bot.
- Every tenant bot keeps its own name, aliases, personality, interests, voice, avatar, public memory, and private memory.
- Static Station canon is shared.
- Sanitized living lore and fictional backstage conversations let the bots feel present between human interactions.
- Explicit human-requested relays use real platform delivery.
- `!botshare` controls only spontaneous visible bot-to-bot chatter in real channels.

This implementation remains private and approval-gated while the coordinated branches are reviewed.

## Existing systems used

This slice extends existing StreamWeaver systems instead of creating replacement identity, memory, or transport layers:

- `bot-settings-store.ts` remains the source for each tenant bot's name, personality, aliases, interests, and voice.
- `discord-branding.ts` remains the source for tenant-aware avatar and Discord presentation.
- Discord DM channel mapping remains responsible for selecting the destination tenant.
- `athena-memory.ts` remains tenant-scoped for ordinary public/private conversation memory.
- `world-lore-store.ts` remains the source for static fictional canon and now owns a sanitized living-lore journal.
- `bot-interactions-store.ts` remains the tenant-owned cross-bot history store.
- `bot-relay.ts` remains the parser for requests such as “tell Reaper...” or “tell your sister...”.
- The existing lore/name resolver remains responsible for matching a lore character to a configured tenant.
- Existing Twitch and Discord delivery functions remain responsible for real relay delivery.
- Existing shared-chat ingestion supplies the public stream and community observations used for interest-driven lore.

## Three separate bot-to-bot lanes

The implementation deliberately separates three behaviors that must not share one toggle.

### 1. Living backstage lore — always active

Bots may accumulate interest-matched memories and short fictional backstage conversations whether or not any human is currently watching.

This lane:

- never posts by itself in Twitch or Discord;
- does not require `!botshare`;
- records `delivered=false`;
- writes only to the tenant histories of the bots involved;
- adds a sanitized summary to the global living-lore journal;
- allows the involved bots to refer to the memory naturally later.

Example:

```text
Reaper interests: jokes, horror
Athena hears: “What do you call a cosmic trout ordering room service?”
Result: a joke memory is added to Athena and Reaper's backstage histories.
```

Reaper can later say something like:

```text
Yeah, Athena left a ridiculous cosmic trout joke in my abyssal comedy ledger.
```

No real chat message had to be sent for that backstage continuity to exist.

### 2. Explicit human-requested relay — real delivery

A clear request such as:

```text
Athena, tell Reaper to let Neph know the Commander will be ready to play in 10 minutes.
```

uses the real relay lane.

The system:

1. Resolves Athena from the source tenant settings.
2. Parses Reaper as the requested target using the existing relay parser.
3. Resolves Reaper to the real configured target tenant using the existing lore/name resolver.
4. Checks whether the target streamer is live.
5. If live, sends the message through the target tenant bot into the target Twitch chat.
6. Otherwise, tries the target streamer's last active Discord channel.
7. Otherwise, tries the target tenant's configured Discord DM route.
8. Records the actual relay with `delivered=true` only after a real send succeeds.
9. Returns a truthful success or failure response to the source user.

This lane does not depend on `!botshare`, because it was requested explicitly by a human and is not a spontaneous bot conversation.

A successful live result can read naturally as:

```text
Reaper: Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.
```

### 3. Spontaneous visible bot chatter — controlled by `!botshare`

`!botshare` keeps its original anti-flood purpose.

When off:

- bot-authored mentions do not trigger other bots in real Twitch or Discord chat;
- bots do not start visible name-trigger chains;
- one bot cannot wander into another tenant's live channel and begin a back-and-forth conversation;
- backstage lore continues;
- explicit human-requested relays continue.

When on for both participating tenants:

- the existing visible cross-bot interaction path may answer bot mentions;
- the existing reply limits, delays, ignore rules, tenant routing, and loop prevention remain authoritative.

`!botshare` therefore controls real-channel chatter, not whether the bot characters have an inner life.

## Interest-driven lore ingestion

Tenant-selected `interests` are active routing tags rather than decorative profile text.

### Public stream and community monitoring

The existing shared-chat replay receives public human events from Twitch, Discord servers, Kick, and YouTube. After the durable replay write completes, an optional background filter compares the message against the cached union of configured tenant interests. The cache refreshes automatically within one minute after interest settings change.

Only public messages matching at least one configured interest enter the Local Qwen lore queue. This prevents a busy channel from feeding every chat line to the model while still capturing relevant material such as jokes, games, fishing, music, art, horror, coding, and arbitrary directly named interests.

The classifier receives:

- the source tenant bot;
- the public observation;
- configured target tenant bot names;
- each target bot's configured interests;
- any direct keyword matches already found.

It may select up to three genuinely relevant target bots and produce one concise, grounded lore memory. The approved memory is copied only to the source and selected target tenant histories.

### Tenant conversations and DMs

Public and private AthenaOS conversations can also produce backstage observations.

Raw candidates remain inside the source tenant at:

```text
/data/runtime/tenants/<tenant-id>/data/backstage-lore/queue.json
```

Unclassified private text is never written to a global queue.

For private input, the Local Qwen classifier may share only clearly harmless material such as:

- jokes and humor;
- games and hobbies;
- creative ideas;
- established fictional Station lore;
- audience-safe entertainment details.

It is explicitly forbidden from sharing credentials, addresses, identifying personal details, financial or medical information, private conflict, sexual material, confidential plans, or other sensitive content.

Only the resulting approved summary can enter participant bot histories or the shared living-lore journal.

### Failure behavior

- Public observations with a direct interest match may use a deterministic grounded fallback if Local Qwen is temporarily unavailable.
- Private observations never use that fallback; they remain tenant-scoped and are retried, then dropped if safe classification cannot be completed.
- The queue is capped, atomically written, deduplicated, and processed with tenant-specific locks.
- A failed lore enqueue never blocks ordinary Twitch, Discord, Kick, YouTube, or AthenaOS chat handling.

## Autonomous backstage scenes

When the ecosystem has been quiet for the configured interval, the living-lore scheduler may create one short fictional scene between two configured tenant bots.

The scene generator uses:

- each bot's configured personality;
- the target bot's configured interests;
- existing static relationships when available;
- the existing world-lore tone rules.

It produces one or two PG-13 sentences, records no live delivery, and rotates through eligible bots so the same pair does not monopolize the lore.

Defaults:

```text
BACKSTAGE_LORE_POLL_INTERVAL_MS = 45000
BACKSTAGE_LORE_IDLE_INTERVAL_MS = 1200000
```

The feature can be stopped operationally with:

```text
BACKSTAGE_LORE_DISABLED=true
```

The scheduler is disabled automatically during tests and production builds.

## Tenant persona boundary

For every turn, the destination tenant determines the active bot persona.

```text
Commander DM channel -> Commander tenant -> Athena persona and Athena tenant memory
FatKid DM channel    -> FatKid tenant    -> Scarlett persona and Scarlett tenant memory
```

A request-supplied display name cannot replace a configured tenant bot.

Each tenant keeps its own:

- bot name and aliases;
- personality and interests;
- TTS voice;
- avatar and Discord branding;
- public conversation memory;
- private conversation memory;
- bot-interaction/backstage history.

No bot can read another tenant's ordinary public or private conversation memory.

## Static and living world lore

Static canon continues to use `world-lore.json` and stable character IDs.

The existing Athena–Scarlett relationship is preserved and clarified as an adopted pretend sister relationship in the Station's fictional lore. Athena–Moonbeam remains a best-friend relationship.

At runtime, the packaged canonical lore is merged with an older persisted Fly-volume copy. Persisted display names and custom characters/relationships survive, while newly packaged canonical relationships and character links are added. This prevents an old mounted file from hiding current canon.

Living lore is stored separately in:

```text
/data/runtime/global/world-lore-journal.json
```

That journal contains only approved summaries and participant metadata, not raw private prompts. Prompt retrieval filters living lore by:

- participant tenant;
- participant bot name;
- configured interest tags.

Names remain mutable display labels. Existing runtime name and alias matching resolves lore characters to configured tenants, so no unknown production tenant ID is invented for Scarlett, Reaper, Moonbeam, or another bot.

## Public/private boundary

Public bot responses may use:

- that tenant's public conversation memory;
- static shared Station lore;
- living backstage lore relevant to that tenant, bot, or its interests.

Private bot responses may additionally use that same tenant's private conversation memory.

Neither path can read another tenant's ordinary conversation memory. Public prompts never receive private tenant records. A private observation enters shared lore only after the dedicated safety classifier creates an approved summary.

## Authentication boundary

There is one user-facing authentication universe: SPMT.

- SPMT issues access and refresh tokens after login.
- Apps keep those tokens in server-controlled or HttpOnly storage.
- Cross-app AthenaOS requests forward the existing SPMT access token.
- The gateway validates it through SPMT `/api/oauth/userinfo`.
- Tenant and authority are derived from the verified SPMT identity.
- Client tenant/admin claims cannot override that identity.
- Streamers never create, paste, store, rotate, or understand an Athena key, Qwen key, or shared service key.

## Private Qwen transport

Qwen remains an HTTP service reachable only through Fly private networking:

```text
http://spmt-llm-worker.internal:8080/v1
```

- No SPMT token is forwarded to Qwen or inserted into prompts.
- No Qwen authorization header is sent.
- No `LLAMA_API_KEY`, `SPMT_LLM_API_KEY`, Athena key, or generated fallback key is required.
- Production rejects a public worker URL.
- Active AthenaOS adapters fail closed when Local Qwen is unavailable.

## Action routing

The active tenant bot can choose among:

- ordinary conversation;
- registered safe read tools;
- public/private image generation;
- an explicit cross-tenant bot relay;
- a command valid for the current Twitch, Kick, or Discord surface;
- confirmation before a natural-language state-changing command.

Known bot/tenant relays are delegated from the older public transport handlers into the unified AthenaOS relay path, so a botshare-on source cannot accidentally use the old mutual-toggle gate. The existing direct-human current-channel relay fallback remains available for targets that are not configured bots.

The model cannot invent executable capabilities. Existing dispatchers remain authoritative for platform permissions, cooldowns, tenant routing, delivery, and command behavior.

## Validation requirements

The pull-request workflow must verify:

- TypeScript compilation;
- tenant persona, voice, alias, and avatar separation;
- public/private ordinary-memory isolation;
- tenant-scoped raw private lore queues;
- public stream filtering through configured interests;
- interest routing to selected participant tenants only;
- no backstage dependence on `!botshare`;
- visible bot interaction disabled when `!botshare` is off;
- autonomous idle lore creation;
- explicit relay intent while `!botshare` is off or on;
- older public transport handlers deferring known-bot relays to AthenaOS;
- live target delivery through the target tenant bot;
- truthful `delivered=true` only after an actual send;
- static sister/best-friend lore and persisted-volume merging;
- SPMT OAuth and private keyless Qwen boundaries.

## Current status

- Draft only.
- Not merged.
- Not deployed.
- Paired with the current-main Rotator draft for SPMT OAuth and private keyless Qwen transport.
