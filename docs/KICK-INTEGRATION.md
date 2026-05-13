# Kick Chat Integration — Technical Reference

## CRITICAL: broadcaster_user_id vs channelId

**These are NOT the same thing in Kick's API.**

- `channelId` (stored in `kick-tokens.json` as `broadcasterChannelId`) — internal channel identifier, NOT usable for chat API
- `broadcaster_user_id` — the actual user ID of the channel owner, required for sending messages

### How to get broadcaster_user_id

```
GET https://api.kick.com/public/v1/channels?slug=mtman1987
Authorization: Bearer <token>

Response: { "data": [{ "broadcaster_user_id": 75150807, "slug": "mtman1987", ... }] }
```

The code resolves this via `getBroadcasterUserId()` in `src/services/kick.ts` and caches it per connection.

## Sending Chat Messages

### Endpoint
```
POST https://api.kick.com/public/v1/chat
Authorization: Bearer <token>
Content-Type: application/json
```

### Required Fields (from Kick OpenAPI spec)
```json
{
  "content": "message text (max 500 chars)",   // REQUIRED
  "type": "user" | "bot",                       // REQUIRED
  "broadcaster_user_id": 75150807,              // REQUIRED for type:"user", ignored for type:"bot"
  "reply_to_message_id": "uuid"                 // OPTIONAL
}
```

### What Works (proven via testing)

| Token | Type | broadcaster_user_id | Result |
|-------|------|---------------------|--------|
| Bot token (streamweaverbot) | `"user"` | ✅ correct user ID | ✅ **WORKS** — sends as streamweaverbot |
| Bot token (streamweaverbot) | `"bot"` | (none) | ❌ 500 Internal Server Error |
| Broadcaster token (mtman1987) | `"user"` | ✅ correct user ID | ✅ WORKS — sends as mtman1987 |
| Any token | `"user"` | ❌ wrong channelId | ❌ 200 but message goes nowhere |

### Key Learnings

1. **`type: "bot"` is broken** for our bot account (returns 500). Use `type: "user"` with the bot token instead — it still sends as the bot username.

2. **`broadcaster_user_id` must be the USER ID** from `/public/v1/channels?slug=<name>`, NOT the channelId stored in tokens.

3. **A 200 response with `is_sent: true` does NOT guarantee delivery** if the `broadcaster_user_id` is wrong (e.g. using channelId instead of user ID). The message silently goes to the wrong place.

4. **Token refresh** uses `https://id.kick.com/oauth/token` with `grant_type=refresh_token`.

## Token Storage

### Per-tenant: `/data/runtime/tenants/{twitchId}/tokens/kick-tokens.json`
```json
{
  "broadcasterToken": "...",
  "broadcasterRefreshToken": "...",
  "broadcasterTokenExpiry": 1778630990019,
  "broadcasterUsername": "mtman1987",
  "broadcasterChannelId": "73976286",      // ⚠️ NOT broadcaster_user_id!
  "broadcasterChatroomId": "73687374"
}
```

### Global bot: `/data/runtime/global/kick-bot-tokens.json`
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenExpiry": 1778631983000,
  "username": "streamweaverbot",
  "scopes": "user:read channel:read channel:write chat:write events:subscribe"
}
```

## Send Priority

1. **Global bot token** (`streamweaverbot`) with `type: "user"` + resolved `broadcaster_user_id`
2. **Broadcaster token** (fallback) with `type: "user"` + resolved `broadcaster_user_id`

## SPMT Commands (Chat Tag Integration)

When a Kick message starts with `spmt ` or `@spmt `, StreamWeaver forwards it to:
```
POST https://chat-tag-new.fly.dev/api/kick/command
```

Body:
```json
{
  "username": "kick_username",
  "twitchUsername": "kick_username",
  "message": "spmt live",
  "channel": "channel_name",
  "secret": "<CHAT_TAG_SECRET>"
}
```

Response: `{ "reply": "text to send back", "broadcast": "optional broadcast msg" }`

## Kick Dispatcher Flow (src/services/kick-dispatcher.ts)

1. Message received via Pusher WebSocket
2. Skip if from bot's own account
3. If starts with `spmt` → forward to chat-tag API → reply to Kick
4. If starts with `!` → handle command locally (gamble uses `'__kick_silent__'` tenantId to suppress Twitch output)
5. Otherwise → award chat points + check AI mentions

## OAuth Scopes Required

- `chat:write` — Send messages
- `user:read` — Get user info
- `channel:read` — Get channel info (resolve broadcaster_user_id)
- `events:subscribe` — EventSub webhooks

## Environment Variables

- `KICK_CLIENT_ID` — Kick app client ID
- `KICK_CLIENT_SECRET` — Kick app client secret
- `CHAT_TAG_API_BASE` — defaults to `https://chat-tag-new.fly.dev`
- `CHAT_TAG_SECRET` / `BOT_SECRET_KEY` — shared secret for chat-tag API calls
