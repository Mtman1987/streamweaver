# SpaceMountain Companion

Current source version: `0.3.1`.

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

Download the signed installer from the **SpaceMountain Companion** card on
[SPMT](https://spmt.live) or [SpaceMountain](https://spacemountain.live),
run the installer, and launch **SpaceMountain Companion** from the Start menu
or desktop shortcut.

Node.js is not required for the installed build. The download is the installer
itself (`SpaceMountain-Companion-Setup.exe`), not a ZIP archive. Public releases
are created only after the workflow verifies the installer Authenticode
signature, trusted timestamp, update metadata, and checksum.

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

- Retain source-only local runtime supervision for developer testing; normal
  users open the hosted StreamWeaver workspace.
- Open a persistent Companion-owned StreamWeaver workspace. SpaceMountain signs
  the user in once inside Electron, then passes StreamWeaver a short-lived,
  single-use embed code without exposing session tokens to the renderer.
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
- Run the harmless `test.echo` workflow across the `workflow.run` boundary.
- Require local approval for cloud-requested jingle playback and song briefs.
- Play approved library jingles through a named OBS media input.
- Persist engine-neutral song briefs, write approved renderer manifests inside
  the media library, and detect the named rendered output without exposing a shell.
- Maintain an outbound-only authenticated WSS connection to SPMT.
- Restart the managed local service after an unexpected exit.

Global hold-to-talk capture, friendly audio-device enumeration, resumable
downloads/uploads, destructive media actions, and a documented licensed
singing-renderer adapter remain release gates. Tenant uploads/downloads and
viewer-submitted jobs are intentionally deferred.

## Code signing policy and trusted Windows releases

Free code signing is provided by [SignPath.io](https://signpath.io/), with the
certificate provided by [SignPath Foundation](https://signpath.org/). The full
[code signing policy](CODE_SIGNING_POLICY.md),
[privacy policy](PRIVACY.md), and SignPath
[artifact configuration](signpath-artifact-configuration.xml) are kept beside
the Companion source.

The release workflow never receives a certificate or certificate password. It
builds the unsigned installer on a GitHub-hosted Windows runner, uploads that
exact build as a trusted workflow artifact, and submits its artifact ID to
SignPath. Only SignPath's returned installer can pass the workflow's
Authenticode, publisher, and timestamp checks.

After SignPath Foundation approves the open-source project:

1. Link `Mtman1987/streamweaver` to SignPath's GitHub trusted build system and
   install the SignPath GitHub App for this repository.
2. Create the project artifact configuration from
   `signpath-artifact-configuration.xml` and a release signing policy.
3. Add the `SIGNPATH_API_TOKEN` GitHub Actions secret. Add the non-secret
   repository variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
   `SIGNPATH_SIGNING_POLICY_SLUG`, and
   `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.
4. Push a `companion-v*` version tag. After the signing request is approved,
   the workflow publishes the fixed-name setup executable, SHA-256 checksum,
   signed update metadata, and signature manifest.

The two website download buttons resolve through
`https://spmt.live/downloads/companion/windows`. That endpoint redirects to the
fixed-name `SpaceMountain-Companion-Setup.exe` release asset, so users download
and run the installer directly instead of extracting a ZIP.

The current research/workflow contract and truthful limitations are documented
in [`../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md`](../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md).
