# SpaceMountain Companion

Current source version: `0.3.0`.

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

Download the signed installer from the **SpaceMountain Companion** card on
[SPMT](https://spmt.live) or [SpaceMountain](https://spacemountain.live),
run the installer, and launch **SpaceMountain Companion** from the Start menu
or desktop shortcut.

The installer includes the local StreamWeaver runtime, so Node.js is not
required for the installed build. Public downloads stay unavailable until the
release workflow verifies the installer and application Authenticode signatures,
timestamp, update metadata, blockmap, and checksum.

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

## Trusted Windows release setup

The release workflow uses Microsoft Artifact Signing through GitHub OIDC. No
certificate file, password, or Azure client secret belongs in the repository.

1. In Azure, create an Artifact Signing account, complete identity validation,
   and create a `PublicTrust` certificate profile.
2. Create an Entra application/service principal with a GitHub federated
   credential for `Mtman1987/streamweaver` and grant it **Artifact Signing
   Certificate Profile Signer** on the certificate profile.
3. Add these non-secret GitHub repository variables:
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `COMPANION_SIGNING_ENDPOINT`, `COMPANION_SIGNING_ACCOUNT`,
   `COMPANION_CERTIFICATE_PROFILE`, and `COMPANION_PUBLISHER_NAME`.
4. Push the version tag. The workflow signs during Electron packaging, verifies
   the installer and unpacked application with `Get-AuthenticodeSignature`, and
   publishes only after both signatures and timestamps are valid.

The two website download buttons resolve through
`https://spmt.live/downloads/companion/windows`. That endpoint only redirects
when the latest GitHub release contains the installer, blockmap, `latest.yml`,
checksum, and workflow-produced `companion-signature.json`.

The current research/workflow contract and truthful limitations are documented
in [`../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md`](../docs/RESEARCH_AND_CREATIVE_WORKFLOWS.md).
