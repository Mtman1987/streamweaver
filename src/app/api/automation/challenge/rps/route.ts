import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { addPoints, formatCompactPointAmount, getPoints, parsePointAmount } from '@/services/points';
import { sendChatMessage } from '@/services/twitch';
import { listUserVariables, setUserVariable, deleteUserVariable } from '@/lib/automation-variables-store';
import type { StorageContext } from '@/services/storage';

const bodySchema = z.object({
  user: z.string().trim().min(1),
  message: z.string().trim().min(1),
  tenantId: z.string().trim().optional(),
  channel: z.string().trim().optional(),
  rawInput: z.string().trim().optional(),
});

type RpsState = {
  active: boolean;
  round: number;
  playerWins: number;
  botWins: number;
  betRaw: string;
  betValue: string;
};

const CHOICES = ['rock', 'paper', 'scissors'] as const;

function normalizeChoice(message: string): 'rock' | 'paper' | 'scissors' | null {
  const choice = message.trim().toLowerCase();
  if (CHOICES.includes(choice as any)) return choice as any;
  return null;
}

function botChoice(): 'rock' | 'paper' | 'scissors' {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

function choiceWins(player: string, bot: string): boolean {
  return (
    (player === 'rock' && bot === 'scissors') ||
    (player === 'paper' && bot === 'rock') ||
    (player === 'scissors' && bot === 'paper')
  );
}

function choiceDisplay(choice: string): string {
  return choice.charAt(0).toUpperCase() + choice.slice(1);
}

function toStorageContext(tenantId?: string, username?: string): StorageContext | undefined {
  if (!tenantId || !username) return undefined;
  return { tenantId, username };
}

async function getState(user: string, tenantId?: string): Promise<RpsState | null> {
  const vars = await listUserVariables(user, tenantId);
  const raw = vars.rpsChallenge;
  if (!raw || typeof raw !== 'object') return null;
  const state = raw as Partial<RpsState>;
  if (!state.active) return null;
  return {
    active: true,
    round: Number(state.round || 1),
    playerWins: Number(state.playerWins || 0),
    botWins: Number(state.botWins || 0),
    betRaw: String(state.betRaw || ''),
    betValue: String(state.betValue || '0'),
  };
}

async function saveState(user: string, state: RpsState, tenantId?: string): Promise<void> {
  await setUserVariable(user, 'rpsChallenge', state, tenantId);
}

async function clearState(user: string, tenantId?: string): Promise<void> {
  await deleteUserVariable(user, 'rpsChallenge', tenantId);
}

async function startChallenge(input: z.infer<typeof bodySchema>) {
  const { user, message, tenantId, channel, rawInput } = input;
  const betText = (rawInput || message.replace(/^!rps\b/i, '').trim()).trim();
  const resolvedChannel = channel || undefined;
  const pointsCtx = toStorageContext(tenantId, user);
  let parsedBet: bigint | null = null;
  try {
    parsedBet = betText ? parsePointAmount(betText) : null;
  } catch {
    parsedBet = null;
  }

  if (parsedBet == null || parsedBet <= 0n) {
    await sendChatMessage(`@${user}, use !rps <points> to start the challenge.`, 'bot', resolvedChannel, tenantId);
    return apiOk({ handled: false, stage: 'start', message: 'Missing or invalid bet amount.' });
  }

  const currentPoints = await getPoints(user, pointsCtx);
  const balance = BigInt(currentPoints.pointsRaw || '0');
  if (balance < parsedBet) {
    await sendChatMessage(
      `@${user}, you need ${formatCompactPointAmount(parsedBet)} points to play. You have ${currentPoints.pointsDisplay}.`,
      'bot',
      resolvedChannel,
      tenantId
    );
    return apiOk({ handled: false, stage: 'start', message: 'Insufficient points.' });
  }

  const state: RpsState = {
    active: true,
    round: 1,
    playerWins: 0,
    botWins: 0,
    betRaw: betText,
    betValue: parsedBet.toString(),
  };

  await saveState(user, state, tenantId);
  await sendChatMessage(
    `@${user}, challenge accepted for ${formatCompactPointAmount(parsedBet)} points. 3...2...1 go! Type rock, paper, or scissors. Best 2 out of 3.`,
    'bot',
    resolvedChannel,
    tenantId
  );

  return apiOk({ handled: true, stage: 'start', state });
}

async function resolveChallenge(input: z.infer<typeof bodySchema>, state: RpsState) {
  const { user, message, tenantId, channel } = input;
  const resolvedChannel = channel || undefined;
  const playerChoice = normalizeChoice(message);

  if (!playerChoice) {
    return apiOk({ handled: false, stage: 'resolve', message: 'Not a valid choice.' });
  }

  const bot = botChoice();
  let nextState = { ...state };
  let roundMessage = `@${user}, round ${state.round}: you chose ${choiceDisplay(playerChoice)}, bot chose ${choiceDisplay(bot)}. `;

  if (playerChoice === bot) {
    roundMessage += 'It is a tie. Pick again.';
    await sendChatMessage(roundMessage, 'bot', resolvedChannel, tenantId);
    return apiOk({
      handled: true,
      stage: 'tie',
      round: state.round,
      playerWins: state.playerWins,
      botWins: state.botWins,
      botChoice: bot,
    });
  }

  const playerWonRound = choiceWins(playerChoice, bot);
  if (playerWonRound) {
    nextState.playerWins += 1;
    roundMessage += `You win the round. Score ${nextState.playerWins}-${nextState.botWins}.`;
  } else {
    nextState.botWins += 1;
    roundMessage += `Bot wins the round. Score ${nextState.playerWins}-${nextState.botWins}.`;
  }

  const isFinal = nextState.playerWins >= 2 || nextState.botWins >= 2 || state.round >= 3;
  if (isFinal) {
    const bet = BigInt(state.betValue || '0');
    const payout = bet * 2n;
    const pointsCtx = toStorageContext(tenantId, user);

    if (nextState.playerWins > nextState.botWins) {
      await addPoints(user, payout, 'rps win', pointsCtx);
      await sendChatMessage(
        `🎉 @${user} wins best 2 out of 3! ${formatCompactPointAmount(payout)} points awarded.`,
        'broadcaster',
        resolvedChannel,
        tenantId
      );
    } else {
      await addPoints(user, -bet, 'rps loss', pointsCtx);
      await sendChatMessage(
        `💥 @${user} loses best 2 out of 3 and loses ${formatCompactPointAmount(bet)} points.`,
        'broadcaster',
        resolvedChannel,
        tenantId
      );
    }

    await clearState(user, tenantId);
    await sendChatMessage(roundMessage, 'bot', resolvedChannel, tenantId);
    return apiOk({
      handled: true,
      stage: 'final',
      round: state.round,
      playerWins: nextState.playerWins,
      botWins: nextState.botWins,
      botChoice: bot,
    });
  }

  nextState.round += 1;
  await saveState(user, nextState, tenantId);
  await sendChatMessage(`${roundMessage} Next round: type rock, paper, or scissors.`, 'bot', resolvedChannel, tenantId);

  return apiOk({
    handled: true,
    stage: 'round',
    round: nextState.round,
    playerWins: nextState.playerWins,
    botWins: nextState.botWins,
    botChoice: bot,
  });
}

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const data = parsed.data;
    const normalized = data.message.trim();
    const state = await getState(data.user, data.tenantId);

    if (/^!rps\b/i.test(normalized)) {
      return await startChallenge({
        ...data,
        rawInput: data.rawInput || normalized.replace(/^!rps\b/i, '').trim(),
      });
    }

    if (state?.active && normalizeChoice(normalized)) {
      return await resolveChallenge(data, state);
    }

    return apiOk({ handled: false, stage: 'ignored' });
  } catch (error: any) {
    console.error('[RPS Automation] Error:', error);
    return apiError(error?.message || 'Failed to process RPS challenge.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
