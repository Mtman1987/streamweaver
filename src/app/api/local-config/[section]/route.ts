import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import {
  getConfigSection,
  getPublicConfigSection,
  initializeLocalConfig,
  updateConfigSection,
} from '@/lib/local-config/service';
import { configFileOrder, secretFields, type ConfigSectionName } from '@/lib/local-config/schemas';
import { z } from 'zod';

const sectionUpdateSchema = z.record(z.unknown());

function parseSection(value: string): ConfigSectionName | null {
  const section = value as ConfigSectionName;
  return configFileOrder.includes(section) ? section : null;
}

function applySecretMerge<T extends Record<string, any>>(
  previous: T,
  updates: Record<string, unknown>,
  section: ConfigSectionName
): T {
  const next = { ...previous, ...updates } as T;

  for (const dottedPath of secretFields[section]) {
    const keys = dottedPath.split('.');
    const leafKey = keys[keys.length - 1];

    let targetPrev: any = previous;
    let targetNext: any = next;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      targetPrev = targetPrev?.[key];
      if (!targetNext[key] || typeof targetNext[key] !== 'object') {
        targetNext[key] = {};
      }
      targetNext = targetNext[key];
    }

    const incoming = targetNext[leafKey];
    if (typeof incoming === 'string' && incoming.includes('*')) {
      targetNext[leafKey] = targetPrev?.[leafKey] || '';
    }
  }

  return next;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  await initializeLocalConfig();
  const { section: sectionParam } = await params;
  const section = parseSection(sectionParam);
  if (!section) {
    return apiError('Unknown config section', { status: 404, code: 'SECTION_NOT_FOUND' });
  }

  const config = await getPublicConfigSection(section);
  return apiOk({ section, config });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  await initializeLocalConfig();
  const { section: sectionParam } = await params;
  const section = parseSection(sectionParam);
  if (!section) {
    return apiError('Unknown config section', { status: 404, code: 'SECTION_NOT_FOUND' });
  }

  const parsed = sectionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
  }

  const body = parsed.data;

  const previous = (await getConfigSection(section)) as Record<string, any>;
  const merged = applySecretMerge(previous, body, section);

  try {
    await updateConfigSection(section, merged as any);
    const config = await getPublicConfigSection(section);
    return apiOk({ section, config });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 400, code: 'INVALID_CONFIG' });
  }
}
