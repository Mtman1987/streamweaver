import { NextResponse } from 'next/server';

export async function GET() {
  const content = `🚀 Twitch‑Wide Tag Game — Powered by @spmt
No installs. Works in any chat. Streamer‑safe.

🌌 Join → @spmt join
🛰️ Tag → @spmt tag @user
📡 Help → @spmt help

A global tag game across ~400 chats. Once you join, it follows you anywhere you chat on Twitch.

🪐 Status → @spmt status (who's It)
🌠 Players → @spmt players
🌙 Stats → @spmt stats
📜 Rules → @spmt rules

You can't tag the person who tagged you.
If someone who's "It" sees you in any stream, they can tag you instantly.

🌌 Bot only replies to @spmt commands.
✨ Never posts links or spam.
🛸 If you're tagged in another chat, your chat gets one message saying who's "It."
🎮 If you're streaming and don't want to play, you can skip your turn.
🔒 Bot never triggers your stream commands.

🌟 If "It" doesn't tag in 45 mins, the bot picks someone new.
🌔 You can be tagged even if the streamer isn't live.
🛰️ When you're "It," you can see who's active across Twitch.
🚀 Fun, lightweight, cross‑community energy. Might bring 2 people, might bring 200 — always more than zero.

Commands:
- @spmt join - Join the game
- @spmt leave - Leave the game
- @spmt tag @user - Tag someone (when you're It)
- @spmt status - See who's currently It
- @spmt players - List all players
- @spmt live - See which players are streaming
- @spmt stats - Your personal stats
- @spmt score - Top taggers leaderboard
- @spmt rank - Top 3 players
- @spmt rules - Game rules
- @spmt info - Full game description
- @spmt help - List all commands
- @spmt mute - Stop receiving tag announcements in your chat
- @spmt unmute - Resume receiving tag announcements
- @spmt optout - Leave game and blacklist your channel

Admin Commands (Mtman1987 only):
- @spmt join @user - Add someone to the game
- @spmt set @user - Tag someone as admin (counts as real tag)
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="twitch-tag-game-info.txt"',
    },
  });
}
