# StreamWeaver Multi-Tenant Cloud Migration

## Design Decisions
- **Pokemon**: GLOBAL — cards/collections shared across all streams
- **Partner Check-In**: GLOBAL — check-ins persist across streams
- **Bingo / Chat-Tag**: Separate app (DiscordStreamHub), not in scope
- **Points**: LOCAL per-tenant (global points system is future work)
- **Bot Personality/Name/Voice**: LOCAL per-tenant
- **Overlays/Avatars**: LOCAL per-tenant
- **Config**: LOCAL per-tenant

## ✅ Completed

### Infrastructure
- [x] `src/lib/tenant.ts` — tenant directory structure, bootstrap, listing, empty file seeding
- [x] `src/lib/tenant-context.ts` — extract tenantId from session cookie in API routes
- [x] `src/lib/client-tenant.ts` — extract tenantId on client side (session cookie + URL param)
- [x] `src/lib/bot-settings-store.ts` — per-tenant bot personality/name/voice/interests, loads from user-config on first access
- [x] `src/middleware.ts` — auth gate, root redirect, public path whitelist, localhost /api/ bypass
- [x] `src/components/layout/app-shell.tsx` — server component wrapper for (app) layout
- [x] `patches/next+15.3.3.patch` — Next.js generateBuildId fix
- [x] `src/lib/process-utils.ts` — readiness check hits /api/__health instead of /
- [x] `src/lib/local-config/service.ts` — validateLocalApiKeySync returns true in production, isDebugRoutesEnabled returns true in production

### Tenant-Aware API Routes (24 routes)
- [x] `/api/tokens`, `/api/config`, `/api/points`, `/api/point-settings`
- [x] `/api/bot-settings` (writes to both in-memory store AND user-config)
- [x] `/api/user-config`, `/api/user-profile`, `/api/session`
- [x] `/api/integrations/twitch/status`, `/api/integrations/twitch/disconnect`
- [x] `/api/auth/share`
- [x] `/api/twitch/live`, `/api/twitch/clips`, `/api/twitch/create-clip`
- [x] `/api/twitch/start` (calls HTTP server reconnect endpoint)
- [x] `/api/twitch/avatar`
- [x] `/api/twitch-rewards`, `/api/chat/chatters`, `/api/chat/log`, `/api/brb`
- [x] `/api/private-chat`, `/api/overlay/[type]`, `/api/avatars`
- [x] `/api/debug/data-files` (graceful missing file handling)

### Services
- [x] `points.ts` — all functions accept StorageContext
- [x] `chat-dispatcher.ts` — passes tenantCtx to awardChatPoints, reads botName/interests from per-tenant store
- [x] `twitch-client.ts` — multi-tenant IRC, tenant-scoped broadcasts
- [x] `overlay-manager.ts` — per-tenant overlay data + writeOverlayData helper
- [x] `private-chat-store.ts` — tenant-aware read/write

### Server/WebSocket
- [x] `server.ts` — broadcast(message, tenantId) filters by tenant
- [x] `server/websocket.ts` — tag connections with tenantId, identify message, per-tenant avatar/bot-settings, tenant-identified = authorized
- [x] `server/avatar.ts` — per-tenant avatar state (Map instead of singleton)
- [x] `server/routes.ts` — require() at creation time for same module instance, /api/twitch/reconnect endpoint

### Client-Side
- [x] All 10 overlay pages pass tenantId to WebSocket via URL param
- [x] Dashboard chat-client, voice-commander, avatar-control pass tenantId from session
- [x] `ws-config.ts` — getBrowserWebSocketUrl accepts tenantId
- [x] Bic counter overlay reads tenant from URL param
- [x] `requireLocalApiKey` bypass for cloud session auth (checks session cookie)

### OAuth Flow
- [x] Login → sets session cookie → redirects to /dashboard
- [x] Broadcaster/Bot OAuth → saves to tenant tokens → reconnects IRC via HTTP server
- [x] `/auth/twitch/callback` whitelisted in middleware

### Build & Deploy
- [x] Next.js generate-build-id patch via patch-package
- [x] Dockerfile copies patches/ dir, WS URL build arg
- [x] fly.toml: 8090 service without health checks, WS URL build arg
- [x] GitHub Actions deploy workflow
- [x] docs/SHARED-CHAT.md — comprehensive shared chat documentation

---

## 🔲 Remaining Work

### HIGH PRIORITY — Services Still Reading Global State

#### `walk-on-shoutout.ts`
- [ ] `(global as any).botName` → use `getBotName(tenantId)`
- [ ] `(global as any).botPersonality` → use `getBotPersonality(tenantId)`
- [ ] Reads tokens from global `tokens/twitch-tokens.json` for clip fetching
- [ ] Reads chat memory from global path
- [ ] Reads welcome wagon data from global path
- [ ] Discord shoutout channel from global config
- **Fix**: Thread tenantId through `handleWalkOnShoutout()` (called from chat-dispatcher which already has it)

