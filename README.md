# StreamWeaver

StreamWeaver is a multi-tenant streaming automation platform built with Node.js and Next.js. It runs on Fly.io and provides each streamer with their own isolated environment for Twitch chat bots, AI features, overlays, game systems, and automation flows.

The supported StreamWeaver runtime is the hosted Fly.io service. Streamers and
OBS browser sources must use the hosted URL; `localhost` commands in this
repository are for developer testing only and are not the production setup.

## Live App

**URL:** https://streamweaver-new.fly.dev

## Architecture

### Cloud Runtime
- Next.js 15 app served on Fly.io (always-on)
- Custom WebSocket server for real-time dashboard and overlay updates
- Per-tenant data isolation on persistent volume (`/data/runtime/tenants/{twitchId}/`)
- Global shared data for cross-stream features like Pokemon (`/data/runtime/global/`)

### Multi-Tenant Model
- Each user logs in with Twitch OAuth → creates a tenant directory
- Tokens, config, points, chat history are isolated per tenant
- Twitch IRC clients boot per-tenant at startup
- Session cookie (`streamweaver-session`) identifies the tenant on every request

### Security
- Auth middleware protects all dashboard and API routes
- Overlay URLs are public (no auth needed for OBS browser sources)
- Session-based auth replaces the old local API key model

## Getting Started

### For Streamers

1. Go to https://streamweaver-new.fly.dev
2. Click "Sign in with Twitch"
3. Go to `/integrations` and link your Broadcaster and Bot accounts
4. The bot connects to your Twitch chat automatically
5. Configure AI personality, TTS voice, and commands from the dashboard

### What You Get
- **AI Chat Bot** — responds to mentions in your Twitch chat with configurable personality
- **TTS** — text-to-speech for bot responses (Inworld, Google, OpenAI providers)
- **Points System** — per-channel points with chat activity rewards, leaderboards
- **Pokemon TCG** — global card game shared across all streams
- **Overlays** — OBS browser sources for TTS, gamble, Pokemon, and more
- **Voice Commander** — speak commands to control your stream
- **Shared Chat Aware** — bot messages stay in your channel only (see `docs/SHARED-CHAT.md`)

## Overlay URLs

All overlays run at `https://streamweaver-new.fly.dev` and connect via WebSocket at `wss://streamweaver-new.fly.dev:8090`. Add these as Browser Sources in OBS.

| Overlay | URL | Size | Purpose |
|---------|-----|------|---------|
| TTS Player + Bot Avatar | `/tts-player` | 1920×1080 | Plays AI TTS audio, shows bot avatar |
| Partner Check-In | `/partner-checkin` | 1920×1080 | Partner check-in animations |
| Pokémon Pack Opening | `/pokemon-pack-overlay` | 1920×1080 | Animated card pack opening |
| Pokémon Collection | `/pokemon-collection-overlay` | 1920×1080 | Scrolling card collection display |
| Pokémon Trade | `/pokemon-trade-overlay` | 1920×1080 | Animated card trade between viewers |
| Gym Battle | `/gym-battle-overlay` | 1920×1080 | Real-time Pokémon gym battle |
| Gamble (Space Mountain) | `/gamble-overlay` | 1920×1080 | Gamble result animations |
| Classic Gamble | `/classic-gamble-overlay` | 1920×1080 | Classic-style gamble display |
| Dynamic Overlay | `/overlay/{type}` | 1920×1080 | Generic overlay by type |
| Leaderboard | `/overlay/leaderboard` | 400×600 | Live points leaderboard |
| Shoutout Player | `/shoutout-player` | 1920×1080 | Plays Twitch clip on shoutout |
| BRB Player | `/brb-player` | 1920×1080 | BRB screen with clip playback |
| Bot Avatar (Standalone) | `/overlay/avatar` | 300×300 | Bot avatar without TTS |

### Adding Overlays to OBS
1. Add a new **Browser Source** in OBS
2. Set URL to `https://streamweaver-new.fly.dev/{overlay-path}`
3. Set width/height as noted above (1920×1080 for most)
4. For TTS Player, click the source once to unlock browser autoplay
5. Scene and source names don't matter — only the URL matters

## Chat Commands

### Everyone
| Command | What |
|---------|------|
| `!commands` | List all commands |
| `!points` | Check your points |
| `!gamble <amount>` | Gamble points |
| `!roll <amount>` | Roll dice for points |
| `!double` | Double or nothing (after !roll) |
| `!coinflip` | Flip a coin |
| `!followage` | Check follow duration |
| `!uptime` | Stream uptime |
| `!time` | Current time (all US zones + UTC) |
| `!watchtime` | Your total watch time |
| `!stats` | Channel stats |
| `!leader` | Points leaderboard |
| `!collection` | Your Pokémon card collection |
| `!pack` | Open a Pokémon card pack |
| `!show <card>` | Show a card from your collection |
| `!gymteam <3 cards>` | Set your gym battle team |
| `!challenge` | Join gym battle queue |
| `!deck` | View your saved deck |

