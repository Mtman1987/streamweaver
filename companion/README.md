# SpaceMountain Companion

The Companion is the local desktop host for StreamWeaver. It lives in the
system tray, owns the local Next.js/WebSocket process, and manages windows,
OBS, local audio, media, FFmpeg jobs, and scoped commands delivered from SPMT.

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
- Import files into a user-selected local media library.
- Run bounded MP4, MP3, and GIF FFmpeg presets as tracked background jobs.
- Maintain an outbound-only authenticated WSS connection to SPMT.

Installer signing, auto-update, global push-to-talk capture, OS audio-device
routing, resumable downloads/uploads, destructive media actions, and
confirmation prompts for higher-risk future commands remain release gates.
