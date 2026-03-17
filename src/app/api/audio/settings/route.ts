import { NextRequest, NextResponse } from 'next/server';
import { readJsonFile, writeJsonFile } from '@/services/storage';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const SETTINGS_FILE = 'audio-settings.json';

const audioSettingsSchema = z.object({
  output: z.string().trim().max(256).optional().default(''),
  input: z.string().trim().max(256).optional().default(''),
});

export async function GET() {
  try {
    const data = await readJsonFile(SETTINGS_FILE, { output: '', input: '' });
    const parsed = audioSettingsSchema.safeParse(data);
    if (parsed.success) {
      return apiOk(parsed.data as unknown as Record<string, unknown>);
    }
    return apiOk({ output: '', input: '' });
  } catch (error) {
    console.error('[Audio Settings API] GET error:', error);
    return apiOk({ output: '', input: '' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = audioSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }
    const data = parsed.data;
    await writeJsonFile(SETTINGS_FILE, data);
    return apiOk({ success: true });
  } catch (error) {
    console.error('[Audio Settings API] POST error:', error);
    return apiError('Failed to save settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
