# StreamWeaver Local Runtime

This file describes the source/local runtime. The supported desktop host is the
SpaceMountain Companion in `companion/`; it supervises this runtime, stays in
the system tray, and owns OBS, local audio/media, and approved local workflows.

## What users do

1. Download `SpaceMountain-Companion-Setup-<version>.exe` from
   [GitHub Releases](https://github.com/Mtman1987/streamweaver/releases).
2. Run the installer and launch **SpaceMountain Companion** from the Start menu
   or desktop shortcut. The first public build is not code-signed, so Windows
   may show an **Unknown publisher** warning.
3. For a source build instead, use `npm run companion:start`.
4. The app starts on `http://127.0.0.1:3100`.
5. Open the Settings page and enter the API key from `config/app.json`.

## Folder layout

The release keeps editable and persistent files outside the app code:

- `config/`
- `data/`
- `logs/`

Provider secrets used by the local runtime stay local. Companion pairing and
OBS secrets use Electron `safeStorage`; public device settings and local job
state use Electron's user-data directory.

See `companion/README.md` for pairing and current capabilities. The former
standalone executable packaging scripts remain development tools and are not a
signed production installer claim.
