# SpaceMountain Companion

Current source version: `0.3.2`.

The Companion is an optional local helper for the cloud-hosted StreamWeaver
service. It lives in the system tray and manages hosted-app windows, OBS, local
audio, media, FFmpeg jobs, reviewed creative jobs, and scoped commands delivered
from SPMT. It is not the StreamWeaver production server.

The capability and security rules are defined in
[`../docs/COMPANION_CAPABILITY_SECURITY_CONTRACT.md`](../docs/COMPANION_CAPABILITY_SECURITY_CONTRACT.md).

## Run from source

Requirements:

- Node.js 20 or newer
- FFmpeg on `PATH` for transcode jobs
- OBS 28 or newer with OBS WebSocket enabled for scene control

Install and start:

```powershell
cd companion
npm install
npm start
```

## Install on Windows

Download the installer from the **SpaceMountain Companion** card on
[SPMT](https://spmt.live) or [SpaceMountain](https://spacemountain.live),
run the installer, and launch **SpaceMountain Companion** from the Start menu
or desktop shortcut.

Node.js is not required for the installed build. The public download is the
installer itself (`SpaceMountain-Companion-Setup.exe`), not a ZIP archive.
The release also includes a SHA-256 checksum and `latest.yml` update metadata.

The installer is currently **unsigned** because the SignPath Foundation
open-source certificate application was not approved. Windows may therefore
show an **Unknown publisher** or Microsoft Defender SmartScreen warning. The
release workflow does not claim or require an Authenticode signature.

The application uses a single-instance lock. Closing its settings window hides
it; it continues running in the tray and does not remain in the taskbar.

## Tenant-linked setup

1. Sign in to SPMT or SpaceMountain and choose **Download installer** on the
   SpaceMountain Companion card. The signed-in page creates an expiring,
   single-use tenant link while downloading the normal installer.
2. Install and launch Companion, return to the same page, and choose
   **Connect installed Companion**. Windows opens the registered
   `spmt-companion://` link in the app.
3. Companion consumes the link once, stores the relay credential with Electron
   `safeStorage`, and establishes the SPMT, SpaceMountain, and StreamWeaver
   sessions in its private browser partition. No separate StreamWeaver login is
   required.
4. Revoke the device from SPMT to immediately prevent new relay connections and
   commands. The manual device ID/token fields remain available only as a
   recovery path.

The token is encrypted with Electron `safeStorage`. URLs, window layout,
startup choices, and other non-secret settings are stored in
`companion.json` under Electron's per-user application-data directory.

## Current capability surface

- Retain source-only local runtime supervision for developer testing; normal
  users open the hosted StreamWeaver workspace.
- Open a persistent Companion-owned StreamWeaver workspace. The tenant-linked
  installer flow establishes the private Electron sessions, then SpaceMountain
  passes StreamWeaver a short-lived, single-use embed code without exposing
  session tokens to the renderer.
- Open SpaceMountain itself as a separate Companion-owned app window at the
  Crew Desk, where the user can edit personal widgets, Commlink choices, dock
  slots, visibility, opacity, and shared appearance without leaving Companion.
- Show or hide the SpaceMountain personal overlay in a genuinely transparent
  Electron window with the account's three dock slots and personal widgets.
  Fit-to-display uses the full bounds of the Windows monitor containing the
  overlay instead of restoring a fixed 1280x720 canvas.
- Register a configurable global interaction hotkey (default
  `CommandOrControl+Shift+O`). Interaction mode focuses the overlay, enables
  its controls, and stays visibly highlighted until the hotkey is pressed
  again or the on-overlay **Done** control is selected.
- Keep native window opacity at 100 percent so SpaceMountain remains the source
  of truth for widget visibility and opacity, dock collapsed state, shared
  glass opacity and blur, while Companion owns click-through and always-on-top.
- Offer Commlink Live Chat as both a SpaceMountain dock preset and a personal
  overlay widget. Its iframe uses the same single-use StreamWeaver embed bridge
  as the other authenticated Companion surfaces.
- Restore the personal overlay after Companion restarts when it was previously
  visible, plus manage three configurable popouts.
- Connect to local OBS WebSocket and set the current program scene.
- Mute and set volume for Companion-managed windows.
- Route managed HTML media to an explicitly configured output-device ID.
- Import files into a user-selected local media library.
- Run bounded MP4, MP3, and GIF FFmpeg presets as tracked background jobs.
- Run opt-in, resumable HTTPS media downloads with a bounded LRU cache and
  local approval for paired relay requests.
- Select CPU or detected NVIDIA, Intel, or AMD FFmpeg encoders, with automatic
  CPU fallback when a hardware encode fails.
- Run the harmless `test.echo` workflow across the `workflow.run` boundary.
- Require local approval for cloud-requested jingle playback and song briefs.
- Play approved library jingles through a named OBS media input.
- Persist engine-neutral song briefs, write approved renderer manifests inside
  the media library, and detect the named rendered output without exposing a shell.
- Maintain an outbound-only authenticated WSS connection to SPMT.
- Keep redacted daily Companion logs and the latest 30 sanitized production Fly
  snapshots together in the local `diagnostics` folder. The settings screen and
  tray menu can open that folder directly; snapshots use the tenant-scoped SPMT
  relay and queue while Companion is offline.
- Restart the managed local service after an unexpected exit.

Global hold-to-talk capture, friendly audio-device enumeration, resumable
downloads/uploads, destructive media actions, and a documented licensed
singing-renderer adapter remain release gates. Tenant uploads/downloads and
viewer-submitted jobs are intentionally deferred.

## Windows release workflow

The release workflow builds the NSIS installer on a GitHub-hosted Windows
runner, runs the Companion checks and packaged-runtime smoke test, generates a
SHA-256 checksum and update metadata, and publishes the fixed-name
`SpaceMountain-Companion-Setup.exe` directly as a GitHub release asset.

There is no SignPath step in the active release path. If a trusted signing
certificate becomes available later, signing can be added back without
changing the public installer filename or download endpoint.

The two website download buttons resolve through
`https://spmt.live/downloads/companion/windows`. That endpoint redirects to the
fixed-name `SpaceMountain-Companion-Setup.exe` release asset, so users download
and run the installer directly instead of extracting a ZIP.

The current research/workflow contract and truthful limitations are documented
in [`../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md`](../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md).
