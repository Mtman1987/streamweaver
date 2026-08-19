# SpaceMountain Companion Capability and Security Contract

Status: v1 implementation contract  
Updated: 2026-07-27

## Purpose

SpaceMountain Companion is the machine-local execution boundary for capabilities
that a cloud app or Discord Activity cannot safely perform: OBS control, global
hotkeys, local audio routing, transparent overlay windows, local media storage,
FFmpeg work, and user-approved file transfer.

Cloud apps remain the source of truth for identity and portable app state.
Companion state is limited to device bindings, local files, window placement,
hardware selection, encrypted pairing credentials, and resumable local jobs.

## Trust boundaries

1. SPMT authenticates the person and grants app scopes.
2. The companion makes an outbound WSS connection to the SPMT relay. No public
   inbound listener is required.
3. Local HTTP and WebSocket services bind to `127.0.0.1` only.
4. OBS, files, microphones, speakers, hotkeys, downloads, and uploads are
   accessed only by the companion.
5. Discord Activities and browser apps receive capability-scoped APIs; they
   never receive the companion pairing secret, OBS password, filesystem paths,
   provider refresh tokens, or unrestricted command execution.

## Capability names

| Capability | Read operations | Mutating operations |
| --- | --- | --- |
| `companion.status` | health, version, connected services | restart managed service |
| `overlay.read` | scenes, widgets, popout state | none |
| `overlay.control` | same as read | show, hide, move, resize, click-through |
| `obs.read` | connection, scenes, current scene, sources | none |
| `obs.control` | same as read | set scene, source visibility, source settings |
| `audio.read` | devices, volume, mute, PTT binding | none |
| `audio.control` | same as read | volume, mute, route, PTT, TTS playback |
| `media.read` | library metadata, thumbnails, job state | none |
| `media.write` | same as read | import, transcode, download, upload |
| `rooms.control` | room/session state | join, queue, play, pause, skip |
| `tts.control` | voices and listener state | speak, stop, select voice |
| `workflow.run` | workflow metadata | run an explicitly allowed workflow |
| `diagnostics.write` | latest sanitized snapshot metadata | write a bounded rotator snapshot inside the fixed local diagnostics folder |

Capabilities are deny-by-default. `*.read` never implies a corresponding
control scope.

Implemented `workflow.run` identifiers are `test.echo`,
`audio.jingle.play`, and `song.render.request`. The latter two always require
local approval. Workflow IDs and payloads are schema-checked by SPMT and again
by the Companion. `workflow.run` does not grant a shell, arbitrary executable,
arbitrary filesystem path, or unreviewed upload.

## Command envelope

```json
{
  "schemaVersion": 1,
  "id": "command-id",
  "issuedAt": "2026-07-27T00:00:00.000Z",
  "expiresAt": "2026-07-27T00:00:30.000Z",
  "userId": "spmt-user-id",
  "deviceId": "companion-device-id",
  "source": "spacemountain|discord-activity|streamweaver|hearmeout",
  "capability": "obs.control",
  "action": "obs.scene.set",
  "payload": {},
  "requiresConfirmation": false
}
```

The relay must reject an expired command, wrong device, wrong user, missing
scope, duplicate command ID, unknown action, or payload outside the action
schema. Results use the same ID and contain only redacted error details.

## Confirmation policy

Always require local confirmation for:

- selecting a new filesystem directory;
- uploading a local file to a new destination;
- deleting a local file or clearing a library;
- changing the configured OBS server;
- installing an update or executable;
- exposing a listener beyond loopback;
- executing a workflow not already allowlisted on this device.

Scene changes, source toggles, volume, PTT, playback, and previously approved
downloads may be configured as “allow while paired”.

Current implementation note: `obs.media.play`, `audio.jingle.play`,
`song.render.request`, `media.download`, and `media.cache.prune` require local
approval. Commands waiting for approval
receive a longer bounded expiry than non-interactive commands. Rejection and
expiry are returned to SPMT as failed command results.

## Local storage

- Pairing and provider secrets: Electron `safeStorage` or OS credential store.
- Public device configuration: JSON under the Electron user-data directory.
- Local media: user-selected library directory.
- Reviewed creative jobs: bounded `workflow-jobs.json` in Electron user data.
- Portable workspace/app state: SPMT APIs, never local JSON as the authority.
- Logs: 30 daily Companion files plus 30 dated Fly snapshots in the fixed
  Companion `diagnostics` directory. Rotator, SPMT, and Companion each enforce
  bounded payloads and credential redaction; the relay keeps only the newest
  queued offline snapshot.

## Network policy

- Local UI: `http://127.0.0.1:3100`.
- Local events: loopback WS; authenticated mutation commands.
- Cloud relay: outbound `wss://` only with certificate validation.
- No self-signed local WSS requirement. Browser sources on the same machine use
  loopback HTTP/WS, while the companion uses outbound WSS for cloud commands.
- Downloads default to HTTPS and write only inside the approved media library.

## Embed authentication

SpaceMountain obtains a short-lived one-time SPMT launch code. StreamWeaver
exchanges it server-to-server using its client credential and receives scoped
access plus rotating refresh credentials. The iframe stores these only in
HttpOnly, Secure, SameSite=None, Partitioned cookies. Raw profile data sent by
`postMessage` is display context and never authorization.

## Versioning

Capability and command envelopes are versioned independently from UI releases.
Unknown schema versions must be rejected. Additive response fields are allowed;
new mutating actions require a capability-contract revision and tests.

## Implemented action map

| Action | Capability | Confirmation |
|---|---|---:|
| `companion.status` | `companion.status` | No |
| `overlay.show`, `overlay.hide`, `popout.show`, `popout.hide` | `overlay.control` | No |
| `obs.scene.set` | `obs.control` | No |
| `obs.media.play` | `obs.control` | Yes |
| `audio.mute`, `audio.volume` | `audio.control` | No |
| `media.transcode` | `media.write` | No |
| `media.cache.status` | `media.read` | No |
| `media.download` | `media.write` | Yes |
| `media.download.cancel` | `media.write` | No |
| `media.cache.prune` | `media.write` | Yes |
| `workflow.run` / `test.echo` | `workflow.run` | No |
| `workflow.run` / reviewed creative workflows | `workflow.run` | Yes |
| `diagnostics.snapshot.write` | `diagnostics.write` | No |

`diagnostics.snapshot.write` is the only cloud-triggered diagnostics write. It
cannot select a path, append an arbitrary filename, execute content, or expose
an inbound listener. SPMT derives the target tenant from the platform key,
queues the newest snapshot for at most seven days, and rate-limits delivery.

Companion media downloads are opt-in twice: local downloads must be enabled,
and the paired HearMeOut media relay must be enabled. Downloads accept HTTPS
only, write to a deterministic file inside the selected media library, resume
from a bounded `.part` file, enforce the local cache budget, and never expose a
public listener or a local filesystem path to the cloud caller. Automatic LRU
pruning affects only files tagged as Companion download-cache entries; imported
user media is never removed by cache pruning.
