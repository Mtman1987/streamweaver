# StreamWeaver - Technology Stack

## Languages & Runtimes
- **TypeScript** 5.9.3 — Primary language (strict mode, ES2018 target)
- **Node.js** 20+ — Runtime (Node 24 has SWC issues, use Docker for builds)
- **JavaScript** — Some utility scripts and legacy files

## Frameworks
- **Next.js** 15.3.3 — App Router, React Server Components, API routes
- **React** 18.3.1 — UI framework
- **Tailwind CSS** 3.4.1 — Utility-first styling with `tailwindcss-animate`

## UI Component Library
- **shadcn/ui** — Built on Radix UI primitives
  - Accordion, Alert Dialog, Avatar, Checkbox, Collapsible, Dialog
  - Dropdown Menu, Label, Menubar, Popover, Progress, Radio Group
  - Scroll Area, Select, Separator, Slider, Slot, Switch, Tabs, Toast, Tooltip
- **Lucide React** 0.475.0 — Icon library
- **Framer Motion** 11.5.7 — Animations
- **Recharts** 2.15.1 — Charts/graphs
- **Lottie React** — Animated bot avatar

## Backend & Networking
- **ws** 8.17.0 — WebSocket server (port 8090)
- **tmi.js** 1.8.5 — Twitch IRC client
- **axios** 1.7.2 — HTTP client
- **next-auth** 4.24.13 — OAuth (Twitch provider)
- **obs-websocket-js** 5.0.7 — OBS remote control

## AI & Speech
- **@google/generative-ai** 0.24.1 — Gemini AI provider
- **@google-cloud/text-to-speech** 6.4.0 — Google TTS
- **@google-cloud/speech** 6.5.0 — Speech recognition
- **OpenAI** — Via direct API calls (key in env)
- **EdenAI** — Alternative AI/TTS provider

## Data & Storage
- **Filesystem-based** — JSON files on persistent Fly.io volume (`/data/runtime/`)
- **No database** — All state stored as JSON files per tenant
- **patch-package** 8.0.0 — Patches Next.js for custom server support

## Build & Dev Tools
- **tsx** 4.11.0 — TypeScript execution (dev server, scripts)
- **cross-env** 7.0.3 — Cross-platform env vars
- **dotenv-cli** 11.0.0 — Environment variable loading
- **concurrently** 8.2.2 — Parallel process runner
- **ESLint** 9.39.2 + eslint-config-next — Linting
- **PostCSS** 8 — CSS processing
- **patch-package** — Next.js custom server patch

## Deployment
- **Fly.io** — Cloud hosting (always-on, 2 machines minimum)
  - Region: `iad` (US East)
  - VM: shared CPU, 2 cores, 2048MB RAM
  - Persistent volume: 20GB mounted at `/data`
- **Docker** — Production builds (Node 20 base image)
- **GitHub Actions** — CI/CD (`fly-deploy.yml`, `pages.yml`)

## Key Development Commands
```bash
npm install              # Install deps + patch-package + bootstrap runtime
npm run dev              # Start unified dev server (Next.js + WS on port 8090)
npm run build            # Lint + typecheck + Next.js build
npm run build:simple     # Next.js build only (skip lint/typecheck)
npm run start            # Production start via start-local.ts
npm run start:local      # Local production mode (port 3100)
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run package:release  # Package source release
npm run package:win      # Build Windows executable
flyctl deploy --remote-only  # Deploy to Fly.io
```

## TypeScript Configuration
- Target: ES2018
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` → `./src/*`
- Incremental compilation
- JSX: preserve (handled by Next.js)

## Environment Variables
### Fly.io Secrets
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `GEMINI_API_KEY`
- `EDENAI_API_KEY`
- `OPENAI_API_KEY`

### Build Args (in fly.toml)
- `NEXT_PUBLIC_TWITCH_CLIENT_ID`
- `NEXT_PUBLIC_STREAMWEAVE_URL`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_STREAMWEAVE_WS_URL`

### Runtime
- `PERSIST_ROOT` — Data directory root (`/data/runtime` in production)
- `WS_PORT` — WebSocket port (default 8090)
- `PORT` — Next.js port (3000 prod, 3100 dev)
- `SERVER_HOST` — Bind address (0.0.0.0 prod, 127.0.0.1 dev)
- `ALLOW_DATA_FILE_IO` — Enable/disable file writes
