import { readUserConfigSync } from '@/lib/user-config';

export type ImagePromptModerationResult = {
  flagged: boolean;
  categories: string[];
};

export class ImagePromptModerationError extends Error {
  readonly code = 'IMAGE_PROMPT_BLOCKED';
  readonly categories: string[];

  constructor(categories: string[]) {
    super('Image prompt blocked by content moderation');
    this.name = 'ImagePromptModerationError';
    this.categories = categories;
  }
}

function getEdenAIKey(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
}

export function isImagePromptModerationError(error: unknown): error is ImagePromptModerationError {
  return error instanceof ImagePromptModerationError ||
    Boolean(error && typeof error === 'object' && (error as any).code === 'IMAGE_PROMPT_BLOCKED');
}

export async function moderateImagePrompt(prompt: string, tenantId: string): Promise<ImagePromptModerationResult> {
  const apiKey = getEdenAIKey(tenantId);
  if (!apiKey) {
    throw new Error('Content moderation is enabled but no EdenAI API key is configured');
  }

  const response = await fetch('https://api.edenai.run/v3/moderations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/omni-moderation-latest',
      input: prompt,
    }),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    throw new Error(`Image prompt moderation failed: ${response.status} ${JSON.stringify(data).slice(0, 400)}`);
  }

  const results = Array.isArray(data?.results) ? data.results : [];
  const flagged = results.some((item: any) => item?.flagged === true);
  const categorySet = new Set<string>();
  for (const item of results) {
    for (const [category, enabled] of Object.entries(item?.categories || {})) {
      if (enabled === true) categorySet.add(category);
    }
  }
  return { flagged, categories: [...categorySet] };
}
