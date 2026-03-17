# Changelog

## 0.2.0 - 2026-03-09

### Added

- Added a staged local release workflow with `package:release`, `package:win`, `package:mac`, and `package:linux`.
- Added `scripts/package-local-release.ts` to build a distributable local app folder with `config`, `data`, and `logs` directories.
- Added `README-LOCAL-APP.md` for packaged local app releases.
- Added explicit Node engine metadata requiring Node 20 or newer.

### Changed

- Repositioned the app around the active Node + browser runtime instead of the old optional Electron path.
- Updated startup to use the local launcher as the primary `npm start` entry point.
- Updated `setup.bat` to prepare a config-first local runtime instead of a token-file-first setup flow.
- Updated `stop-streamweaver.bat` to match the current Next.js and Node runtime.
- Updated `UPDATE-AND-RESTART.bat` to use a safer fast-forward pull workflow instead of a destructive reset.
- Rewrote `README.md` to document the current local architecture, setup, configuration, security model, packaging, and troubleshooting flow.
- Modernized `src/lib/user-config.ts` into a quieter legacy migration shim with atomic writes.
- Removed the legacy `src/data/discord-channels.json` fallback from the Discord channels API.
- Removed deprecated community-bot endpoints from the custom HTTP server.

### Removed

- Removed dead Electron package metadata, scripts, and build configuration from `package.json`.
- Removed stale Electron development dependencies.
- Removed obsolete one-off maintenance scripts:
  - `scripts/fix-user-549531897.js`
  - `scripts/test-community-list.js`
- Removed obsolete friend-specific and migration-era documentation:
  - `AI_BOT_NAME_FIX.md`
  - `FRIEND_AI_FIX.md`
  - `FRIEND_SETUP_CHECKLIST.md`
  - `MANUAL_UPDATE_INSTRUCTIONS.txt`
  - `SETUP_FOR_FRIENDS.md`
- Removed deprecated `/bot/join`, `/bot/leave`, `/bot/auto-join`, and `/broadcast` custom HTTP routes.

### Deprecated

- Legacy token-backed `tokens/user-config.json` remains only as a migration and compatibility shim.
- Legacy token-backed Discord channel settings remain supported through `tokens/discord-channels.json`, but the browser-configured local settings model is the preferred path.

### Fixed

- Fixed package metadata referencing a non-existent Electron main entry.
- Fixed noisy legacy user-config logging on startup.
- Fixed release documentation mismatch between the actual runtime and the old Electron-oriented docs.
- Fixed WebSocket/browser packaging alignment introduced during the local-app security work.

### Security

- Completed the API hardening pass with validated request parsing and standardized error envelopes.
- Kept local-only loopback binding and API-key-gated mutation surfaces as the supported control model.
- Removed deprecated server routes that no longer belonged to the secured runtime.

### Breaking Changes

- Electron-based scripts and Electron packaging have been removed from `package.json`.
- `npm start` now launches the full local app runtime instead of only the Next.js UI server.
- The old destructive update helper behavior has been removed from `UPDATE-AND-RESTART.bat`.
- The Discord channels API no longer reads fallback data from `src/data/discord-channels.json`.

### Migration Notes

- If you previously used Electron wrapper commands, switch to `npm start` or the packaged local release workflow.
- If you relied on friend-specific setup documents, use `README.md` and `README-LOCAL-APP.md` instead.
- If you still depend on `tokens/user-config.json`, keep it only for migration; move user-editable settings to `config/*.json` and the browser Settings page.
- If you used the old update script with local uncommitted changes, review and commit them manually before running `UPDATE-AND-RESTART.bat`.
