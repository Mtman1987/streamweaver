import { NextRequest } from 'next/server';
import { transcribeAudio } from '@/services/speech';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const transcribeSchema = z.object({
    base64Audio: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
    try {
        const parsed = transcribeSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Missing or invalid base64Audio parameter', {
                status: 400,
                code: 'INVALID_BODY',
            });
        }

        const result = await transcribeAudio(parsed.data.base64Audio);

        return apiOk(result as Record<string, unknown>);
    } catch (error: any) {
        console.error('Speech transcription API error:', error);
        return apiError('Internal server error during transcription', {
            status: 500,
            code: 'INTERNAL_ERROR',
        });
    }
}
