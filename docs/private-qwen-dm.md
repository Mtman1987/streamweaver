# Athena private Discord DMs through the existing SPMT Qwen worker

## What this uses now

Adult Mode uses the Qwen worker that already runs in the SPMT Fly organization:

- service: `spmt-llm-worker.internal:8080`;
- API: OpenAI-compatible `/v1/chat/completions`;
- model: `spmt-qwen3-4b`;
- transport: Fly private networking;
- user-facing configuration: none.

This is the current CPU-hosted Qwen service. It is not the proposed future GPU host. StreamWeaver does not ask the broadcaster to configure a Qwen URL, model name, API key, or `.env` entry.

## This is the real Discord DM path

Discord direct messages enter `src/app/api/discord/chat/route.ts`. After private commands are checked, normal DM conversation is sent to `/api/private-chat/respond`. When Adult Mode is on, that route calls the SPMT Qwen private-chat client and sends the cleaned result back to the same Discord DM.

The Athena Coder/workbench is a separate surface. It can use the same underlying worker, but it is not the only place this private-chat code runs.

## Provider behavior

Normal private chat remains unchanged while Adult Mode is off. While Adult Mode is on:

- Qwen is the only text provider for the private conversation;
- no prompt is forwarded to EdenAI, Gemini, OpenAI, or SeaArt;
- an unavailable Qwen worker produces a private error instead of a cloud fallback;
- only the cleaned final response is saved into private history.

Adult Mode is controlled from the Private Chat page or directly in a Discord DM:

```text
adult mode on
adult mode off
adult mode toggle
adult mode status
```

The same controls work after the configured bot name, `spmt`, or `!adult`.

## Repetition-loop protection

Each request contains one system message, recent structured user/assistant turns, and the newest user message exactly once. The Qwen client also:

- removes duplicate adjacent history entries and repeated multi-message blocks;
- repairs cumulative assistant replies already stored in old private history;
- limits history to 24 messages and a 28,000-character budget;
- disables Qwen thinking for the final reply;
- uses temperature `0.7`, top-p `0.8`, top-k `20`, and llama.cpp `repeat_penalty` `1.12`;
- strips thinking blocks, model control tokens, and a leading echo of the newest user message;
- removes one or many copies of recent assistant turns from the start of a completion;
- retries once without assistant history when a completion contains only copied prior text;
- stops accidental `User:` or `Human:` transcript continuation;
- collapses repeated sentences, paragraphs, and exact tail blocks; and
- caps the final Discord response at 3,400 characters.

Because only the cleaned reply is stored, a bad cumulative completion cannot multiply on every later turn.

## Roleplay boundary

Adult Mode is limited to fictional roleplay involving consenting characters who are unambiguously age 18 or older. It excludes minors, age ambiguity, coercion, exploitation, incest, and sexualized real people. Requests to stop or change direction must be respected.

## Validation

```bash
node --import tsx --test tests/private-chat-qwen-mode.test.ts
npm run typecheck
```

The focused tests cover real-DM handoff, built-in SPMT worker selection, no API-key header, no duplicate newest message, old-history cleanup, cumulative assistant-echo removal, anti-loop retry, non-thinking request controls, output capping, and fail-closed behavior.
