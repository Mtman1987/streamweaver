# StreamWeaver

StreamWeaver is a local-only streaming control application built as a Node.js automation server plus a browser UI.

It runs entirely on the user’s machine and is designed for stream operators who need local integrations such as Twitch, Discord, OBS, overlays, game logic, automation flows, AI features, and file-backed state without exposing services to the LAN or requiring code edits.

## Current Architecture

### Runtime

- Node.js server orchestrated from `server.ts`
- Next.js browser UI served locally
- Local HTTP control APIs under `src/app/api/**`
- Local WebSocket server for real-time dashboard and overlay updates

### Primary Data Locations

- `config/` user-editable validated configuration
- `data/` persistent runtime data
- `logs/` runtime logs and diagnostics
- `tokens/` legacy local token and migration data
- `actions/`, `commands/`, `sb/` automation content and imported assets

### Security Model

- Services bind to `127.0.0.1` only
- Local APIs require `X-API-Key` when enabled in `config/app.json`
- Secret values are masked in config API responses after storage
- Debug routes are disabled unless explicitly enabled in config
- WebSocket privileged commands require local auth

## Features

- Browser-based dashboard and settings UI
- Twitch integration and token management
- Discord integration for channels, messages, embeds, avatars, and guild helpers
- OBS integration via OBS WebSocket
- Game/economy systems including gamble, points, and Pokemon features
- AI and automation routes for chat, shoutouts, memory, flow generation, TTS, and speech utilities
- Local overlays and real-time browser sources powered by WebSocket events

## Overlays (OBS Browser Sources)

StreamWeaver provides browser-based overlays that can be added as Browser Sources in OBS, Streamlabs, or any streaming software. All overlays run at `http://127.0.0.1:3100` and communicate via WebSocket for real-time updates.

The scene name and source name in OBS do not matter — only the URL matters.

### TTS Player + Bot Avatar

| | |
|---|---|
| URL | `http://127.0.0.1:3100/tts-player` |
| Size | 1920×1080 (full screen) |
| Purpose | Plays AI text-to-speech audio and displays the bot avatar |

- Polls for new TTS audio and plays it automatically
- Shows the bot avatar (MP4, GIF, or Lottie) in the bottom-left while speaking
- Avatar switches between idle and talking animations based on audio playback
- Avatar stays visible for 30 seconds after audio ends to avoid flickering on back-to-back TTS
- Display mode (always visible or auto-hide) is configured in Bot Functions
- **Important**: Click the overlay once after adding it to OBS to unlock browser autoplay
- Upload avatar files (idle/talking) from the Bot Functions page in the dashboard

### Partner Check-In

| | |
|---|---|
| URL | `http://127.0.0.1:3100/partner-checkin` |
| Size | 1920×1080 (full screen) |
| Purpose | Shows partner check-in animations when a viewer redeems a check-in |

- Two-phase display: pending phase shows broadcaster avatar while choosing, final phase shows the selected partner's Discord avatar
- Avatars display at 192px in the top-left corner
- Pending phase lasts 45 seconds, final phase lasts 25 seconds
- Connects via WebSocket, no API polling

### Pokémon Pack Opening

| | |
|---|---|
| URL | `http://127.0.0.1:3100/pokemon-pack-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Animated card pack opening when a viewer redeems a Pokémon pack |

- Cards display face-down with the viewer's Twitch avatar on the card backs
- Cards flip to reveal one at a time
- Rarest card is always the final big reveal
- Connects via WebSocket for real-time triggers

### Pokémon Collection

| | |
|---|---|
| URL | `http://127.0.0.1:3100/pokemon-collection-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Scrolling display of a viewer's card collection |

- Triggered by the `!collection` chat command
- Shows cards in a scrolling strip at the bottom of the screen (10 cards per row, 2 visible rows)
- Gradient fades at top and bottom edges
- Info bar shows username, card count, and Pokédex link
- Always finishes in 18 seconds regardless of collection size (more cards = faster scroll)
- Fades and viewport only render during the animation — fully transparent when idle

### Pokémon Trade

| | |
|---|---|
| URL | `http://127.0.0.1:3100/pokemon-trade-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Animated card trade between two viewers |

- Cards slide in from opposite sides, flash, and swap positions
- Shows both viewers' Twitch avatars (128px with gold border)
- Connects via WebSocket

### Gym Battle

| | |
|---|---|
| URL | `http://127.0.0.1:3100/gym-battle-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Real-time Pokémon gym battle display |

- Shows challenger vs gym leader cards, HP bars, and energy
- Updates in real-time as attacks and switches happen via WebSocket

### Gamble (Space Mountain)

| | |
|---|---|
| URL | `http://127.0.0.1:3100/gamble-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Displays gamble results with win/loss animations |

### Classic Gamble

| | |
|---|---|
| URL | `http://127.0.0.1:3100/classic-gamble-overlay` |
| Size | 1920×1080 (full screen) |
| Purpose | Classic-style gamble result display |

### Dynamic Overlay

| | |
|---|---|
| URL | `http://127.0.0.1:3100/overlay/{type}` |
| Size | 1920×1080 (full screen) |
| Purpose | Generic overlay that renders based on type parameter |

