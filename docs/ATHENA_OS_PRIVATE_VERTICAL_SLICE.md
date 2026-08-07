# AthenaOS Private Vertical Slice

## Goal

Run one shared AthenaOS and Local Qwen runtime across StreamWeaver, Twitch, Kick, Discord, Rotator, MountainView, private app layouts, and future SPMT apps without turning every tenant bot into the character Athena.

The runtime is shared. The bot personas are not.

- The Commander tenant can run Athena.
- Another tenant can run Scarlett, Reaper, Moonbeam, or another configured bot.
- Each tenant bot keeps its own name, aliases, personality, voice, avatar, public memory, and private memory.
- Static Station lore can be shared by all bots.
- Explicitly shared bot-group memories can cross only between participating tenants that both enabled the existing bot-share feature.

This implementation remains private and approval-gated while the coordinated branches are reviewed.

## Existing systems used

This slice extends existing StreamWeaver systems instead of introducing a replacement platform:

- `bot-settings-store.ts` remains the source for each tenant bot's name, personality, aliases, and voice.
- `discord-branding.ts` remains the source for tenant-aware avatar and Discord presentation.
- Discord DM channel mapping remains responsible for selecting the destination tenant.
- `athena-memory.ts` remains tenant-scoped for ordinary public/private conversation memory.
- `world-lore-store.ts` remains the global source for shared fictional lore and relationships.
- `bot-interactions-store.ts` remains the tenant-owned cross-bot history and bot-share permission store.
- `bot-relay.ts` remains the parser for requests such as “tell Reaper...” or “tell your sister...”.
- Existing Twitch, Kick, and Discord dispatchers remain authoritative for live command execution and live message delivery.

## Authentication boundary

There is one user-facing authentication universe: SPMT.

- SPMT issues access and refresh tokens after login.
- Apps keep those tokens in server-controlled or HttpOnly storage.
- Cross-app AthenaOS requests forward the SPMT access token already held by the signed-in app.
- The gateway validates the token with SPMT `/api/oauth/userinfo`.
- Tenant ID, username, display name, owner status, and admin status come from the verified SPMT identity.
- Client-provided tenant or authority claims cannot override that identity.
- Streamers never create, paste, store, rotate, or understand an Athena key, Qwen key, or shared service key.

Existing StreamWeaver-owned Twitch, Kick, and Discord transports may temporarily retain their pre-existing internal compatibility credential. That infrastructure credential is never exposed to a streamer and is not accepted as a new cross-app identity method.

## Tenant persona boundary

The gateway resolves the active persona from the destination tenant.

For every turn it uses that tenant's configured:

- bot name;
- aliases;
- personality;
- voice through the existing TTS path;
- avatar through the existing Discord branding path;
- tenant memory file;
- tenant bot-share mode.

A request-supplied display name cannot replace a configured tenant bot. AthenaOS is the runtime; Athena, Scarlett, Reaper, Moonbeam, and other bots are distinct characters using that runtime.

Example:

```text
Commander DM channel -> Commander tenant -> Athena persona and Athena tenant memory
FatKid DM channel    -> FatKid tenant    -> Scarlett persona and Scarlett tenant memory
```

No tenant receives another tenant's ordinary public or private memory.

## Shared world lore

Shared fictional lore continues to use `world-lore.json` and stable character IDs.

The existing Athena–Scarlett relationship is preserved and clarified as an adopted pretend sister relationship in the Station's fictional lore. Athena–Moonbeam is added as a best-friend relationship. These are static shared facts available to every bot persona.

Names remain mutable display labels. Tenant resolution still matches configured bot names and aliases at runtime, so no unknown production tenant ID is invented for Scarlett, Reaper, or Moonbeam.

## Shared bot-group memory

Dynamic group memory extends the existing tenant-owned bot interaction history.

A private request such as:

```text
Athena, tell Reaper that the funniest joke today involved a cosmic trout.
```

uses the existing bot-relay parser to identify Reaper and the message. It does not call the live relay delivery function. Instead:

1. Resolve the source tenant bot from its configured name and aliases.
2. Resolve the target bot through the existing lore/tenant resolver.
3. Require the existing bot-share mode to be enabled for both source and target tenants.
4. Write a `shared-memory` entry to the source tenant's bot-interaction history.
5. Write the same approved entry to the target tenant's bot-interaction history.
6. Set `delivered=false`; no Twitch, Discord, or DM message is sent.
7. Do not copy the entry to unrelated tenant histories.

When Reaper later speaks, Reaper can naturally remember the entry as something Athena shared. The model prompt also knows that no live message was physically delivered.

Turning bot sharing off blocks new cross-tenant group memories and stops that tenant's bot-group history from being loaded into the AthenaOS prompt.

## Public/private memory boundary

