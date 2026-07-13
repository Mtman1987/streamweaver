# Social Stream Ninja Integration

This repo treats Social Stream Ninja as an external bridge and reference implementation, not vendored app code.

## Source Boundary

- Upstream web/extension repo: `https://github.com/steveseguin/social_stream`
- Upstream desktop app repo: `https://github.com/steveseguin/ssn_app`
- Local reference clones live outside deployable source at `../_reference/social_stream` and `../_reference/ssn_app`.
- Upstream is GPLv3. Keep direct code copying out of StreamWeaver unless the distribution/licensing decision is explicit.

## Installed Bridge

StreamWeaver accepts normalized Social Stream-style chat payloads at:

```text
POST /api/integrations/social-stream
```

Authentication:

- Prefer `Authorization: Bearer $SOCIAL_STREAM_BRIDGE_TOKEN`.
- `x-streamweaver-bridge-token: $SOCIAL_STREAM_BRIDGE_TOKEN` also works.
- If `SOCIAL_STREAM_BRIDGE_TOKEN` is unset, `BOT_SECRET_KEY` is accepted.
- Localhost is allowed without a token for local smoke tests only.

Targeting:

- Public memory is the default target.
- Use `visibility=private`, `scope=private`, `private: true`, or `isPrivate: true` for private chat memory.
- `tenantId` may be provided in the JSON body for server-to-server bridge calls when there is no browser session cookie.

## Payload Fields

The bridge accepts the common Social Stream fields documented in upstream `api.md`:

```json
{
  "type": "twitch",
  "chatname": "Viewer",
  "chatmessage": "hello from SSN",
  "chatimg": "https://example.com/avatar.png",
  "contentimg": "https://example.com/gif.gif",
  "hasDonation": "$5.00",
  "subtitle": "member for 3 months",
  "meta": {
    "messageId": "source-message-id"
  }
}
```

Stored shape:

- `chatname`, `username`, or `displayName` becomes StreamWeaver `username`.
- `chatmessage`, `message`, `text`, `comment`, `event`, or `hasDonation` becomes StreamWeaver `message`.
- `type`, `source`, or `platform` becomes the source prefix.
- `contentimg`, `image`, `media`, and `attachments[]` become StreamWeaver attachments so GIFs/images render in the web chat.
- `chatimg`, `hasDonation`, `membership`, and `subtitle` become lightweight embeds.

## Social Stream Listener Shape

Social Stream's external listener path is:

```text
wss://io.socialstream.ninja/join/SESSION_ID/4
```

Required Social Stream settings:

- Enable remote API control of extension.
- Enable "Send chat messages to API server".

StreamWeaver includes a bridge runner that can listen on that websocket and forward each payload to StreamWeaver:

```powershell
$env:SOCIAL_STREAM_SESSION_ID = "YOUR_SSN_SESSION_ID"
$env:SOCIAL_STREAM_TARGET_URL = "https://streamweaver-new.fly.dev/api/integrations/social-stream"
$env:SOCIAL_STREAM_BRIDGE_TOKEN = "YOUR_BRIDGE_TOKEN"
$env:SOCIAL_STREAM_TENANT_ID = "YOUR_TENANT_ID"
npm run social-stream:bridge
```

Optional environment variables:

- `SOCIAL_STREAM_CHANNEL`: defaults to `4`.
- `SOCIAL_STREAM_WS_URL`: overrides the generated `wss://io.socialstream.ninja/join/{session}/4` URL.
- `SOCIAL_STREAM_VISIBILITY`: defaults to `public`; set to `private` to write private chat memory.

The bridge runner is implemented in `scripts/social-stream-bridge.ts`.

A custom bridge can also post directly:

```js
await fetch("https://streamweaver-new.fly.dev/api/integrations/social-stream", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${process.env.SOCIAL_STREAM_BRIDGE_TOKEN}`,
  },
  body: JSON.stringify({
    tenantId: "YOUR_TENANT_ID",
    ...socialStreamPayload,
  }),
});
```

## Ecosystem Map

Use this bridge contract as the shared edge for the rest of the apps:

- StreamWeaver owns normalized chat memory, TTS, AI responses, overlays, and Discord/web chat parity.
- `spmt-live` should own identity/session and issue per-app bridge credentials later.
- `web` should display the ecosystem demo/control surface, not store raw chat credentials.
- HearMeOut should keep room/watch/music session routes separate from chat ingest, but can consume normalized events later.
- DiscordStreamHub should keep Discord send/interaction ownership and only pass normalized messages/events across app boundaries.

## Next Phases

1. Add a StreamWeaver-managed Social Stream websocket listener with reconnect/backoff and tenant-scoped session config.
2. Add a small UI in bot functions/integrations for SSN session ID, channel, target memory, and bridge status.
3. Add an ecosystem demo page in `web` that shows StreamWeaver chat, HearMeOut watch state, and DSH Discord state together.
4. Add a shared `spmt-live` provider-grant/bridge-token model instead of app-local static tokens.
