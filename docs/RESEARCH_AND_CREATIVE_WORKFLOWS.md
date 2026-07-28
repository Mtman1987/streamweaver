# Research and Reviewed Creative Workflows

Status: cloud contract deployed; local-device production certification pending
Updated: 2026-07-28

This document owns StreamWeaver's bot-research and Companion creative-workflow implementation details. The cross-suite execution order remains in SPMT's `docs/ecosystem/PRODUCTION_ROADMAP.md`.

## What is implemented

### Shared bot Research Mode

- An explicit phrase such as `Hey <bot name>, I have a question` opens a two-minute question window for the same tenant, platform, channel, and user.
- A question included in the same message runs immediately.
- Explicit `research`, `look up`, `search for`, and `find out about` requests also run immediately.
- Ordinary mentions and ordinary chat do not trigger retrieval.
- Curated knowledge-pack search runs without an external API key and before optional live web search.
- Live search is an optional enhancement. When an operator enables it and provides `BRAVE_SEARCH_API_KEY`, it uses strict safe search, a six-second timeout, result limits, optional domain allowlisting, and a bounded cache. A missing provider key does not disable knowledge-pack Research Mode.
- Retrieved text is labeled as untrusted evidence. The answer prompt requires uncertainty, compact citations, and no assumption that discovered media is licensed for rebroadcast.
- Tenant settings are available in Bot Functions under **Research and Knowledge**.

Professor Eevee automatically receives the `vocaloid` pack. The pack is a normal selectable pack; Research Mode is not Vocaloid-specific.

### Companion workflows

The Companion accepts only these `workflow.run` identifiers:

| Workflow | Confirmation | Current result |
|---|---:|---|
| `test.echo` | No | Returns bounded text and proves relay execution without files, OBS, audio, or processes |
| `audio.jingle.play` | Always | Plays an existing approved Companion-library file through a named OBS media input |
| `song.render.request` | Always | Persists and reviews an engine-neutral song brief, writes a bounded creative-job manifest inside the approved media library, and waits for the named output |

The Companion UI contains the local review queue, cloud-command confirmations, harmless test button, creative brief form, media library, and OBS playback controls. Review jobs persist in Electron's user-data directory. An external licensed renderer can consume the approved manifest and place the requested output in the library; the Companion recognizes that output as completion. No arbitrary shell command is exposed.

## Data and config ownership

| Value | Classification | Owner |
|---|---|---|
| Optional live-search provider credential | Secret | `BRAVE_SEARCH_API_KEY` in environment/Fly secret; not required for curated packs |
| Research enabled, selected packs, allowlist, limits, cache policy | Public runtime config | Tenant volume JSON at `config/research.json` |
| Curated built-in pack content | Versioned product content | Git-tracked `src/data/knowledge-packs/*.json` |
| Pending two-step question window | Ephemeral request state | Process memory, two-minute expiry |
| Research conversation messages | Tenant app state | Existing tenant public-chat store |
| Pairing token and OBS password | Device secret | Electron `safeStorage` |
| Window placement, output device, OBS URL/input, local library | Local device config | Electron user-data `companion.json` |
| Creative briefs and review history | Resumable local job state | Electron user-data `workflow-jobs.json` |
| Portable identity, grants, and command audit | Shared app state | SPMT database |

## Honest limitations

- A licensed singing editor is not bundled and no undocumented VOCALOID command line is assumed.
- `song.render.request` completes the reviewed queue, manifest handoff, and output-detection contract; a real renderer adapter still requires a documented, locally installed, explicitly allowlisted integration.
- No Vocaloid songs, voicebanks, character art, or copyrighted lyrics are bundled.
- Viewer-submitted jobs and tenant upload/download are deliberately not exposed.
- Global hold-to-talk capture, signed installer, automatic update, and clean-account installation remain production gates.

## Verification

Run:

```powershell
npx tsx --test tests/research-mode.test.ts
npm run typecheck
npm run companion:check
```

Production certification additionally requires the SPMT relay tests, a real paired-device test, an OBS media-input playback test, a tenant-isolation matrix, exact deployed SHA parity, and a licensed-renderer operator proof.

### Current production evidence — 2026-07-28

- The research/Companion merge `776d51299ed4d5a5556ccc68173796d26ceb41c1` and no-key default merge `d91af1723cdbee923c6a4d3a8dd2ca42ac4fee70` are deployed in StreamWeaver current-main ancestry.
- SPMT relay/SDK merge `48615d9c665a793bab58a36177a4edde6564033d` is deployed in SPMT current-main ancestry.
- SPMT exposes SDK `0.2.1`, and the versioned SDK tarball returns HTTP 200.
- Current-main StreamWeaver typecheck, the 15 focused Research Mode and SeaArt tests, the four Companion tests, and the SPMT 175-check smoke suite pass.
- `BRAVE_SEARCH_API_KEY` is intentionally unconfigured. Curated packs remain available; live internet retrieval is optional and unproven.
- Companion and OBS were not running on the operator PC during this verification, so paired-device delivery, real OBS playback, and licensed-renderer execution remain operator evidence rather than completed production claims.
- Exact current SHA is checked dynamically by comparing `origin/main` with the live health/build label; it is not frozen into this document because a documentation commit advances `main`. That comparison passed for both affected apps on 2026-07-28.
