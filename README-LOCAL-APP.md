# StreamWeaver Local Runtime

This file describes the source/local runtime. The supported desktop host is the
SpaceMountain Companion in `companion/`; it supervises this runtime, stays in
the system tray, and owns OBS, local audio/media, and approved local workflows.

## What users do

1. Download the release zip.
2. Extract it to a normal folder.
3. Run the packaged Companion on Windows, or use `npm run companion:start` for a source build.
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
