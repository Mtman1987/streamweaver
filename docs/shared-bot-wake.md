# Shared StreamWeaver bot wake

Registered StreamWeaver captains can use the shared bot without linking a personal bot account.

| Command | Behavior |
| --- | --- |
| `spmt wake on` / `!wake on` | Allow shared-bot replies in this channel. |
| `spmt wake off` / `!wake off` | Stop shared-bot replies in this channel. |
| `spmt wake status` / `!wake status` | Show the saved setting and active bot identity. |
| `spmt wake` / `!wake` | Same as on. |

Only the broadcaster or a channel moderator can control wake through chat. Mirrored messages, unregistered carrier channels and synthetic bot commands cannot change it. Wake control acknowledgments remain available while asleep. Blacklisted channels remain excluded.

The setting starts off and persists in each tenant’s volume-backed data/shared-bot-wake.json. It is public runtime state, not a secret. A connected personal bot retains priority and its configured name. With no personal bot, the shared StreamWeaver account supplies transport and uses that tenant’s saved personality, interests, aliases and voice. Only an unset personality uses the default StreamWeaver persona. No other captain’s persona is copied.

Wake changes shared fallback posting permission. It does not enable ambient chatter, bypass Twitch bans/AutoMod, override Chat Tag’s away status, or change Stella/Athena’s dedicated connections. Mention the account name returned by the acknowledgment to start a conversation. Linking a personal bot remains optional.

Skipped HTTP sends and Twitch is_sent:false receipts are failures, never successful posts. Shared-chat responses remain source-only.