Ordinary tenant memory remains separate from bot-group memory.

Public request:

- may retrieve that tenant's public memory;
- may retrieve explicitly shared bot-group memory when bot sharing is enabled;
- cannot retrieve that tenant's private memory;
- cannot retrieve another tenant's ordinary memory;
- must not reveal that excluded private memory exists.

Private request:

- may retrieve that tenant's public and private memory;
- may retrieve explicitly shared bot-group memory when bot sharing is enabled;
- still cannot read another tenant's ordinary memory;
- still cannot bypass tool permissions or confirmations.

## Private Qwen transport

Qwen remains an HTTP service, but it is an internal implementation detail:

- it binds to `[::]:8080` so applications in the Fly organization can reach it over 6PN;
- its Fly configuration has no public `http_service` or public `services` section;
- callers use `http://spmt-llm-worker.internal:8080/v1`;
- production rejects a public worker URL;
- the gateway sends no SPMT token or `Authorization` header to Qwen;
- no `LLAMA_API_KEY`, `SPMT_LLM_API_KEY`, Athena key, or generated fallback key is required;
- active AthenaOS adapters fail closed when Local Qwen is unavailable.

The security boundary is SPMT OAuth at the gateway plus Fly private-network reachability for the model process.

## Location envelope examples

### Public Twitch

```json
{
  "location": {
    "app": "streamweaver",
    "surface": "twitch-chat",
    "channelName": "mtman1987",
    "live": true,
    "replyMode": "chat",
    "capabilities": ["twitch.commands", "spmt.read-tools"]
  }
}
```

The destination tenant determines which configured bot persona answers. The bot receives public tenant memory only.

### Public Discord server

```json
{
  "location": {
    "app": "streamweaver",
    "surface": "discord-channel",
    "guildId": "...",
    "channelId": "...",
    "channelName": "general",
    "live": true,
    "replyMode": "structured",
    "capabilities": ["discord.commands", "spmt.read-tools"]
  }
}
```

The bot uses the existing Discord command and permission system.

### Private Discord DM

```json
{
  "location": {
    "app": "streamweaver",
    "surface": "discord-dm",
    "channelId": "...",
    "live": false,
    "replyMode": "structured",
    "capabilities": [
      "athena.memory.public",
      "athena.memory.private",
      "image.generate.private",
      "spmt.read-tools"
    ]
  }
}
```

The DM channel mapping chooses the tenant. That tenant's bot persona, private memory, voice, avatar, and private image settings are used.

### Private Rotator workbench

```json
{
  "location": {
    "app": "fly-machine-rotator",
    "surface": "rotator-workbench",
    "layout": "athena-llm-workbench",
    "live": false,
    "replyMode": "structured",
    "capabilities": [
      "athena.memory.public",
      "athena.memory.private",
      "spmt.read-tools",
      "rotator.read-tools"
    ]
  }
}
```

Rotator forwards its existing SPMT OAuth session. StreamWeaver derives the tenant and therefore the correct configured bot persona.

## Decision pipeline

For every message:

1. Authenticate the caller and resolve the trusted tenant and actor.
2. Resolve the active tenant bot persona from existing tenant settings.
3. Derive visibility from the trusted surface.
4. Derive a stable conversation ID.
5. Retrieve only the active tenant memory allowed for that visibility.
6. Load shared world lore.
7. Load the active tenant's bot-group history only when bot sharing is enabled.
8. Decide one mode:
   - `chat` — ordinary conversation;
   - `tool` — safe structured data, image generation, or private group-memory sharing;
   - `command` — a valid command on the current transport;
   - `confirm` — a state-changing natural-language command awaiting confirmation.
9. Validate the selected tool or command against the current surface.
10. Execute through the existing owning service or dispatcher.
11. Store user, tool, and assistant turns in the active tenant's memory.

## Command and delivery ownership

AthenaOS decides intent but does not replace platform permissions or implementations.

- Twitch commands execute through `handleTwitchMessage`.
- Kick commands execute through `handleKickMessage`.
- Discord commands execute through `handleDiscordMessage`.
- Existing live cross-bot relays continue to use the current relay delivery path.
- Private group-memory sharing stores an opted-in memory and deliberately does not use live relay delivery.
- Safe app-state reads use the existing Open Bot command providers.
- Image generation uses the existing public/private image router.

## Current constraints

- No branch in this slice should be merged or deployed until coordinated review passes.
- SPMT OAuth is the only user-facing cross-app credential.
- Qwen must remain reachable only through Fly private networking.
- Public model input must never receive private tenant memory.
- Group memory requires mutual bot-share opt-in and is copied only to participant tenant histories.
- Tools not registered for a surface are treated as ordinary chat or rejected; the model cannot invent executable capabilities.
