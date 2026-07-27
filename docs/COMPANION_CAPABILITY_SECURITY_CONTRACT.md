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

Capabilities are deny-by-default. `*.read` never implies a corresponding
control scope.

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

## Local storage

- Pairing and provider secrets: Electron `safeStorage` or OS credential store.
- Public device configuration: JSON under the Electron user-data directory.
- Local media: user-selected library directory.
- Portable workspace/app state: SPMT APIs, never local JSON as the authority.
- Logs: rotating local files with credentials, query tokens, and filesystem
  home paths redacted.

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
