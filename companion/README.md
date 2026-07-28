# SpaceMountain Companion

Current source version: `0.2.0` (research/workflow integration slice).

The Companion is the local desktop host for StreamWeaver. It lives in the
system tray, owns the local Next.js/WebSocket process, and manages windows,
OBS, local audio, media, FFmpeg jobs, reviewed creative jobs, and scoped
commands delivered from SPMT.

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

Download `SpaceMountain-Companion-Setup-<version>.exe` from the
[StreamWeaver releases page](https://github.com/Mtman1987/streamweaver/releases),
run the installer, and launch **SpaceMountain Companion** from the Start menu
or desktop shortcut.

The installer includes the local StreamWeaver runtime, so Node.js is not
required for the installed build. This first public release is not code-signed;
Windows may display an **Unknown publisher** warning.

The application uses a single-instance lock. Closing its settings window hides
it; it continues running in the tray and does not remain in the taskbar.

## Pair with SPMT

1. Sign in to SPMT and create a Companion device with only the capabilities you
   want to grant.
2. Copy the returned device ID and one-time pairing token.
3. Open **Companion Control Center > Secure relay and startup**.
4. Enter the device ID and pairing token. Leave the relay URL set to
   `wss://spmt.live/api/companion/relay`, enable the relay, and save.
5. Revoke the device from SPMT to immediately prevent new connections and
   commands.

The token is encrypted with Electron `safeStorage`. URLs, window layout,
startup choices, and other non-secret settings are stored in
`companion.json` under Electron's per-user application-data directory.

## Current capability surface

- Start and supervise `npm run start:local` without opening a console window.
- Show or hide one click-through overlay and three configurable popouts.
- Connect to local OBS WebSocket and set the current program scene.
- Mute and set volume for Companion-managed windows.
- Route managed HTML media to an explicitly configured output-device ID.
- Import files into a user-selected local media library.
- Run bounded MP4, MP3, and GIF FFmpeg presets as tracked background jobs.
- Run the harmless `test.echo` workflow across the `workflow.run` boundary.
- Require local approval for cloud-requested jingle playback and song briefs.
- Play approved library jingles through a named OBS media input.
- Persist engine-neutral song briefs, write approved renderer manifests inside
  the media library, and detect the named rendered output without exposing a shell.
- Maintain an outbound-only authenticated WSS connection to SPMT.
- Restart the managed local service after an unexpected exit.

Installer signing, auto-update, global hold-to-talk capture, friendly
audio-device enumeration, resumable downloads/uploads, destructive media
actions, and a documented licensed singing-renderer adapter remain release
gates. Tenant uploads/downloads and viewer-submitted jobs are intentionally
deferred.

The current research/workflow contract and truthful limitations are documented
in [`../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md`](../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md).
