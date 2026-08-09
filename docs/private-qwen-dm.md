# Athena private DMs through owner-hosted Qwen

## Purpose

Adult Mode routes Athena's private Discord conversations to an OpenAI-compatible Qwen endpoint controlled by the StreamWeaver owner. The endpoint can run on the same host, a private server, or a separate hosted GPU service. It does not need to run on the broadcaster's computer.

Normal private chat remains unchanged while Adult Mode is off. While Adult Mode is on, Qwen is the only text provider for that conversation. A failed Qwen request is reported privately and is not forwarded to EdenAI, Gemini, OpenAI, or SeaArt.

## Repetition-loop fix

The private Qwen path sends one structured message sequence:

1. one system message;
2. recent user and assistant history; and
3. the newest user message exactly once.

It does not place a second `Conversation so far` transcript inside the newest user prompt. Before each request it also:

- removes duplicate adjacent history entries;
- cleans repeated blocks already stored in old assistant history;
- warns Qwen away from distinctive openings and phrases in the six most recent assistant turns;
- detects high-overlap cross-turn replies and automatically regenerates once with a different opening, structure, imagery, and closing;
- limits history to 24 messages and a 28,000-character budget;
- uses Qwen-oriented sampling values: temperature `0.7`, top-p `0.8`, top-k `20`, repetition penalty `1.05`, and light presence/frequency penalties;
- strips thinking blocks and Qwen control tokens;
- removes a leading echo of the newest user message;
- cuts accidental `User:` transcript continuation;
- collapses repeated sentences, paragraphs, and exact tail blocks; and
- caps the final Discord reply at 3,400 characters.

The sanitized reply is the only version saved back to private history, preventing one bad completion from multiplying on later turns.

The tenant's full personality remains active in Adult Mode. StreamWeaver removes only old lines that explicitly require SFW/family-friendly output; it no longer discards the entire extended voice, relationship, and behavior section.

## Server configuration

Set these as deployment secrets or environment variables:

```dotenv
PRIVATE_QWEN_BASE_URL=https://your-qwen-host.example/v1
PRIVATE_QWEN_MODEL=your-server-model-id
PRIVATE_QWEN_API_KEY=replace-with-a-deployment-secret
PRIVATE_QWEN_ALLOW_HTTP=false
PRIVATE_QWEN_MAX_TOKENS=900
```

The endpoint must expose an OpenAI-compatible chat-completions API. A base URL ending in `/v1`, a base host URL, or the full `/v1/chat/completions` URL is accepted.

`PRIVATE_QWEN_API_KEY` remains server-side. It is never stored in tenant JSON and is never returned to the browser.

Remote production endpoints must use HTTPS unless `PRIVATE_QWEN_ALLOW_HTTP=true` is deliberately set for a trusted private network.

## Per-tenant controls

The Private Chat page provides:

- an Adult Mode switch;
- an optional tenant-specific Qwen base URL;
- an optional tenant-specific model ID; and
- configuration status without revealing the API key.

Leaving the URL or model field blank uses the deployment-level environment value.

Private DM commands are also supported:

```text
adult mode on
adult mode off
adult mode toggle
adult mode status
```

The same commands work after the configured bot name, `spmt`, or `!adult`.

## Roleplay boundary

Adult Mode is limited to fictional roleplay involving consenting characters who are unambiguously age 18 or older. It excludes minors, age ambiguity, coercion, exploitation, incest, and sexualized real people. Requests to stop or change direction must be respected.

Within those boundaries, Adult Mode positively directs the character to accept a clear adult-roleplay invitation, respond with a concrete in-character action or choice, and take initiative from the user's cues. It asks a single natural clarification only when a role, boundary, or direction is genuinely unclear; it does not default to disclaimers, coy stalling, or repeated consent boilerplate.

## Validation

Run the focused regression suite and the normal typecheck:

```bash
node --import tsx --test tests/private-chat-qwen-mode.test.ts
npm run typecheck
```

The regression tests cover command parsing, endpoint normalization, single-copy history construction, old-history cleanup, thinking-block removal, user-message echo removal, repeated-block collapse, Discord output capping, Qwen sampling parameters, and fail-closed behavior.