- Supported types: `notification`, `gamble`, `space-mountain`, `classic-gamble`
- Polls `/api/overlay/{type}` every 500ms for data

### Leaderboard

| | |
|---|---|
| URL | `http://127.0.0.1:3100/overlay/leaderboard` |
| Size | 400×600 (top-right corner) |
| Purpose | Live points leaderboard showing top 5 viewers |

- Updates every 10 seconds
- Click to show/hide

### Shoutout Player

| | |
|---|---|
| URL | `http://127.0.0.1:3100/shoutout-player` |
| Size | 1920×1080 (full screen) |
| Purpose | Plays a Twitch clip when a shoutout is triggered |

- Receives clip URL via query parameters
- Fetches clip video from Twitch and plays it

### BRB Player

| | |
|---|---|
| URL | `http://127.0.0.1:3100/brb-player` |
| Size | 1920×1080 (full screen) |
| Purpose | Plays a Twitch clip as a BRB screen |

### Bot Avatar (Standalone)

| | |
|---|---|
| URL | `http://127.0.0.1:3100/overlay/avatar` |
| Size | 300×300 |
| Purpose | Standalone bot avatar display without TTS audio |

- Use the TTS Player overlay instead for combined avatar + audio
- This overlay is available if you need the avatar in a separate source from audio

### Adding Overlays to OBS

1. In OBS, add a new **Browser Source**.
2. Set the URL to the overlay address (e.g. `http://127.0.0.1:3100/tts-player`).
3. Set width and height as noted above (1920×1080 for most overlays).
4. For the TTS Player, click the source once after adding to unlock autoplay.
5. Scene and source names can be anything — only the URL matters.

## Requirements

- Node.js 20 or newer
- npm
- Windows is the current primary environment, though packaging scripts exist for macOS and Linux as well

## Installation

### Source Install

1. Clone or extract the repository.
2. Run `setup.bat` on Windows, or manually create `.env`, `config`, `data`, `logs`, and `tokens` if needed.
3. Install dependencies with `npm install`.

## Running the App

### Recommended local start

Run:

```powershell
npm start
```

Or on Windows:

```powershell
start-streamweaver.bat
```

By default the app starts:

- UI at `http://127.0.0.1:3100`
- WebSocket server at `ws://127.0.0.1:8090`

The browser can open automatically depending on `config/app.json`.

### Development mode

Run:

```powershell
npm run dev
```

Useful development scripts:

- `npm run dev`
- `npm run dev:next`
- `npm run dev:ws`
- `npm run build`
- `npm run typecheck`
- `npm run lint`

## Configuration

The active configuration layer lives in `config/*.json`.

### Config files

- `config/app.json`
- `config/twitch.json`
- `config/discord.json`
- `config/game.json`
- `config/economy.json`
- `config/automation.json`

### How config works

- Config files are created and validated at startup
- Legacy values are migrated from `.env` and `tokens/user-config.json` where possible
- Config updates are written atomically
- Secret values are masked when read through the browser UI

### Settings UI

Use the browser Settings page to manage local configuration.

1. Start the app.
2. Open the browser UI.
3. Unlock Settings with the API key from `config/app.json`.
4. Save changes section by section.

## Packaging and Distribution

The app supports local release staging with `pkg`.

### Package commands

- `npm run package:release`
- `npm run package:win`
- `npm run package:mac`
- `npm run package:linux`

Packaged releases are staged into `dist/` with a local-app folder layout that keeps editable files outside the binary:

```text
dist/
  StreamWeaver-win/
    config/
    data/
    logs/
    StreamWeaver.exe
    README.md
```

## Runtime Notes

### Twitch

- Twitch OAuth and token flows run locally
- Client credentials may come from `.env` or migrated local config
- Tokens remain local to the machine

### Discord

- Some Discord operations require a bot token stored locally
- Channel and UI-facing configuration can be managed from the browser UI

### OBS

- OBS control expects a locally reachable OBS WebSocket endpoint
- This is one reason StreamWeaver stays local-first

## Troubleshooting

### Ports already in use

- Check whether another process is already using `3100` or `8090`
- Use `stop-streamweaver.bat` before restarting on Windows

### Invalid local API key

- Open `config/app.json`
- Confirm `security.apiKey`
- Re-enter it in the Settings UI

### Twitch or Discord failures

- Confirm required credentials are present in local config or `.env`
- Confirm OAuth redirects and bot membership are correct

### Build issues

- Run `npm run typecheck`
- Run `npm run lint`
- Rebuild with `npm run build`

## Development Notes

### Main code areas

- `server.ts` unified local runtime bootstrap
- `src/app/(app)` browser UI
- `src/app/api` authenticated local APIs
- `src/server` custom HTTP and WebSocket server code
- `src/lib/local-config` validated config layer
- `scripts/` local packaging and maintenance scripts

### Modernization status

The codebase has been modernized around:

- local config instead of ad hoc setup docs
- validated request parsing
- standardized API response envelopes
- loopback-only local auth for control surfaces
- removal of dead Electron packaging and obsolete helper docs

## Contributing

1. Keep changes local-first and loopback-only.
2. Prefer validated config and typed request schemas.
3. Do not introduce LAN-facing services or plain-text secret responses.
4. Run `npm run typecheck` and `npm run lint` before shipping changes.