### Social
`!hug`, `!boop`, `!cuddle`, `!dance`, `!highfive`, `!headpat`, `!tickle`, `!love`, `!fistbump`, `!lurk`, `!unlurk`, `!hydrate`, `!stretch`

### Mods/Broadcaster
| Command | What |
|---------|------|
| `!so <user>` | Shoutout a user |
| `!setgame <game>` | Change stream game |
| `!settitle <title>` | Change stream title |
| `!addpoints @user <amount>` | Add points to user |
| `!setpoints @user <amount>` | Set user's points |
| `!addtoall <amount>` | Add points to everyone |
| `!brb` | Start BRB clip player |
| `!back` | End BRB |
| `!chatmode` | Toggle shared chat mode |
| `!clipmode` | Toggle clip source mode |
| `!greetingmode` | Toggle AI greeting mode |
| `!welcomemode` | Toggle welcome overlay/chat |
| `!admin` | List all admin commands |

## Dashboard Pages

| Page | Path | What |
|------|------|------|
| Dashboard | `/dashboard` | Main control panel, chat, metrics |
| Integrations | `/integrations` | Connect Twitch, Discord, OBS, YouTube |
| Bot Functions | `/bot-functions` | AI personality, TTS voice, avatar |
| Currency | `/currency` | Points leaderboard, manage user points |
| Gamble Settings | `/gamble-settings` | Configure gamble game |
| Commands | `/commands` | View/edit chat commands |
| Actions | `/actions` | View/edit automation actions |
| Games | `/games` | Pokemon, gym battles |
| Redeems | `/redeems` | Channel point redemption config |
| Settings | `/settings` | Advanced config (local-config sections) |
| Community | `/community` | Community list and shared content |
| Live Files | `/debug/data-files` | View live data files (points, chat, etc.) |

## WebSocket

The WebSocket server runs on port 8090 and provides real-time updates:

- **Cloud URL:** `wss://streamweaver-new.fly.dev:8090`

Events broadcast to connected clients:
- `twitch-message` — chat messages
- `twitch-status` — connection status
- `play-tts` — TTS audio playback
- `pokemon-*` — card game events
- `points-leaderboard-update` — leaderboard changes
- `welcome-overlay` — new viewer welcome
- `shared-chat-status` — shared chat detection

## Data Isolation

```
/data/runtime/
├── global/                    # Shared across all tenants
│   ├── pokemon-users/         # Pokemon card collections
│   ├── pokemon-collections/
│   ├── MasterStats/
│   └── community-bot-tokens.json
├── tenants/
│   └── {twitchId}/            # Per-tenant isolated data
│       ├── tokens/            # Twitch OAuth tokens
│       ├── config/            # Tenant-specific config
│       ├── data/              # Points, chat history, stats
│       │   └── {username}/    # User-specific data files
│       ├── actions/           # Custom actions
│       ├── commands/          # Custom commands
│       └── logs/
```

## Development

### Requirements
- Node.js 20+ (Node 24 has SWC issues — use Docker for builds)
- npm

### Developer Workstation (not production)
```bash
npm install
npm run dev
```

### Deploy to Fly.io
```bash
flyctl deploy --remote-only
```

The Dockerfile handles the build with Node 20 and applies the Next.js patch automatically.

### Environment Variables
Set these as Fly.io secrets:
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — Twitch app credentials
- `DISCORD_BOT_TOKEN` — Discord bot (shared)
- `GEMINI_API_KEY` — AI provider
- `EDENAI_API_KEY` — Alternative AI provider
- `OPENAI_API_KEY` — Alternative AI provider

Build args (in `fly.toml`):
- `NEXT_PUBLIC_TWITCH_CLIENT_ID`
- `NEXT_PUBLIC_STREAMWEAVE_WS_URL`

## Documentation

- `docs/SHARED-CHAT.md` — How shared chat detection and source-only messaging works
- [Suite production roadmap](https://github.com/Mtman1987/spmt-live/blob/main/docs/ecosystem/PRODUCTION_ROADMAP.md) — canonical backlog, including StreamWeaver tenant and app-track work
- [Research and reviewed creative workflows](docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md) — shared bot Research Mode, knowledge packs, Companion review jobs, OBS playback, and current release gates
- [SpaceMountain Companion](companion/README.md) — tray host setup, pairing, and implemented local capabilities

## License and code signing

StreamWeaver and SpaceMountain Companion are available under the [MIT License](LICENSE).
The Companion's Windows installer follows the published
[code signing policy](companion/CODE_SIGNING_POLICY.md). Free code signing is
provided by [SignPath.io](https://signpath.io/), with a certificate provided by
[SignPath Foundation](https://signpath.org/).

## Shared SpaceMountain appearance

StreamWeaver can follow the signed-in account's `WorkspaceProfileV1` appearance
while retaining its own local visual trims. Shared settings affect the app
shell, sidebar, top bar, Radix tabs, avatars, marked chat surfaces, particles,
and motion. OBS/player routes remain transparent and are not restyled by the
dashboard shell adapter. Turn off follow mode in Settings to use StreamWeaver's
app-owned fallback.
