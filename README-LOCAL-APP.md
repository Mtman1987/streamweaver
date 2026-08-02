# SpaceMountain Companion (Optional Local Helper)

StreamWeaver itself is cloud-hosted at
`https://streamweaver-new.fly.dev`; there is no supported local StreamWeaver
production server. The SpaceMountain Companion is an optional desktop helper
for OBS, local audio/media, approved workflows, and windows that display the
hosted apps.

## What users do

1. Download `SpaceMountain-Companion-Setup-<version>.exe` from the Companion
   card on [SPMT](https://spmt.live) or
   [SpaceMountain](https://spacemountain.live).
2. Run the installer and launch **SpaceMountain Companion** from the Start menu
   or desktop shortcut. Public download delivery is gated on a verified
   Authenticode signature and timestamp.
3. For a source build of the Companion itself, use `npm run companion:start`.
4. Pair the Companion with SPMT, then use the hosted StreamWeaver workspace.

## Folder layout

The Companion keeps its local-only files outside the hosted app code:

- `config/`
- `data/`
- `logs/`

Companion pairing and OBS secrets use Electron `safeStorage`; public device
settings and local job state use Electron's user-data directory. Hosted
StreamWeaver secrets remain in the Fly.io environment and are never copied into
Companion JSON.

See `companion/README.md` for pairing and current capabilities. The former
standalone executable packaging scripts remain development tools and are not a
signed production installer claim.
