export type GenerationCatalogItem = {
  id: string;
  name: string;
  description: string;
  previewImages?: string[];
  recommended?: string;
};

export const generationModels: GenerationCatalogItem[] = [
  {
    id: 'eden-phoenix',
    name: 'Eden Leonardo Phoenix',
    description: 'Balanced general-purpose image model for clean prompts and character art.',
    recommended: 'Default for consistent results',
  },
  {
    id: 'wai-ani-ponyxl',
    name: 'SeaArt WAI-ANI PonyXL',
    description: 'SeaArt Pony model for stylized anime and PonyXL-compatible prompts.',
    recommended: 'Use with LoRA for character consistency',
  },
  {
    id: 'seaart-realistic',
    name: 'SeaArt Realistic',
    description: 'Photoreal-focused model profile for portraits/scenes.',
  },
  {
    id: 'perchance-ai-text-to-image',
    name: 'Perchance ai-text-to-image',
    description: 'Community/free generator mode for experimentation.',
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
