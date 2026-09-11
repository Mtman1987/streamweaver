# Commlink community Twitch chats

Registered StreamWeaver tenants already have their own bots, AI, settings,
credentials and IRC ingestion. Commlink discovers their public Twitch channel
names from those existing registrations. It does not enroll the streamer again,
create a second bot or require the channel to appear in the viewer's replay.

The community view projects only native public Twitch messages, actions and
replies from the registered channel. It strips tenant enrichment and arbitrary
metadata. Discord records, private AI conversations, points, cards, commands and
configuration remain in their existing tenant boundaries. Source-only public
messages are displayed; viewing them does not run bots or automation again.

A deliberate compose can target one exact registered channel without waiting
for a replay event. SPMT retains the signed-in account, durable dispatch record
and receipt. StreamWeaver uses the caller's existing broadcaster/bot connection,
never another tenant's account as a fallback. Moderator actions and native
replies still require the original tenant/source event. Ordinary @mentions can
be typed into public chat without changing destinations.

No Bot Share gate or new authentication flow is added. Bot Share continues to
control autonomous bot-to-bot conversations only.
