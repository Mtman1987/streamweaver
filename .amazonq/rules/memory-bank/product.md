# StreamWeaver - Product Overview

## Purpose
StreamWeaver is a multi-tenant streaming automation platform that provides each Twitch streamer with an isolated environment for chat bots, AI features, overlays, game systems, and automation flows. It runs on Fly.io as an always-on Next.js 15 application with a custom WebSocket server.

## Value Proposition
- One-click Twitch OAuth login gives streamers a fully configured bot + dashboard
- Per-tenant data isolation ensures each streamer's config, points, and chat history are private
- Real-time overlays connect via WebSocket for OBS browser sources
- AI-powered chat bot with configurable personality and TTS providers
- Cross-stream features like Pokémon TCG shared globally

## Key Features

### AI Chat Bot
- Responds to mentions in Twitch chat with configurable personality
- Multiple AI providers: Gemini, OpenAI, EdenAI
- TTS output via Inworld, Google, or OpenAI voices

### Points & Economy
- Per-channel points with chat activity rewards
- Gamble, roll, coinflip, double-or-nothing games
- Leaderboards, point transfers, mod commands for managing balances

### Pokémon TCG
- Global card game shared across all streams
- Pack opening, collection display, trading, gym battles
- Animated overlays for all card interactions

### Overlays (OBS Browser Sources)
- TTS Player + Bot Avatar, Gamble, Pokémon pack/collection/trade/gym
- Partner Check-In, Shoutout Player, BRB Player, Leaderboard
- All connect via `wss://streamweaver-new.fly.dev:8090`

### Automation
- Custom actions and commands (JSON-based, imported from Streamer.bot)
- Polling services for chat monitoring, live status, metrics, watchtime
- EventSub integration for Twitch events (follows, subs, raids, bits)

### Integrations
- Twitch (Broadcaster + Bot accounts via OAuth)
- Discord (webhooks, bot, badge/pokemon storage)
- OBS WebSocket for scene/source control
- TikTok Live, Kick chat

## Target Users
- Twitch streamers wanting an all-in-one bot + overlay + game system
- Streamers migrating from Streamer.bot who want cloud-hosted automation
- Communities wanting cross-stream features (Pokémon TCG, shared stats)

## Live Deployment
- **App URL:** https://streamweaver-new.fly.dev
- **WebSocket:** wss://streamweaver-new.fly.dev:8090
- **Region:** iad (US East), 2 machines minimum, always-on
