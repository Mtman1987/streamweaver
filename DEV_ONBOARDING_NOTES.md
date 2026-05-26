# StreamWeaver Dev Onboarding Notes (Session Capture)

## Why this file exists
This is a practical orientation doc for engineers joining midstream. It summarizes what was built, where the moving parts live, and what to check before shipping changes.

## Core runtime flows
- Discord inbound: `src/app/api/discord/chat/route.ts`
- DM fallback polling: `src/services/chat-monitor.ts`
- Image generation API: `src/app/api/ai/image/route.ts`
- Provider adapters: `src/services/image-provider.ts`
- Tenant generation settings: `src/lib/gen-settings-store.ts`, `src/app/api/gen-settings/route.ts`
- Dashboard controls: `src/components/discord-channel-settings.tsx`

## Session highlights
- Added tenant generation defaults persistence and API.
- Added Generation Settings modal in dashboard and wired save/load.
- Added model and LoRA registry pages with apply actions.
- Wired DM `!img` to use tenant defaults in direct + sweeper paths.
- Polished prior issues: TTS avatar query handling and duplicate DM image-link behavior.

## Known sharp edges
- Provider adapters vary in payload shape and reliability.
- DM logic has two entry paths; keep parity to avoid confusing user behavior.
- Some UI controls are still free-text and prone to malformed input.

## Quick validation checklist before merge
1. `npm run -s typecheck`
2. DM direct flow:
   - `!genmode status`
   - `!img <prompt>`
3. DM sweeper flow:
   - verify same command behavior and no duplicate image sends
4. Open `/generation/models` and `/generation/loras`, apply entries, re-open modal, confirm values persisted.
5. Open image library endpoint and verify new artifacts appear.

## Safe change strategy
- Change one subsystem at a time (UI, provider, DM, persistence).
- Add explicit logs on every external/provider boundary.
- Prefer deterministic fallbacks over silent catches.
