# Tenant Bot Action Layer

## Ownership boundary

StreamWeaver owns natural-language intent routing, tenant/persona selection,
actor authorization, and completion reporting. A persona such as Athena or
Moonbeam supplies identity and voice, not a separate permission system.

Each application owns the protected adapter that invokes its canonical UI
functions. Discord Stream Hubs executes DSH calendar, shoutout, and application
actions. HearMeOut executes media-session actions. StreamWeaver executes its
native commands, AI/image, overlay, TTS, relay, and stream actions.

## Operational action catalog

### Existing shared reads

- Live SpaceMountain members.
- ChatTag current player, status, and leaderboard.
- SpaceMountain app catalog.
- HearMeOut now-playing and queue state.
- Shared help and the installed Discord command directory.

### Discord Stream Hubs

- Read active or live shoutouts.
- Read the Admin Calendar or Captain's Log schedule.
- Claim a Captain's Log date.
- Create an Admin Calendar event.
- Deploy or refresh the Admin Calendar message.
- Read applications.
- Deploy the moderator and partner application embeds.

### HearMeOut

- Read the current media state.
- Request a named song, story, audiobook, or other audio in an existing room.
- Play, pause, skip, clear, mute, unmute, or set volume with the required role.

### Existing StreamWeaver routes retained

- Natural-language wrappers over installed Discord commands, including points,
  profiles, watchtime, leaderboards, Pokemon, social actions, trades, and games.
- Image generation, BRB, shoutouts, bot relays, dictation, translation, and TTS
  on the surfaces where those routes are already enabled.

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
