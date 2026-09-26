import { readJsonFile, writeJsonFile } from './storage';

export type LoungeMixOutput = 'stella' | 'spotlight' | 'media' | 'all';
export type LoungeAudioMix = {
  levels: Record<LoungeMixOutput, number>;
  selected: LoungeMixOutput;
  updatedAt: number;
};

const FILE_NAME = 'lounge-audio-mix.json';
const STORAGE_CONTEXT = { tenantId: 'spacemountainlive', username: 'lounge' };
const DEFAULTS: LoungeAudioMix = {
  levels: { stella: 100, spotlight: 58, media: 85, all: 100 },
  selected: 'media',
  updatedAt: 0,
};
const OUTPUTS = new Set<LoungeMixOutput>(['stella', 'spotlight', 'media', 'all']);

function normalize(input: Partial<LoungeAudioMix> | null): LoungeAudioMix {
  const volume = (output: LoungeMixOutput) => {
    const value = Number(input?.levels?.[output]);
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : DEFAULTS.levels[output];
  };
  return {
    levels: { stella: volume('stella'), spotlight: volume('spotlight'), media: volume('media'), all: volume('all') },
    selected: input?.selected && OUTPUTS.has(input.selected) ? input.selected : DEFAULTS.selected,
    updatedAt: Number(input?.updatedAt) || 0,
  };
}

export async function getLoungeAudioMix(): Promise<LoungeAudioMix> {
  return normalize(await readJsonFile<Partial<LoungeAudioMix>>(FILE_NAME, DEFAULTS, STORAGE_CONTEXT));
}

export async function selectLoungeMixOutput(output: LoungeMixOutput): Promise<LoungeAudioMix> {
  if (!OUTPUTS.has(output)) throw new Error('Choose Stella, Spotlight, media, or all.');
  const state = await getLoungeAudioMix();
  state.selected = output;
  state.updatedAt = Date.now();
  await writeJsonFile(FILE_NAME, state, STORAGE_CONTEXT);
  return state;
}

export async function setLoungeMixVolume(output: LoungeMixOutput | null, value: number): Promise<LoungeAudioMix> {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Volume must be 0-100.');
  const state = await getLoungeAudioMix();
  const target = output || state.selected;
  if (!OUTPUTS.has(target)) throw new Error('Choose Stella, Spotlight, or media.');
  state.levels[target] = value;
  state.selected = target;
  state.updatedAt = Date.now();
  await writeJsonFile(FILE_NAME, state, STORAGE_CONTEXT);
  return state;
}
