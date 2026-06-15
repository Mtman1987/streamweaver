# Shared Chat System

StreamWeaver has built-in awareness of Twitch's Shared Chat feature. When a streamer joins a shared chat session with other channels, the bot automatically adapts its behavior to avoid message leaking and duplication.

## How Twitch Shared Chat Works

When streamers join a shared chat session:
- All messages from all participating channels appear in every channel's chat
- Each message has IRC tags indicating its origin (`source-room-id`)
- Messages sent via IRC `client.say()` are scoped to the target channel only
- Messages sent via the Helix API can optionally be marked `for_source_only: true`

## What StreamWeaver Does

### Reading Messages (Incoming)

StreamWeaver's IRC client receives ALL messages, including mirrored ones from other channels in the shared session. Each message has tags:

- `room-id` — the channel the bot is connected to
- `source-room-id` — the channel the message actually came from

**Detection**: `isMirroredSharedMessage(tags)` returns `true` when `room-id !== source-room-id`, meaning the message came from another channel.

**Chat Mode** controls how mirrored messages are handled:

| Mode | Behavior | Toggle |
|------|----------|--------|
| `single` (default) | Ignores mirrored messages — bot only responds to messages from its own channel | `!chatmode` |
| `shared` | Processes mirrored messages like normal — bot responds to all channels | `!chatmode` |

The mode is persisted in `data/chat-mode.json` and survives restarts.

### Sending Messages (Outgoing)

When the bot needs to send a message, `sendWithSharedChatAwareness()` handles the logic:

1. **Check if channel is in shared chat** — calls `GET /helix/shared_chat/session?broadcaster_id=` (cached 60 seconds)
2. **If in shared chat** → tries the Helix API with an **App Access Token** and `for_source_only: true` so the message only appears in the originating channel, not mirrored to other participants
3. **If Helix fails** (permissions, missing `user:bot` / `channel:bot` authorization, token issues) → falls back to normal IRC `client.say()`
4. **If NOT in shared chat** → uses normal IRC `client.say()`

### Why This Matters

| Method | In Shared Chat | Visible Where |
|--------|---------------|---------------|
| IRC `client.say('#yourchannel', msg)` | Yes | Your channel only ✅ |
| Helix API `for_source_only: true` | Yes | Your channel only ✅ |
| Helix API `for_source_only: false` | Yes | ALL shared channels ⚠️ |

StreamWeaver always uses source-only sending. Your bot's messages never leak into other streamers' chats.

## Key Functions

### `shared-chat.ts`

| Function | Purpose |
|----------|---------|
| `isMirroredSharedMessage(tags)` | Returns `true` if a message came from another channel in shared chat |
| `shouldIgnoreMirrored(tags)` | Returns `true` if the message should be skipped (based on chat mode) |
| `isChannelInSharedChat(login)` | Checks Helix API if a channel is in a shared session (cached 60s) |
| `sendWithSharedChatAwareness(opts)` | Smart send — uses Helix source-only when in shared chat, IRC otherwise |
| `resolveRoomIdToLogin(roomId)` | Converts a Twitch room ID to a channel login (cached permanently) |
| `getChatMode()` / `toggleChatMode()` | Get/toggle between `single` and `shared` mode |
| `invalidateSharedChatCache(login)` | Force-clear cache for a channel (useful after EventSub events) |

### `twitch-client.ts` (message handler)

When a message arrives:
1. `shouldIgnoreMirrored(tags)` — skip if mirrored and mode is `single`
2. `isMirroredSharedMessage(tags)` — detect if mirrored
3. `resolveRoomIdToLogin(sourceRoomId)` — resolve the actual source channel
4. Pass the effective channel to the chat dispatcher

### `chat-dispatcher.ts`

The dispatcher receives the resolved channel name. It doesn't need to know about shared chat — the `twitch-client.ts` layer already handled the filtering and resolution.

## Chat Commands

| Command | Who | What |
|---------|-----|------|
| `!chatmode` | Mods/Broadcaster | Toggle between `single` (ignore mirrored) and `shared` (process all) |

## Configuration

No configuration needed. Shared chat detection is automatic. The system:
- Detects shared chat sessions via the Helix API
- Caches the result for 60 seconds
- Falls back gracefully if the API is unavailable
- Persists chat mode across restarts

## Permissions Note

For the Helix API source-only sending to work, the bot account needs:
- `user:write:chat` scope
- `user:bot` scope
- Moderator status in the channel, or the broadcaster must authorize `channel:bot`

If the bot doesn't have mod status, StreamWeaver logs a one-time suggestion:
> `Shared chat tip: /mod botname to reduce mirrored bot messages.`

This warning appears at most once per channel per 24 hours.

## Flow Diagram

```
Incoming Message
    │
    ├─ shouldIgnoreMirrored(tags)?
    │   ├─ YES (mode=single, mirrored) → SKIP
    │   └─ NO → continue
    │
    ├─ isMirroredSharedMessage(tags)?
    │   ├─ YES → resolveRoomIdToLogin() → use source channel
    │   └─ NO → use connected channel
    │
    └─ Pass to chat-dispatcher with effective channel

Outgoing Message
    │
    ├─ isChannelInSharedChat()?
    │   ├─ YES → sendViaHelixAPI(for_source_only: true)
    │   │   ├─ SUCCESS → done
    │   │   └─ FAIL → fallback to IRC client.say()
    │   └─ NO → IRC client.say()
    │
    └─ Message appears in YOUR channel only
```
