import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getConfigSection } from '@/lib/local-config/service';
import { listTenantFlowPackages } from '@/lib/flow-packages';
import { getStoredTokens } from '@/lib/token-utils.server';
import { communityBotTokensPath } from '@/lib/tenant';
import { promises as fs } from 'fs';

function hasConfiguredAiKey(automation: Record<string, any>): boolean {
  const provider = String(automation.aiProvider || '');
  if (provider === 'openai') return Boolean(String(automation.openaiApiKey || '').trim());
  if (provider === 'edenai') return Boolean(String(automation.edenaiApiKey || '').trim());
  return Boolean(String(automation.geminiApiKey || '').trim());
}

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;

    const [tokens, twitch, discord, automation, obs, packages, communityBotConfigured] = await Promise.all([
      getStoredTokens(tenantId),
      getConfigSection('twitch', tenantId),
      getConfigSection('discord', tenantId),
      getConfigSection('automation', tenantId),
      getConfigSection('obs', tenantId),
      listTenantFlowPackages(tenantId),
      (async () => {
        try {
          const raw = await fs.readFile(communityBotTokensPath(), 'utf-8');
          const data = JSON.parse(raw);
          return Boolean(data?.communityBotToken && data?.communityBotRefreshToken);
        } catch {
          return false;
        }
      })(),
    ]);

    const obsSceneCount = Object.values(obs.scenes || {}).filter((value) => String(value || '').trim().length > 0).length;
    const importedPackageCount = packages.filter((pkg) => pkg.visibility !== 'hidden').length;

    const steps = [
      {
        id: 'broadcaster',
        title: 'Connect broadcaster account',
        description: 'Authenticate the main Twitch account the bot should manage.',
        href: '/integrations',
        ctaLabel: 'Open integrations',
        required: true,
        complete: Boolean(tokens?.broadcasterToken && tokens?.broadcasterRefreshToken),
      },
      {
        id: 'bot',
        title: 'Connect optional bot account',
        description: 'Optional. Your own bot account overrides the shared community bot, and the broadcaster can still handle chat if neither exists.',
        href: '/integrations',
        ctaLabel: 'Review bot options',
        required: false,
        complete: Boolean(
          (tokens?.botToken && tokens?.botRefreshToken) ||
          communityBotConfigured ||
          (tokens?.broadcasterToken && tokens?.broadcasterRefreshToken)
        ),
        detail: tokens?.botToken && tokens?.botRefreshToken
          ? 'Using your dedicated Twitch bot account'
          : communityBotConfigured
            ? 'Using the shared community bot'
            : tokens?.broadcasterToken && tokens?.broadcasterRefreshToken
              ? 'Using your broadcaster account as the chat sender fallback'
              : 'No chat sender available until Twitch broadcaster auth is connected',
      },
      {
        id: 'ai',
        title: 'Configure AI routing',
        description: 'Choose the AI provider, set the bot persona, and save a working API key.',
        href: '/bot-functions',
        ctaLabel: 'Configure AI',
        required: true,
        complete: hasConfiguredAiKey(automation as Record<string, any>) && Boolean(String(automation.aiBotName || '').trim()),
      },
      {
        id: 'flows',
        title: 'Install or build starter flows',
        description: 'Import feature packages or build your own commands and actions.',
        href: '/community',
        ctaLabel: 'Open flow library',
        required: true,
        complete: importedPackageCount > 0,
        detail: `${importedPackageCount} visible flow package${importedPackageCount === 1 ? '' : 's'} available`,
      },
      {
        id: 'obs',
        title: 'Map OBS scenes',
        description: 'Save your live, BRB, starting, ending, or gameplay scenes for overlays and scene actions.',
        href: '/integrations',
        ctaLabel: 'Map OBS scenes',
        required: false,
        complete: obsSceneCount > 0,
        detail: `${obsSceneCount} scene${obsSceneCount === 1 ? '' : 's'} configured`,
      },
      {
        id: 'discord',
        title: 'Connect Discord logging',
        description: 'Optional, but useful for AI chat, share posts, and bot logs.',
        href: '/integrations',
        ctaLabel: 'Review Discord',
        required: false,
        complete: Boolean(String(discord.botToken || '').trim() || String(discord.logChannelId || '').trim() || String(discord.aiChatChannelId || '').trim()),
      },
    ];

    const requiredSteps = steps.filter((step) => step.required);
    const completedRequired = requiredSteps.filter((step) => step.complete).length;
    const completedTotal = steps.filter((step) => step.complete).length;

    return apiOk({
      progress: {
        completedRequired,
        totalRequired: requiredSteps.length,
        completedTotal,
        totalSteps: steps.length,
        percent: requiredSteps.length > 0 ? Math.round((completedRequired / requiredSteps.length) * 100) : 0,
      },
      steps,
      context: {
        broadcasterUsername: twitch.broadcasterUsername || tokens?.broadcasterUsername || null,
        aiProvider: automation.aiProvider,
      },
    });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load dashboard setup status.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
