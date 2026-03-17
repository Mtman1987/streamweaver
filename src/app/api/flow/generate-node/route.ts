import { NextResponse } from 'next/server';
import { generateFlowNode } from '@/ai/flows/generate-flow-node';
import { listPlugins } from '@/plugins';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const generateNodeSchema = z.object({
  description: z.string().trim().min(1, 'Description is required.').max(2000, 'Description too long'),
});

export async function POST(request: Request) {
  try {
    const parsed = generateNodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Description is required.', { status: 400, code: 'INVALID_BODY' });
    }

    const { description } = parsed.data;

    const plugins = listPlugins().map((plugin) => plugin.id);

    const node = await generateFlowNode({
      description,
      context: {
        availablePlugins: plugins,
        defaultVoice: process.env.NEXT_DEFAULT_TTS_VOICE,
      },
    });

    return apiOk(node as unknown as Record<string, unknown>);
  } catch (error: any) {
    console.error('[API] generate-node failed:', error);
    return apiError(error?.message || 'Failed to generate node.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
