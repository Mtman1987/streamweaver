# TODO: Kick SPMT Cross-Channel Broadcasts

## Current State
- SPMT commands work for users who have StreamWeaver (their Kick channel is connected via Pusher)
- The global bot token (`streamweaverbot`) can send to ANY Kick channel using `broadcaster_user_id`
- TwinCitiesKing (broadcaster_user_id: 3147236) confirmed working

## What Needs to Change
The `/api/kick/chat-tag-broadcast` endpoint currently only sends to channels that have an active Kick connection in StreamWeaver. For users without StreamWeaver (like TwinCitiesKing), we need to:

1. **Update chat-tag's broadcast route** to pass channel slugs (not just channel names from connected instances)
2. **Update StreamWeaver's `/api/kick/chat-tag-broadcast`** to:
   - Accept a list of Kick slugs
   - Resolve each slug to `broadcaster_user_id` via `GET /public/v1/channels?slug=<name>`
   - Send directly using the global bot token + `type: 'user'` + resolved `broadcaster_user_id`
   - Cache the slug→broadcaster_user_id mapping to avoid repeated API calls
3. **Update chat-tag's bot.js** `broadcastToPlayers` to include Kick slugs from players who have `kickUsername` set

## Also TODO
- Fix AI/TTS responses in Kick (AI endpoint returns 400, TTS not triggered after AI reply)
- Listen for SPMT commands in TwinCitiesKing's Kick chat (need Pusher connection without StreamWeaver tenant)

## Known Kick API Facts (see docs/KICK-INTEGRATION.md)
- `broadcaster_user_id` != `channelId` — must resolve via `/public/v1/channels?slug=<name>`
- Send with: `type: 'user'` + bot token + `broadcaster_user_id`
- `type: 'bot'` returns 500 for our bot account (Kick-side issue)
