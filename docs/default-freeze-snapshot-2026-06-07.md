# Default Freeze Snapshot - 2026-06-07

## Scope

This snapshot is based on:

- local runtime data in `data/runtime/tenants/94371378`
- root `commands/`
- root `actions/`
- a production Fly.io volume inventory from `/data/runtime/tenants`

Important limitation:

- The local runtime alone was not representative.
- Production volume inspection was required to understand real tenant overlap.
- Production analysis here is intentionally summarized and avoids copying secret-bearing config files into the repo.

## Local Baseline

Observed counts:

- Commands: `71`
- Actions: `176`
- Enabled commands: `71`
- Enabled actions: `159`
- Disabled actions: `17`

Root and tenant overlap:

- Tenant commands identical to root commands: `71 / 71`
- Tenant actions identical to root actions: `176 / 176`
- Tenant-specific command divergence: `0`
- Tenant-specific action divergence: `0`

Conclusion:

- Today, the default bundle and the observed live tenant bundle are the same thing in this local snapshot.
- There is no evidence here yet of per-tenant curation or pack-style installation.

## Production Snapshot

Observed production tenant count:

- Real Fly tenants: `14`

Observed baseline overlap across production tenants:

- Universal commands present in all tenants: `71`
- Universal actions present in all tenants: `176`
- Partial commands: `18`
- Partial actions: `2`

Observed command count range by tenant:

- Commands per tenant: `71` to `78`
- Actions per tenant: `176` to `177`

Interpretation:

- The app already has a stable shared baseline.
- Tenant variation is small.
- Most tenant variation appears to be extra commands layered on top of the shared baseline, not a different module mix.

## Production Overlap Findings

Shared across all `14` tenants:

- AI configured
- Discord configured
- Economy configured
- Classic gamble configured
- Pokemon installed
- Menu mode installed
- Kick-related actions installed
- TikTok-related actions installed
- Watchtime installed
- Gamble installed
- Blerp installed
- Deathcounter installed
- Clip tooling installed

Adoption counts from redeem configuration:

- `pokePack`: `14 / 14`
- `partnerCheckin`: `5 / 14`
- `spaceMountainCheckin`: `5 / 14`
- `modCheckin`: `3 / 14`
- `crewCheckin`: `3 / 14`
- `customRewards`: `1 / 14`

Other notable overlap:

- OBS scenes are meaningfully configured for `6 / 14` tenants.

Meaning:

- Pokemon is not just broadly installed, it is universally configured.
- Space Mountain-specific check-ins are not universal and should not define the future starter experience.
- Several niche or setup-heavy systems are currently installed for everyone even when only a minority appear to configure them.
- Some universally installed families are legacy seed content, not signals that they belong in the future default bundle.

## Configured Areas

The current tenant has live configuration for these product areas:

- AI bot and TTS
- Twitch integration
- Discord integration
- Economy settings
- Classic gamble settings
- Redeem configuration

The current tenant has placeholder or mostly-empty configuration in these areas:

- OBS scene mapping
- Crew check-in configuration
- Mod check-in configuration
- Space Mountain check-in configuration
- Channel point rewards export data
- Per-user point settings overrides

Interpretation:

- AI, Twitch, economy, gambling, and redeems are clearly first-class runtime features.
- OBS is present as a platform capability, but not fully configured in this snapshot.
- Some redeem families are installed but not truly configured for active use.

Production-adjusted interpretation:

- AI, economy, gambling, Discord, Pokemon, and the broad automation bundle are part of the real shared tenant baseline today.
- OBS should remain an integration capability, but not a default assumption for every onboarding path.
- Check-ins should be treated as optional official modules rather than universal defaults.

## Baseline Feature Families

These families appear as part of the installed baseline and should be treated as current product surface:

- AI bot
- AI voice / whisper / answer flows
- Twitch utility commands
- Points and watchtime
- Classic chat gamble
- Chat social commands
- Welcome wagon
- Blerps / sound-trigger flows
- Pokemon pack / collection / trade flows
- Twitch clip flows
- Deathcounter
- Menu mode overlays
- Kick / TikTok / Discord bridge actions

Tenant-specific variance is comparatively small and is mostly in extra commands, not in different base modules.

Important correction:

- Tag Game is deprecated and has already moved to its own app.
- Its presence in the current tenant baseline is legacy carryover, not a reason to preserve it in StreamWeaver.

## Recommended Freeze Split

### Keep In Default

These should remain in the default tenant bundle because they define the app or support other systems:

- Core runtime and workflow engine
- AI bot
- AI workflow builder
- Twitch integration
- Economy and points
- Watchtime
- Classic gamble
- Core moderator utilities
  - shoutout
  - set title
  - set game
  - uptime
  - followage
  - followers
  - stats
