# StreamWeaver - Project Structure

## Root Directory Layout

```
streamweaver-main/
├── src/                    # Application source code
├── actions/                # Streamer.bot-imported action JSON files
├── commands/               # Streamer.bot-imported command JSON files
├── config/                 # App configuration (app, twitch, discord, economy, etc.)
├── data/                   # Runtime data (points, pokemon, overlays, user stats)
├── tokens/                 # OAuth tokens, user config, webhook config
├── scripts/                # Build/dev/migration scripts
├── patches/                # patch-package patches (next+15.3.3.patch)
├── public/                 # Static assets (avatars, partners, icons)
├── docs/                   # Documentation (SHARED-CHAT.md)
├── pokemon-tcg-data-master/# Pokemon card set data (JSON)
├── MasterStats/            # Global user stats
├── server.ts               # Main entry point - unified server orchestrator
├── fly.toml                # Fly.io deployment config
├── Dockerfile              # Production build (Node 20)
└── docker-entrypoint.js    # Container startup script
```

## Source Code (`src/`)

### `src/app/` — Next.js App Router Pages
- `(app)/` — Dashboard pages (protected by auth middleware)
  - `dashboard/`, `integrations/`, `bot-functions/`, `currency/`, `gamble-settings/`
  - `commands/`, `actions/`, `games/`, `redeems/`, `settings/`, `community/`
- `api/` — REST API routes (tenant-scoped via session cookie or `?tenant=` param)
- `auth/` — Twitch OAuth callback handler
- `login/` — Public login page
- Overlay pages (public, no auth): `tts-player/`, `gamble-overlay/`, `pokemon-pack-overlay/`, etc.

### `src/components/` — React Components
- `ui/` — shadcn/ui primitives (button, dialog, tabs, toast, etc.)
- `layout/` — App shell (sidebar, header)
- `automation/` — Action/command editors
- `flow/` — Visual automation flow builder
- `logs/` — Console/log viewers
- Feature components: `unified-chat.tsx`, `bot-channel-manager.tsx`, `obs-bridge.tsx`, etc.

### `src/lib/` — Core Libraries
- `tenant.ts` — Multi-tenant filesystem operations
- `tenant-context.ts` — Request-scoped tenant resolution
- `token-utils.server.ts` — Server-side token read/write
- `local-config/` — JSON-based config system with migrations
- `actions-store.ts`, `commands-store.ts` — Action/command CRUD
- `broker.ts` — Internal event bus
- `flow-runtime.ts` — Automation flow execution engine
- `oauth.ts` — Twitch OAuth helpers
- `ws-config.ts` — WebSocket URL resolution

### `src/services/` — Backend Services
- `twitch-client.ts` — Per-tenant TMI.js IRC client management
- `twitch.ts` — Twitch API helpers (stream status, clips)
- `eventsub.ts` — Twitch EventSub webhook subscriptions
- `chat-dispatcher.ts` — Routes chat messages to correct tenant handler
- `chat-monitor.ts` — Chat activity tracking, history persistence
- `points.ts` — Points system (earn, spend, leaderboard)
- `pokemon-tcg.ts` — Pokemon card game logic
- `gym-battle.ts` — Pokemon gym battle system
- `speech.ts` / `tts-provider.ts` — Text-to-speech generation
- `ai-provider.ts` — AI response generation (Gemini, OpenAI)
- `discord.ts` — Discord bot integration
- `obs.ts` — OBS WebSocket bridge
- `polling.ts` — Unified polling service (chat, live status, metrics)
- `automation/` — Automation action execution engine
- `gamble/` — Gamble game logic

### `src/server/` — Custom Server Components
- `websocket.ts` — WebSocket server setup
- `connection-handler.ts` — New WS client initialization
- `routes.ts` — HTTP handler for WS server health/API
- `twitch.ts` — Server-side Twitch helpers
- `avatar.ts` — Bot avatar state management

### `src/plugins/` — Plugin System
- `pokemon-tcg/` — Pokemon TCG plugin
- `leaderboard-system/` — Leaderboard plugin
- `index.ts` — Plugin registry

### `src/types/` — TypeScript Type Definitions
- `actions.ts`, `flows.ts`, `flows-runtime.ts`, `game-types.ts`

### `src/hooks/` — React Hooks
- `use-action.ts`, `use-actions-data.ts`, `use-commands-data.ts`
- `use-mobile.tsx`, `use-toast.ts`

## Data Isolation Model

```
/data/runtime/
├── global/                    # Shared across all tenants
│   ├── pokemon-users/         # Pokemon card collections
│   ├── pokemon-collections/
│   └── community-bot-tokens.json
├── tenants/{twitchId}/        # Per-tenant isolated data
│   ├── tokens/                # Twitch OAuth tokens
│   ├── config/                # Tenant-specific config
│   ├── data/{username}/       # User-specific data files
│   ├── actions/               # Custom actions
│   ├── commands/              # Custom commands
│   └── logs/
```

## Architectural Patterns
- **Multi-tenant isolation**: Filesystem-based, keyed by Twitch user ID
- **Session auth**: Cookie-based (`streamweaver-session`) parsed in middleware
- **Hybrid server**: Next.js (UI/API) + custom WebSocket server on separate port
- **Service layer**: Each feature is a standalone service module with its own state
- **Polling architecture**: Unified polling service manages recurring tasks
- **Event broadcasting**: WebSocket `broadcast()` function on global scope
- **Config system**: JSON files with migration support via `local-config/service`
