export type GenerationCatalogItem = {
  id: string;
  name: string;
  description: string;
  provider?: 'cloudflare' | 'eden' | 'seaart' | 'perchance' | 'pollinations';
  model?: string;
  previewImages?: string[];
  recommended?: string;
};

export const generationModels: GenerationCatalogItem[] = [
  {
    id: 'cloudflare-flux2-klein-4b',
    name: 'Cloudflare FLUX.2 Klein 4B',
    description: 'Fast low-cost default with up to four visual reference images; ideal for Quackverse family/style matching.',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-2-klein-4b',
    recommended: 'Default / free-tier friendly',
  },
  {
    id: 'cloudflare-flux1-schnell',
    name: 'Cloudflare FLUX.1 Schnell',
    description: 'Very fast general text-to-image option for drafts and inexpensive public generations.',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-1-schnell',
    recommended: 'Fast drafts',
  },
  {
    id: 'cloudflare-lucid-origin',
    name: 'Cloudflare Lucid Origin',
    description: 'Leonardo model for polished illustration and stronger prompt following when a premium Cloudflare model is desired.',
    provider: 'cloudflare',
    model: '@cf/leonardo/lucid-origin',
  },
  {
    id: 'cloudflare-phoenix',
    name: 'Cloudflare Phoenix 1.0',
    description: 'Leonardo model aimed at high prompt adherence and visual quality.',
    provider: 'cloudflare',
    model: '@cf/leonardo/phoenix-1.0',
  },
  {
    id: 'cloudflare-flux2-klein-9b-private',
    name: 'Cloudflare FLUX.2 Klein 9B (private)',
    description: 'Larger Klein profile available only to private-scope generation in StreamWeaver. Check its model license before commercial use.',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-2-klein-9b',
    recommended: 'Private/high-quality experiments',
  },
  {
    id: 'eden-leonardo-sdxl',
    name: 'Leonardo SDXL 0.9',
    description: 'Balanced Eden model for general scenes, characters, and prompt-driven artwork.',
    provider: 'eden',
    model: 'image/generation/leonardo/SDXL 0.9',
    recommended: 'Reliable default',
  },
  {
    id: 'eden-bytedance',
    name: 'ByteDance Image',
    description: 'Eden-managed ByteDance image model with no version-specific endpoint.',
    provider: 'eden',
    model: 'image/generation/bytedance',
    recommended: 'Try for stronger prompt adherence',
  },
  {
    id: 'eden-openai-dalle3',
    name: 'OpenAI DALL-E 3',
    description: 'Strong natural-language prompt following through Eden; costs more per image.',
    provider: 'eden',
    model: 'image/generation/openai/dall-e-3',
  },
  {
    id: 'eden-stability-sdxl',
    name: 'Stability AI SDXL',
    description: 'General-purpose SDXL generation through Eden.',
    provider: 'eden',
    model: 'image/generation/stabilityai/stable-diffusion-xl-1024-v1-0',
  },
  {
    id: 'wai-ani-ponyxl',
    name: 'SeaArt WAI-ANI PonyXL',
    description: 'SeaArt Pony model for stylized anime and PonyXL-compatible prompts.',
    provider: 'seaart',
    model: 'wai-ani-ponyxl',
    recommended: 'Use with LoRA for character consistency',
  },
  {
    id: 'seaart-realistic',
    name: 'SeaArt Realistic',
    description: 'Photoreal-focused model profile for portraits/scenes.',
    provider: 'seaart',
    model: 'seaart-realistic',
  },
  {
    id: 'perchance-ai-text-to-image',
    name: 'Perchance ai-text-to-image',
    description: 'Community/free generator mode for experimentation.',
    provider: 'perchance',
    model: '',
  },
];

export const generationLoras: GenerationCatalogItem[] = [
  {
    id: 'cinematic-lighting',
    name: 'Cinematic Lighting',
    description: 'Style preset for providers/backends that support image LoRAs. Cloudflare Workers AI image endpoints do not currently consume these LoRA slots.',
    recommended: 'Future ComfyUI / supported provider',
  },
  {
    id: 'soft-anime-v2',
    name: 'Soft Anime V2',
    description: 'Anime-style LoRA slot kept for SeaArt or the future local ComfyUI backend, not Cloudflare image generation.',
    recommended: 'Future ComfyUI / SeaArt',
  },
  {
    id: 'portrait-detail-boost',
    name: 'Portrait Detail Boost',
    description: 'Portrait-detail LoRA slot for image backends that explicitly support LoRA loading.',
    recommended: 'Future ComfyUI / supported provider',
  },
];
