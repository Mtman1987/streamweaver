import * as fs from 'fs/promises';
import * as path from 'path';
import { tenantPath } from '../lib/tenant';

type PokeMode = 'chat' | 'overlay';
const modeByTenant = new Map<string, PokeMode>();

function key(tenantId?: string): string { return tenantId || '__global__'; }

function modePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/poke-mode.json');
  return path.resolve(process.cwd(), 'data', 'poke-mode.json');
}

export async function getPokeMode(tenantId?: string): Promise<PokeMode> {
  const { getMode } = await import('./modes-manager');
  const mode = await getMode('pokemode', tenantId);
  return mode as PokeMode;
}

export async function togglePokeMode(tenantId?: string): Promise<string> {
  const { toggleMode } = await import('./modes-manager');
  const toggled = await toggleMode('pokemode', tenantId);
  return toggled.current;
}
