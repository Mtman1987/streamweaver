# Tenant Bot Action Layer

## Ownership boundary

StreamWeaver owns natural-language intent routing, tenant/persona selection,
actor authorization, and completion reporting. A persona such as Athena or
Moonbeam supplies identity and voice, not a separate permission system.

Each application owns the protected adapter that invokes the same services as
its UI. Discord Stream Hubs executes DSH calendar, shoutout, and application
actions. HearMeOut executes room, persona, media-session, and Discord voice
bridge actions. StreamWeaver executes native image generation and routes the
existing command, AI, overlay, TTS, relay, and stream surfaces.

## Operational action catalog

### Existing shared reads

- Live SpaceMountain members.
- ChatTag current player, status, and leaderboard.
- SpaceMountain app catalog.
- HearMeOut now-playing and queue state.
- Shared help and the installed Discord command directory.

### Installed button-equivalent actions

| Action ID | Minimum role | Natural-language examples |
|---|---:|---|
| `dsh.shoutouts.active.read` | Member | “Read the DSH shoutout list” |
| `dsh.shoutouts.live.read` | Member | “Who’s live in DSH?” |
| `dsh.shoutouts.post` | Moderator | “Post a DSH shoutout for @creator in #shoutouts” |
| `dsh.calendar.read` | Member | “What’s on the DSH Admin Calendar?” |
| `dsh.calendar.captain.read` | Member | “Who has Captain’s Log?” |
| `dsh.calendar.captain.create` | Member | “Put me on Captain’s Log tomorrow” |
| `dsh.calendar.event.create` | Admin | “Add an Admin Calendar event titled … for …” |
| `dsh.calendar.deploy` | Admin | “Deploy the Admin Calendar to #storage” |
| `dsh.calendar.refresh` | Admin | “Refresh the deployed Admin Calendar” |
| `dsh.applications.read` | Admin | “Read the pending mod applications” |
| `dsh.applications.deploy` | Admin | “Deploy the mod, partner, and developer applications to #storage” |
| `dsh.applications.decide` | Owner | “Approve Jordan’s moderator application” |
| `hmo.rooms.read` | Member | “Which HearMeOut rooms are open?” |
| `hmo.media.state.read` | Member | “What’s playing in HearMeOut?” |
| `hmo.media.request` | Member | “Play the song … in HearMeOut” |
| `hmo.media.control` | Moderator | “Pause HearMeOut” or “clear the queue” |
| `hmo.bot.control` | Member + room manager | “Tell my bot to join my HearMeOut chat” |
| `hmo.voice.bridge.state` | Member | “What Discord VC is HearMeOut using?” |
| `hmo.voice.bridge.control` | Member + room manager | “Bridge HearMeOut to Discord VC General” |
| `sw.image.generate` | Member | “Generate an image of …” |

Writes are deterministic and role checked. AI classification is allowed only
for read actions; it cannot authorize or invent a write. Broadcasts resolve an
actual Discord channel and report success only after Discord confirms it.

### Existing StreamWeaver routes retained

- Natural-language wrappers over installed Discord commands, including points,
  profiles, watchtime, leaderboards, Pokemon, social actions, trades, and games.
- Image generation, BRB, shoutouts, bot relays, dictation, translation, and TTS
  on the surfaces where those routes are already enabled.

Destructive cleanup and deletion actions are intentionally not exposed until
the shared runtime has a confirmation exchange that cannot be bypassed by an
ambiguous transcript.

## Ingress coverage

The same tenant-aware runtime is called from Discord public chat and DMs,
Twitch, Kick, MountainView, SPMT bot commands, and HearMeOut's existing bot
proxy. Cross-tenant shared personas expose safe reads but do not transfer owner
permissions.

## Private media handoff — follow-up design

A request made outside HearMeOut must never silently enter a public/global
queue. Until a private transport is implemented, the runtime refuses that
enqueue and says that nothing was queued.

The follow-up design should compare:

1. Creating an expiring private playback room and returning a one-tap link.
2. Creating a hidden private room and sending its audio through a dedicated
   TTS/audio route.
3. Treating the available TRS windows/receivers as the playback transport so
   opening any supported TRS surface is enough to hear the requested media.

The chosen design needs tenant isolation, requester-only access, expiration,
explicit stop/close controls, delivery confirmation, and cleanup when the
listener disconnects.
