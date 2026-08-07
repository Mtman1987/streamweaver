# AthenaOS Private Vertical Slice

## Goal

Run one Athena intelligence across StreamWeaver, Twitch, Kick, Discord, Rotator, MountainView, private app layouts, and future SPMT apps.

The local Qwen worker is the primary model for both public and private Athena. The existing HTTP service remains in place. Server callers authenticate with the shared SPMT service key, which is also provisioned as the worker's `LLAMA_API_KEY`.

This implementation remains private and approval-gated while the coordinated branches are reviewed.

## One Athena, one memory system

Athena uses one tenant-scoped memory store with source metadata instead of separate personalities and unrelated histories.

Every record includes:

- public or private visibility;
- source app and surface;
- conversation ID;
- channel, message, and participant metadata when available;
- user, assistant, tool, or system role;
- creation time and optional expiry;
- tool and action metadata.

Existing StreamWeaver public chat, private chat, public LTM, private LTM, and Commander records are read as legacy memory during migration. New turns are written to the unified store. Compatibility routes continue dual-writing the old chat files so existing pages keep working.

## Non-negotiable visibility boundary

Visibility is derived from trusted server location, never from prompt text.

Public request:

- may retrieve public memory;
- cannot retrieve private memory;
- must not tell the audience that private memory exists or was excluded.

Private request:

- may retrieve public and private memory;
- can refer to source naturally, such as “earlier in Twitch chat” or “in our Discord DM”;
- still cannot bypass tool permissions or confirmation requirements.

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

Visibility: `public`

Athena keeps replies stream-friendly, retrieves public memory only, and may hand an explicit or clearly requested command to the Twitch dispatcher.

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

Visibility: `public`

Athena uses public memory and the existing Discord command/permission system.

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

Visibility: `private`

Athena can use public and private memory. Private image generation uses the separate private image router and does not change public StreamWeaver image settings.

### Private StreamWeaver layout

```json
{
  "location": {
    "app": "streamweaver",
    "surface": "app-layout",
    "layout": "private-control-room",
    "live": false,
    "replyMode": "structured",
    "capabilities": ["athena.memory.private", "streamweaver.read-tools"]
  }
}
```

Visibility: `private`

A layout can tell Athena where the user is and which capabilities are valid without putting secrets or authorization claims in the prompt.

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

Visibility: `private`

The existing Rotator UI keeps its SPMT login, but its chat POST is proxied to the same Athena gateway and memory used by StreamWeaver and Discord DMs.

## Decision pipeline

For every message Athena receives:

1. Authenticate the caller and resolve tenant/actor.
2. Derive visibility from the trusted surface.
3. Derive a stable conversation ID from tenant, surface, channel/layout, and private participant where applicable.
4. Retrieve only memory permitted for that visibility.
5. Read the location and capability envelope.
6. Decide one mode:
   - `chat` — ordinary conversation;
   - `tool` — safe structured data or image generation;
   - `command` — a valid command on the current transport;
   - `confirm` — a state-changing natural-language command awaiting confirmation.
7. Validate the selected tool or command against the current surface.
8. Execute through the owning service/dispatcher.
9. Generate a conversational response when needed.
10. Store user, tool, and assistant turns with source metadata.

## Command ownership

Athena decides intent, but does not replace platform permissions or command implementations.

- Twitch commands execute through `handleTwitchMessage`.
- Kick commands execute through `handleKickMessage`.
- Discord commands execute through `handleDiscordMessage`.
- Safe app-state reads use the existing Open Bot command providers.
- Image generation uses the existing public/private image router.

The existing dispatcher remains authoritative for permissions, cooldowns, tenant routing, output delivery, and command behavior.

## Confirmation policy

An explicit `!command` is treated as direct command syntax and goes to the dispatcher.

A natural-language request that changes state must produce a confirmation action ID before execution. Read-only tools do not require confirmation. Destructive operations remain unavailable until they have a registered, permission-checked tool implementation.

## Private rollout order

1. StreamWeaver unified gateway and memory store.
2. Public Twitch, Kick, and Discord compatibility routes.
3. Private StreamWeaver chat and Discord DM compatibility route.
4. Rotator workbench proxy.
5. Location-aware safe read tools, image generation, and transport command handoff.
6. Tests for visibility, memory isolation, conversation identity, and action decisions.
7. Review/typecheck/CI on private branches.
8. Add future SPMT apps by sending the same request envelope with an app-specific surface and capability list.

## Current constraints

- No branch in this slice should be merged or deployed until coordinated review passes.
- The local worker HTTP service is unchanged.
- Worker and caller keys must match. The shared SPMT service key is the preferred credential, with the existing Rotator key-file fallback retained.
- Public Athena must never receive private content in its model input.
- Tools that are not registered for a surface are treated as ordinary chat or rejected; Athena cannot invent executable capabilities.
