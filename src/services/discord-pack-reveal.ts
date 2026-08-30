import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { normalizeCardPackEvent, type CardPackGame } from '@/lib/card-pack-event';
import { queueCardPackGif, waitForCardPackGif } from './card-pack-render-client';
import { editDiscordMessage } from './discord-local';
import { editWebhookMessage } from './discord-webhooks';
import {
  buildStructuredDiscordReplyPayload,
  sendStructuredDiscordReply,
  type DiscordReplySpeaker,
  type StructuredDiscordReplyInput,
} from './discord-structured-replies';

export type PackRevealCard = {
  name: string;
  setCode?: string;
  number?: string | number;
  rarity?: string;
  imageUrl?: string;
};

export const PACK_REVEAL_ROW_SIZE = 3;
export const PACK_REVEAL_STEP_MS = 15_000;

const ANSI_RESET = '\u001b[0m';
const ANSI_HIGHLIGHT = '\u001b[1;33m';
const ANSI_DIM = '\u001b[0;37m';
const CELL_WIDTH = 18;

export function packRevealRows(cards: PackRevealCard[]): PackRevealCard[][] {
  const rows: PackRevealCard[][] = [];
  for (let index = 0; index < cards.length; index += PACK_REVEAL_ROW_SIZE) rows.push(cards.slice(index, index + PACK_REVEAL_ROW_SIZE));
  return rows;
}

function cell(card: PackRevealCard): string {
  const name = String(card?.name || '???');
  const text = name.length > CELL_WIDTH ? `${name.slice(0, CELL_WIDTH - 1)}…` : name;
  return text.padEnd(CELL_WIDTH, ' ');
}

export function formatPackGrid(cards: PackRevealCard[], highlightRow: number): string {
  const rows = packRevealRows(cards)
    .map((row, index) => {
      const line = row.map(cell).join(' ').trimEnd();
      return index === highlightRow ? `${ANSI_HIGHLIGHT}${line}${ANSI_RESET}` : `${ANSI_DIM}${line}${ANSI_RESET}`;
    })
    .join('\n');
  return ['```ansi', rows, '```'].join('\n');
}

function galleryEmbeds(cards: PackRevealCard[], embedUrl: string): Record<string, unknown>[] {
  return cards.slice(1).filter((card) => card?.imageUrl).map((card) => ({ url: embedUrl, image: { url: card.imageUrl } }));
}

type PackRevealInput = Omit<StructuredDiscordReplyInput, 'message' | 'imageUrl' | 'extraEmbeds' | 'embedUrl'> & {
  cards: PackRevealCard[];
  featureCard?: PackRevealCard;
  stepMs?: number;
  eventId?: string;
  game?: CardPackGame;
  packUsername?: string;
  setName?: string;
};

function revealStep(input: PackRevealInput, highlightRow: number, speaker: DiscordReplySpeaker): StructuredDiscordReplyInput {
  const rows = packRevealRows(input.cards);
  const rowCards = highlightRow >= 0 ? rows[highlightRow] || [] : [];
  const spotlight = rowCards.length ? rowCards : [input.featureCard].filter(Boolean) as PackRevealCard[];
  const embedUrl = `${getConfiguredAppUrl()}/pokedex`;
  return {
    ...input,
    speaker,
    message: formatPackGrid(input.cards, highlightRow),
    imageUrl: spotlight[0]?.imageUrl,
    embedUrl,
    extraEmbeds: galleryEmbeds(spotlight, embedUrl),
  };
}

async function applyStep(channelId: string, messageId: string, step: StructuredDiscordReplyInput): Promise<void> {
  const payload = await buildStructuredDiscordReplyPayload(step);
  const patched = await editWebhookMessage(channelId, messageId, { content: '', embeds: payload.embeds }).catch(() => false);
  if (!patched) await editDiscordMessage(channelId, messageId, { content: '', embeds: payload.embeds });
}

async function applyGif(input: PackRevealInput, messageId: string, speaker: DiscordReplySpeaker, gifUrl: string) {
  const feature = input.featureCard;
  await applyStep(input.channelId, messageId, {
    ...revealStep({ ...input, featureCard: feature }, -1, speaker),
    message: feature
      ? `${formatPackGrid(input.cards, -1)}\n⭐ **${feature.name}** — ${feature.rarity || 'Rare'}`
      : formatPackGrid(input.cards, -1),
    imageUrl: gifUrl,
    extraEmbeds: [],
  });
}

async function legacyFallback(input: PackRevealInput, messageId: string, speaker: DiscordReplySpeaker) {
  const rowCount = packRevealRows(input.cards).length;
  const stepMs = input.stepMs ?? PACK_REVEAL_STEP_MS;
  for (let row = 1; row < rowCount; row += 1) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    await applyStep(input.channelId, messageId, revealStep(input, row, speaker));
  }
  await new Promise((resolve) => setTimeout(resolve, stepMs));
  const feature = input.featureCard;
  await applyStep(input.channelId, messageId, {
    ...revealStep({ ...input, featureCard: feature }, -1, speaker),
    message: feature
      ? `${formatPackGrid(input.cards, -1)}\n⭐ **${feature.name}** — ${feature.rarity || 'Rare'}`
      : formatPackGrid(input.cards, -1),
  });
}

/**
 * Posts immediately, then asks DSH to record the shared browser reveal and
 * edits this same Discord message with the resulting GIF. Pack inventory is
 * never touched by the renderer. If media rendering is unavailable, the old
 * row-edit reveal remains as the safe fallback.
 */
export async function sendAnimatedPackReveal(input: PackRevealInput): Promise<void> {
  const rowCount = packRevealRows(input.cards).length;
  const first = revealStep(input, 0, {
    botName: input.botName || 'StreamWeaver',
    tenantId: input.tenantId,
    stableId: `${input.tenantId || 'global'}:${(input.botName || 'streamweaver').toLowerCase()}`,
  });
  first.message = `🃏 **Opening ${input.setName || input.title || 'booster pack'}...**\n${formatPackGrid(input.cards, 0)}`;
  const sent = await sendStructuredDiscordReply(first);
  const messageId = sent.messageId;
  if (!messageId || rowCount < 1) return;

  void (async () => {
    try {
      const event = normalizeCardPackEvent({
        eventId: input.eventId,
        game: input.game || 'pokemon',
        username: input.packUsername || input.sourceUser || 'player',
        setName: input.setName || input.title || 'Booster Pack',
        cards: input.cards,
        openedAt: new Date().toISOString(),
      });
      await queueCardPackGif(event);
      const gifUrl = await waitForCardPackGif(event.eventId);
      if (gifUrl) {
        await applyGif(input, messageId, sent.speaker, gifUrl);
        return;
      }
      console.warn(`[Pack Reveal] GIF render did not finish for ${event.eventId}; using edit fallback.`);
    } catch (error) {
      console.warn('[Pack Reveal] GIF render unavailable; using edit fallback:', error instanceof Error ? error.message : error);
    }

    try {
      await legacyFallback(input, messageId, sent.speaker);
    } catch (error) {
      console.error('[Pack Reveal] Failed to animate pack reveal:', error);
    }
  })();
}
