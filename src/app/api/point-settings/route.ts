import { NextRequest, NextResponse } from 'next/server';
import { getPointSettings, updatePointSettings, getChannelPointRewards, updateChannelPointRewards, type PointSettings } from '@/services/points';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const channelPointRewardSchema = z.object({
  name: z.string(),
  points: z.number(),
  message: z.string(),
});

const pointSettingsSchema = z.object({
  minChatPoints: z.number().optional(),
  maxChatPoints: z.number().optional(),
  chatCooldown: z.number().optional(),
  eventPoints: z
    .object({
      follow: z.number().optional(),
      subscribe: z.number().optional(),
      tier1: z.number().optional(),
      tier2: z.number().optional(),
      tier3: z.number().optional(),
      monthBonus: z.number().optional(),
      resub: z.number().optional(),
      giftSub: z.number().optional(),
      giftSubTierBoost: z.boolean().optional(),
      cheer: z.number().optional(),
      bitsMultiplier: z.number().optional(),
      raid: z.number().optional(),
      raidPerViewer: z.number().optional(),
      host: z.number().optional(),
      firstWords: z.number().optional(),
    })
    .partial()
    .optional(),
});

const pointSettingsBodySchema = z
  .object({
    type: z.literal('rewards').optional(),
    rewards: z.array(z.unknown()).optional(),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  
  try {
    if (type === 'rewards') {
      const rewards = await getChannelPointRewards();
      return apiOk({ rewards });
    }
    
    const settings = await getPointSettings();
    return apiOk(settings as unknown as Record<string, unknown>);
  } catch (error) {
    console.error('Point settings API error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = pointSettingsBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { type, ...data } = parsed.data;
    
    if (type === 'rewards') {
      if (!Array.isArray(data.rewards)) {
        return apiError('rewards must be an array', { status: 400, code: 'INVALID_BODY' });
      }
      const rewards = z.array(channelPointRewardSchema).parse(data.rewards);
      await updateChannelPointRewards(rewards);
      const updated = await getChannelPointRewards();
      return apiOk({ rewards: updated });
    }
    
    const settings = pointSettingsSchema.parse(data);
    await updatePointSettings(settings as Partial<PointSettings> & { eventPoints?: Partial<PointSettings['eventPoints']> });
    const updated = await getPointSettings();
    return apiOk(updated as unknown as Record<string, unknown>);
  } catch (error) {
    console.error('Point settings API error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}