#### `eventsub.ts`
- [ ] `(global as any).botName` → use `getBotName(tenantId)`
- [ ] `(global as any).botPersonality` → use `getBotPersonality(tenantId)`
- [ ] `(global as any).broadcast` calls need tenantId
- [ ] Reads tokens from global path for EventSub subscriptions
- [ ] Partner check-in and pack open handlers need tenantId for points
- **Fix**: EventSub needs to be initialized per-tenant with their broadcaster token
- **Note**: Partner check-in data should stay GLOBAL (cross-stream feature)

#### `ai-provider.ts`
- [ ] `getAIConfig()` calls `readUserConfigSync()` with no tenantId
- **Fix**: Accept tenantId parameter, pass through from chat-dispatcher

#### `tts-provider.ts`
- [ ] `getTTSConfig()` calls `readUserConfigSync()` with no tenantId
- **Fix**: Accept tenantId parameter

#### Command store `{{BOT_NAME}}` template resolution
- [ ] Command JSON files have `{{BOT_NAME}}` patterns that never resolve
- [ ] Commands-store loader needs to replace templates with actual bot name per tenant
- **Fix**: Add template resolution in `getAllCommands()` or at load time

### MEDIUM PRIORITY — Services Needing Tenant Scoping

#### `welcome-wagon.ts` / `welcome-wagon-tracker.ts` / `welcome-wagon-memory.ts`
- [ ] All read/write from global `data/` paths
- [ ] Session state (who's been welcomed) is global
- **Fix**: Thread tenantId, store welcome data per-tenant

#### `chat-monitor.ts`
- [ ] Loads chat history from global Discord channel
- [ ] Caches history globally
- **Fix**: Per-tenant chat history cache

#### `metrics.ts`
- [ ] Reads/writes from global `src/data/stream-metrics.json`
- [ ] Broadcasts metrics globally
- **Fix**: Per-tenant metrics file + tenant-scoped broadcast

#### `user-stats.ts`
- [ ] Global `statsCache` Map shared across all tenants
- [ ] Reads/writes from global `data/user-stats.json`
- **Fix**: Per-tenant stats cache and file

#### `gamble/classic-gamble.ts`
- [ ] Settings stored in global `data/gamble-settings.json`
- [ ] Overlay data written to global `data/masterstats/overlay/gamble.json`
- **Fix**: Per-tenant gamble settings and overlay data

#### `shared-chat.ts`
- [ ] `getUserToken()` reads from global `tokens/twitch-tokens.json`
- [ ] Chat mode stored in global `data/chat-mode.json`
- **Fix**: Thread tenantId for token lookup and chat mode storage

#### `brb-clips.ts`
- [ ] Clip mode stored globally
- **Fix**: Per-tenant clip mode state

#### `translation-manager.ts`
- [ ] Auto-translate user list is global
- **Fix**: Per-tenant translation settings

### LOW PRIORITY — API Routes Still Needing Tenant Context

#### Twitch API Routes
- [ ] `/api/chat/send` — needs to know which tenant's IRC client to use

#### Other Routes
- [ ] `/api/ai/chat-with-memory` — public chat store is global
- [ ] `/api/ai/shoutout` — uses global AI config
- [ ] `/api/tts` — uses global TTS config
- [ ] `/api/classic-gamble` — global gamble state
- [ ] `/api/gamble` — global gamble state
- [ ] `/api/welcome-wagon` — global welcome data
- [ ] `/api/leaderboard` — uses global user-stats

### Polling Per-Tenant
- [x] `points-sync` — iterates tenants
- [ ] `twitch-live` — should check each tenant's broadcaster
- [ ] `chat-monitor` — per-tenant history
- [ ] `watchtime-tracker` — per-tenant watchtime
- [ ] `metrics` — per-tenant metrics

### WebSocket Remaining
- [ ] Voice join/leave/mute broadcasts should be tenant-scoped
- [ ] `voice-command` handler should scope to tenant
- [ ] `discord-voice-stream` handler should scope to tenant

### UI Pages Needing Updates
- [ ] `/settings` page — uses X-API-Key header (should work now with production bypass)
- [ ] `/redeems` page — uses X-API-Key header (should work now with production bypass)
- [ ] `/community` page — Twitch embed z-index CSS issue
- [ ] `/community` page — shared actions system (global folder approach)
- [ ] Chat display in dashboard — messages show in logs but not in the chat UI panel

### Global Features (Intentionally NOT Per-Tenant)
These should stay global/shared:
- **Pokemon TCG** — cards, collections, packs, trades, gym battles
- **Partner Check-In** — check-in stats persist across streams
- **MasterStats** — shared user database
- **Discord Bot Token** — shared (one bot serves all tenants)
- **AI API Keys** — shared (Gemini, EdenAI, OpenAI from env vars)
- **TTS API Keys** — shared (Inworld, ElevenLabs from env vars)

### Future Features
- [ ] Global points system alongside local points
- [ ] Per-tenant Discord bot tokens (optional)
- [ ] Admin dashboard to see all tenants
- [ ] Rate limiting per tenant
- [ ] Upgrade Next.js when Node 24 SWC support lands
- [ ] Shared actions/commands marketplace (global folder)
- [ ] TTS audio playback toggle in live files page
- [ ] Remove duplicate message processing (bot + broadcaster both fire on same message)
