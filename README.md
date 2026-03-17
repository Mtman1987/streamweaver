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
