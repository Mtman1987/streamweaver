export type GenerationCatalogItem = {
  id: string;
  name: string;
  description: string;
  provider?: 'eden' | 'seaart' | 'perchance' | 'pollinations';
  model?: string;
  previewImages?: string[];
  recommended?: string;
};

export const generationModels: GenerationCatalogItem[] = [
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
    description: 'Adds stronger contrast and dramatic light shaping.',
    recommended: 'Strength 0.5 - 0.9',
  },
  {
    id: 'soft-anime-v2',
    name: 'Soft Anime V2',
    description: 'Softens linework and increases pastel rendering in anime outputs.',
    recommended: 'Strength 0.6 - 0.8',
  },
  {
    id: 'portrait-detail-boost',
    name: 'Portrait Detail Boost',
    description: 'Improves face/eye detail for close portrait prompts.',
    recommended: 'Strength 0.4 - 0.7',
  },
];
