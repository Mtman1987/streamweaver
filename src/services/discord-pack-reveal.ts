import { normalizeCardPackEvent, type CardPackGame } from '@/lib/card-pack-event';
import { queueCardPackGif, waitForCardPackGif } from './card-pack-render-client';
import { editDiscordMessage, editDiscordMessageWithBinaryAttachment } from './discord-local';
import { editWebhookMessage, editWebhookMessageWithBinaryAttachment } from './discord-webhooks';
import {
  buildStructuredDiscordReplyPayload,
  resolveStructuredDiscordReplySpeaker,
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

function cardColumnFields(cards: PackRevealCard[]) {
  const columns = [0, 1, 2].map((column) => cards.filter((_, index) => index % 3 === column));
  return columns.map((cardsInColumn) => ({
    name: '\u200B',
    value: cardsInColumn.map((card) => {
      const number = card.number ? `#${card.number}` : '';
      const set = card.setCode ? String(card.setCode) : '';
      const meta = [card.rarity || 'Unknown', set, number].filter(Boolean).join(' · ');
      return `**${cards.indexOf(card) + 1}. ${card.name}**\n${meta || 'Card'}`;
    }).join('\n\n') || '\u200B',
    inline: true,
  }));
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

function buildPackReply(
  input: PackRevealInput,
  speaker: DiscordReplySpeaker,
  state: 'pending' | 'ready' | 'unavailable',
): StructuredDiscordReplyInput {
  const finalCard = input.cards[input.cards.length - 1];
  return {
    ...input,
    speaker,
    message: [
      `🃏 **${input.setName || input.title || 'Booster Pack'} opened**`,
      state === 'pending' ? '🎞️ **PACK ANIMATION INCOMING…**' : '',
      state === 'ready' && finalCard ? `⭐ Final card: **${finalCard.name}** — ${finalCard.rarity || 'Card'}` : '',
      state === 'unavailable' ? '🎞️ Pack animation unavailable for this opening.' : '',
    ].filter(Boolean).join('\n'),
    fields: [
      ...cardColumnFields(input.cards),
      ...(Array.isArray(input.fields) ? input.fields : []),
    ],
    imageUrl: state === 'ready' ? 'attachment://pack-animation.gif' : undefined,
    extraEmbeds: [],
    embedUrl: undefined,
  };
}

async function applyStaticReply(
  input: PackRevealInput,
  messageId: string,
  speaker: DiscordReplySpeaker,
  state: 'pending' | 'unavailable',
) {
  const payload = await buildStructuredDiscordReplyPayload(buildPackReply(input, speaker, state));
  const patched = await editWebhookMessage(input.channelId, messageId, { content: '', embeds: payload.embeds }).catch(() => false);
  if (!patched) {
    await editDiscordMessage(input.channelId, messageId, { content: '', embeds: payload.embeds });
  }
}

async function applyGif(input: PackRevealInput, messageId: string, speaker: DiscordReplySpeaker, gifUrl: string) {
  const payload = await buildStructuredDiscordReplyPayload(buildPackReply(input, speaker, 'ready'));
  const media = await fetch(gifUrl).catch(() => null);
  if (!media?.ok) throw new Error(`Could not fetch rendered pack GIF: ${media?.status || 'network error'}`);
  const fileBuffer = Buffer.from(await media.arrayBuffer());
  const patched = await editWebhookMessageWithBinaryAttachment(
    input.channelId,
    messageId,
    { content: '', embeds: payload.embeds },
    fileBuffer,
    'pack-animation.gif',
  ).catch(() => false);
  if (!patched) {
    await editDiscordMessageWithBinaryAttachment(
      input.channelId,
      messageId,
      { content: '', embeds: payload.embeds },
      fileBuffer,
      'pack-animation.gif',
    );
  }
}

/**
 * Posts immediately, then asks DSH to record the shared browser reveal and
 * edits this same Discord message with the resulting GIF. Pack inventory is
 * never touched by the renderer. If media rendering is unavailable, the old
 * row-edit reveal remains as the safe fallback.
 */
export async function sendAnimatedPackReveal(input: PackRevealInput): Promise<void> {
  if (!input.cards.length) return;
  const speaker = await resolveStructuredDiscordReplySpeaker({
    tenantId: input.tenantId,
    botName: input.botName,
    rotateSpeaker: true,
    isPrivate: false,
  });
  const sent = await sendStructuredDiscordReply(buildPackReply(input, speaker, 'pending'));
  const messageId = sent.messageId;
  if (!messageId) return;

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
      await queueCardPackGif(event, input.tenantId);
      const gifUrl = await waitForCardPackGif(event.eventId);
      if (gifUrl) {
        await applyGif(input, messageId, sent.speaker, gifUrl);
        return;
      }
      console.warn(`[Pack Reveal] GIF render did not finish for ${event.eventId}.`);
    } catch (error) {
      console.warn('[Pack Reveal] GIF render unavailable:', error instanceof Error ? error.message : error);
    }

    try {
      await applyStaticReply(input, messageId, sent.speaker, 'unavailable');
    } catch (error) {
      console.error('[Pack Reveal] Failed to update unavailable pack state:', error);
    }
  })();
}
