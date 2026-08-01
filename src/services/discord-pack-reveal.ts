import { getConfiguredAppUrl } from '@/lib/runtime-origin';
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
  for (let index = 0; index < cards.length; index += PACK_REVEAL_ROW_SIZE) {
    rows.push(cards.slice(index, index + PACK_REVEAL_ROW_SIZE));
  }
  return rows;
}

function cell(card: PackRevealCard): string {
  const name = String(card?.name || '???');
  const text = name.length > CELL_WIDTH ? `${name.slice(0, CELL_WIDTH - 1)}…` : name;
  return text.padEnd(CELL_WIDTH, ' ');
}

/**
 * Renders the nine cards as a 3x3 ANSI grid. The highlighted row is bright and
 * bold; every other row is dimmed, so successive edits read as a moving row.
 */
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
  return cards
    .slice(1)
    .filter((card) => card?.imageUrl)
    .map((card) => ({ url: embedUrl, image: { url: card.imageUrl } }));
}

type PackRevealInput = Omit<StructuredDiscordReplyInput, 'message' | 'imageUrl' | 'extraEmbeds' | 'embedUrl'> & {
  cards: PackRevealCard[];
  featureCard?: PackRevealCard;
  stepMs?: number;
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
  const patched = await editWebhookMessage(channelId, messageId, { content: '', embeds: payload.embeds })
    .catch(() => false);
  if (!patched) {
    await editDiscordMessage(channelId, messageId, { content: '', embeds: payload.embeds });
  }
}

/**
 * Posts the pack as a 3x3 grid with the first row highlighted, then walks the
 * highlight down one row per step before settling on the rare card alone.
 */
export async function sendAnimatedPackReveal(input: PackRevealInput): Promise<void> {
  const rowCount = packRevealRows(input.cards).length;
  const stepMs = input.stepMs ?? PACK_REVEAL_STEP_MS;
  const feature = input.featureCard;

  const first = revealStep(input, 0, {
    botName: input.botName || 'StreamWeaver',
    tenantId: input.tenantId,
    stableId: `${input.tenantId || 'global'}:${(input.botName || 'streamweaver').toLowerCase()}`,
  });
  const sent = await sendStructuredDiscordReply(first);
  const messageId = sent.messageId;
  if (!messageId || rowCount < 2) return;

  void (async () => {
    try {
      for (let row = 1; row < rowCount; row += 1) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        await applyStep(input.channelId, messageId, revealStep(input, row, sent.speaker));
      }
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      await applyStep(input.channelId, messageId, {
        ...revealStep({ ...input, featureCard: feature }, -1, sent.speaker),
        message: feature
          ? `${formatPackGrid(input.cards, -1)}\n⭐ **${feature.name}** — ${feature.rarity || 'Rare'}`
          : formatPackGrid(input.cards, -1),
      });
    } catch (error) {
      console.error('[Pack Reveal] Failed to animate pack reveal:', error);
    }
  })();
}
