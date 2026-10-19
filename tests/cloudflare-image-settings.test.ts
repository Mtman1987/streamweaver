import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultGenerationSettings } from '../src/lib/gen-settings-store';
import { generationModels } from '../src/lib/generation-catalog';
import { CloudflareWorkersAIUnavailableError, DEFAULT_CLOUDFLARE_IMAGE_MODEL, generateImageWithCloudflare } from '../src/services/cloudflare-image';

test('Cloudflare Workers AI is the default image provider for unsaved settings', () => {
  const settings = getDefaultGenerationSettings();
  assert.equal(settings.mode, 'cloudflare');
  assert.equal(settings.imageCount, 1);
});

test('Cloudflare catalog includes the Klein 4B default and private 9B profile', () => {
  const cloudflare = generationModels.filter((item) => item.provider === 'cloudflare');
  assert.ok(cloudflare.some((item) => item.model === DEFAULT_CLOUDFLARE_IMAGE_MODEL));
  assert.ok(cloudflare.some((item) => item.model === '@cf/black-forest-labs/flux-2-klein-9b'));
});


test('Cloudflare free image generation is not blocked by the paid-provider pause', async () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    await assert.rejects(
      generateImageWithCloudflare({ prompt: 'simple landscape' }),
      CloudflareWorkersAIUnavailableError,
    );
  } finally {
    if (accountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
    if (apiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = apiToken;
  }
});
