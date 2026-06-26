import { NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/api-response';
import { IMAGE_PROMPT_TEMPLATES, writeGenerationSettings } from '@/lib/gen-settings-store';

export async function GET() {
  return apiOk({ templates: Object.keys(IMAGE_PROMPT_TEMPLATES) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = String(body?.template || '').trim().toLowerCase();
  if (!name || !IMAGE_PROMPT_TEMPLATES[name]) {
    return apiError(`Unknown template. Available: ${Object.keys(IMAGE_PROMPT_TEMPLATES).join(', ')}`, { status: 400, code: 'INVALID_TEMPLATE' });
  }
  const tenantId = String(body?.tenantId || '').trim() || undefined;
  const saved = await writeGenerationSettings({ imagePromptTemplate: IMAGE_PROMPT_TEMPLATES[name] }, tenantId);
  return apiOk({ template: name, saved });
}
