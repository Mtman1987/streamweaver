# Bot Share Policy

## Non-negotiable invariant

**BOT SHARE ONLY CONTROLS AUTONOMOUS BOT-TO-BOT TALKING.**

Turning Bot Share off must never stop a bot from talking to a human.

Turning Bot Share off must never stop a human from talking to a bot.

Turning Bot Share off must never stop a human-issued command.

Turning Bot Share off must never stop a human-triggered action.

Turning Bot Share off must never stop a bot from replying to a human.

Turning Bot Share off must never stop a human-directed relay between bots or streamers.

Turning Bot Share off must never hide a bot from a public persona/chatbot gallery.

Turning Bot Share off must never stop a human from inviting a public persona into HearMeOut.

Turning Bot Share off must never gate STT or TTS for a human conversation.

Turning Bot Share off must never change normal human-facing behavior on Discord, Twitch, Kick, TikTok, HearMeOut, SPMT, or any future platform.

The only valid Bot Share gate is an interaction where a bot is independently deciding to speak to another bot without a human explicitly directing that interaction. Autonomous bot-to-bot behavior may require both participating tenants to opt in.

## Security boundary

Bot Share is not a secrets/privacy control. Chatbot responses must never expose secrets, access tokens, refresh tokens, API keys, private configuration, or protected owner data regardless of Bot Share state. Those values stay outside public persona prompts and responses.

## Implementation rule

Human-facing routes must not call `getBotShareMode()` to decide whether a bot may answer, execute a permitted command/trigger, appear in a persona catalog, or join a room. CI enforces the allowed call sites so a future change cannot silently turn Bot Share into a human access-control switch again.
