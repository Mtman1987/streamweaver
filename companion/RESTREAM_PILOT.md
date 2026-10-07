# Restream free-plan pilot

The SPMT setup guide is available at https://spmt.live/stream-setup.html.

Local Studio hosting is initially enabled for `thecaptaindash` and the owner,
`mtman1987`. The existing cloud host allocation stays at two shared CPUs.

Install Companion 0.3.4, sign in to SPMT, and use **Connect installed Companion**
in the guide. This creates a new tenant-linked device with `restream.host`
permission. Choose **Use my Companion** and accept the local request. Restream
opens in a sandboxed local window using a persistent profile scoped to the SPMT
tenant. Create or sign in to a free Restream account there, connect Twitch, and
add the guide's tenant-specific Browser Source URL to a landscape scene.

Restream account verification and destination consent remain user steps.
Checklist items are self-reported progress, not proof of OAuth authorization.
No SPMT Restream OAuth application or user token exchange is configured by this
change. Restream's published Studio API is for assets, not a replacement for
the active Studio browser.

Closing the Studio window hides it to the tray without stopping the host.
Use **Stop local Restream host** after ending the broadcast. Host changes are
made between broadcasts; the guide does not automatically interrupt a live
cloud broadcast. Local hosting requires a 90-second reservation, refreshed
every 25 seconds with the tenant session and linked device credential. Cloud
controller starts are blocked while that reservation is active. Losing the
reservation destroys the local host before its lease expires. There is no
automatic cloud fallback or new machine provisioning in this pilot.

The local Restream session suppresses only its own embedded SPMT public/lounge
preview. The Browser Source rendered by Restream is unchanged. Real microphone,
camera, and screen-share tracks are retained. Microphone/camera and desktop
sharing require local user selection; on Windows, optional system audio uses
the desktop loopback capture path.

PS5-only gameplay is not yet connected. A console broadcast/DNS relay and a
free-plan-compatible playback source must be validated separately. The guide
shows this requirement instead of marking the PS5 stream ready. A PC test can
use Sony PS Remote Play and share that window with audio in local Studio.

Windows/PS5 end-to-end acceptance requires the tester's hardware: sign in,
enter Studio, add the overlay, check picture/audio on Twitch, hide Studio, and
confirm the stream continues. Automated checks do not establish third-party
login compatibility or a successful hardware broadcast.
