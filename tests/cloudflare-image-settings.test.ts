import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultGenerationSettings } from '../src/lib/gen-settings-store';
import { generationModels } from '../src/lib/generation-catalog';
import { DEFAULT_CLOUDFLARE_IMAGE_MODEL } from '../src/services/cloudflare-image';

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
