# StreamWeaver Points/Players/Chat-Tag Fixes

## Step 1: Fix Twitch Community Points Awarding [ ]
- Edit actions/tag-pass-raid.json: Add HTTP POST `/api/points` action=add username=%user% amount=10 (raid base) + viewers*perViewer.
- Edit actions/tag-pass-follow.json: amount=5.
- Edit actions/tag-pass-subscribe.json: amount=25 (or tier).
- Edit actions/tag-pass-bits.json: amount=%bits%/100.

**Test**: Trigger raid/follow -> check currency page leaderboard updates.

## Step 2: Fix Chat-Tag Discord Shoutouts [ ]
- Read/fix components/chat-tag-game.tsx for reliable live shoutouts/embeds.
- Update components/discord-channel-settings.tsx + api/discord/post-embed for manual Twitch-Discord mapping.
- Test live stream -> auto Discord embed shoutout.

## Step 3: Fix Players Live Filter [X]
- Edit src/services/tag-game.ts: Replace liveCount/chattingCount placeholders with fetch `/api/twitch/live`.
- Filter players list to ONLY live/active/lurkers (no others).
- Test `@spmt players` shows filtered + real 🟢/💬 counts.

## Step 4: Test & Complete [ ]
- npm run dev
- Test all: raid points, Discord shoutout, @spmt players filter.
- attempt_completion

