# SpaceMountain Companion privacy policy

SpaceMountain Companion does not contain advertising or analytics and does not
sell personal information.

The app stores its non-secret settings locally in Electron's per-user
application-data directory. Pairing credentials are encrypted with Electron
`safeStorage`. Media remains in the local library selected by the user.
The local `diagnostics` folder contains redacted Companion logs and bounded,
sanitized Fly production snapshots delivered by the user's tenant-scoped SPMT
relay. It retains 30 daily log files and 30 dated snapshots plus the latest
snapshot shortcut. Credential-like fields and values are redacted again before
the Companion writes them.

Network connections occur only for features the user opens or enables:

- loading the SpaceMountain and StreamWeaver hosted applications;
- connecting to the user-authorized SPMT Companion relay;
- checking the project's GitHub release channel for updates; and
- sending a job to an endpoint explicitly selected or configured by the user.

OBS WebSocket and local runtime connections remain on the user's computer.
Disabling the relay prevents new Companion relay commands, and revoking the
paired device in SPMT invalidates its authorization. The app can be removed
through Windows **Installed apps**; local application data may then be deleted
from the user's Electron application-data directory.