- Commands/help surface
- Welcome mode / welcome wagon
- Small starter social pack
  - `!boop`
  - `!hug`
  - `!headpat`
  - `!lurk`
  - `!unlurk`
  - `!roll`
  - `!coinflip`
- Redeem framework itself
- Pokemon system as a built-in toggleable app capability

Why Pokemon stays default for now:

- It is structurally interconnected.
- It relies on shared supporting files.
- You indicated most tenants use it.
- Pulling it out too early would create migration risk.

Recommended treatment:

- Keep it as an official built-in module.
- Make it toggleable and eventually pack-installable only after modular packaging is proven.

### Move Toward Official Library

These are valid official packs, but they should not necessarily ship enabled for every future tenant:

- Space Mountain-specific check-ins
  - partner
  - crew
  - mod
  - Space Mountain
- Deathcounter
- Twitch clip automation pack
- Menu mode overlays
- Blerp-heavy redeem packs
- Song request pack
- Translation pack
- Champion of the Hill / fight flows

Why:

- They are more identity-specific, setup-heavy, or niche than the core bot/economy/admin stack.
- They make the default tenant feel crowded.
- Several are partially configured or duplicated rather than clean starter experiences.
- Production data confirms these are configured by only a minority of tenants.

Additional product direction:

- Tag Game should be removed from StreamWeaver classification entirely.
- Bingo and Quackverse follow the same direction as app-level experiences that live outside the StreamWeaver default surface.
- Menu Mode, Deathcounter, and Blerp-heavy packs should be treated as library targets even if they are currently seeded into most or all tenants.

### Leave Disabled Or Internal

These should not be user-facing defaults in the long-term product model:

- Duplicate actions kept only as copies
- Experimental toolkit actions
- Legacy error/helper actions that exist only as internal support pieces
- Integration stubs with incomplete setup

Recommended treatment:

- Mark them as internal/system support or archive candidates.
- Hide them from normal tenant-facing browsing.

## Product Implications

The current bundle is too broad to be a clean default onboarding experience.

Problems visible in the snapshot:

- Too many features ship at once.
- Several families are duplicated.
- Some features are installed even when not configured.
- Core and niche features are mixed together in the same surfaces.
- Tenant installs are seeded from the entire root bundle, not from a curated starter preset.

This matches the reported UX problem:

- users are seeing too much
- old and internal items leak into visible product surfaces
- defaults are not clearly separated from optional packs

Production evidence supports this:

- the current baseline is very broad
- nearly everything is installed for everyone
- actual tenant customization is happening at the edges rather than through a clean module model

## Freeze Recommendation

Freeze the platform into three layers:

1. `Base System`
   - hidden infrastructure
   - connectors
   - workflow engine
   - AI authoring layer
   - internal support actions

2. `Starter Pack`
   - AI bot
   - points
   - gamble
   - watchtime
   - core admin commands
   - welcome mode
   - small social command pack

3. `Built-in Modules`
   - Pokemon
   - check-ins
   - menu mode
   - clip tools
   - Blerp/redeem packs

Revised module intent:

- Keep Pokemon as a built-in module for now.
- Move Menu Mode, Deathcounter, clip helpers, and Blerp packs toward optional installs.
- Remove Tag Game from the StreamWeaver module map.

For migration safety:

- Existing tenants stay on the current hybrid bundle.
- New tenants should eventually install `Base System + Starter Pack` only.
- Built-in modules should become explicit enable/install choices.

Deployment strategy adjustment:

- We do not need to preserve the current command/action/subaction layout while refactoring.
- We can remove, merge, replace, and reorganize aggressively before deployment.
- The safety mechanism is a migration/backfill script that restores equivalent tenant behavior in the new system at rollout time.
- Existing tenants should experience the same outcomes after release even if the data comes from different files, modules, or storage paths.

## Next Recommended Artifact

The next useful step is a machine-readable inventory with metadata for every command and action:

- `origin`
- `freezeTier`
- `visibility`
- `module`
- `requiresSetup`
- `defaultEnabled`
- `tenantSafe`

Suggested `freezeTier` values:

- `base`
- `starter`
- `built_in_module`
- `official_library`
- `internal_only`
- `legacy_hold`

That metadata pass is the clean bridge from this snapshot to actual migration work.

## Config Policy Note

During the production and local snapshot review, tenant config files clearly include secret values in JSON-backed config files.

That does not match the workspace runtime config policy:

- secrets belong in env or Fly secrets
- public runtime config belongs in JSON

For this classification pass, the important conclusion is:

- future freeze and pack work should classify config fields before migration
- secret-bearing settings should be separated from public runtime config as part of the modernization pass
- this should be done carefully because current tenants already depend on the existing storage model
