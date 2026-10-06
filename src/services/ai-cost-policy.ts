import fs from 'node:fs';
import path from 'node:path';

export type AICostPolicy = {
  paidRoutesEnabled: boolean;
  geminiFreeTierVerified: boolean;
  speechWorkerUrl: string;
  femaleTrialVoice: string;
  maleTrialVoice: string;
};

const defaults: AICostPolicy = {
  paidRoutesEnabled: false,
  geminiFreeTierVerified: false,
  speechWorkerUrl: 'http://127.0.0.1:8080',
  femaleTrialVoice: 'af_heart',
  maleTrialVoice: 'am_michael',
};

// Public operational policy, never a secret. The entrypoint seeds this into
// volume-backed config; missing or malformed policy fails closed.
export function readAICostPolicy(): AICostPolicy {
  try {
    const file = process.env.AI_COST_POLICY_PATH || path.join(process.cwd(), 'config', 'ai-cost-policy.json');
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...defaults,
      paidRoutesEnabled: p.paidRoutesEnabled === true,
      // Explicitly confirm the key project has no billing; model names alone do not enforce free usage.
      geminiFreeTierVerified: p.geminiFreeTierVerified === true,
      speechWorkerUrl: typeof p.speechWorkerUrl === 'string' ? p.speechWorkerUrl : defaults.speechWorkerUrl,
      femaleTrialVoice: ['af_heart', 'af_bella'].includes(p.femaleTrialVoice) ? p.femaleTrialVoice : defaults.femaleTrialVoice,
      maleTrialVoice: p.maleTrialVoice === 'am_michael' ? p.maleTrialVoice : defaults.maleTrialVoice,
    };
  } catch { return { ...defaults }; }
}

export const AI_PAUSED_MESSAGE = 'AI replies are temporarily paused while free provider access is being set up. Game commands are still available.';

export class AIProviderPausedError extends Error {
  readonly code = 'AI_PROVIDER_PAUSED';
  constructor() { super('Paid AI providers are paused by the owner.'); this.name = 'AIProviderPausedError'; }
}

export function assertPaidAIAllowed(): void {
  if (!readAICostPolicy().paidRoutesEnabled) throw new AIProviderPausedError();
}
