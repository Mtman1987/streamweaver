// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  🎨 MODULAR OVERLAY MANAGER                                           ║
// ║  Clean, minimal overlays that actually work                           ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import * as fs from 'fs/promises';
import * as path from 'path';
import { setBrowserSource } from './obs';
import { getAppConfig } from '../lib/app-config';

const OVERLAY_DIR = path.resolve(process.cwd(), 'data', 'overlays');

interface OverlayConfig {
  scene: string;
  source: string;
  duration: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}

async function getOverlaysConfig(): Promise<Record<string, OverlayConfig>> {
  const cfg = await getAppConfig();
  const gambleScene = cfg.gambleOverlayScene || process.env.GAMBLE_OVERLAY_SCENE || 'Alerts';
  const gambleSource = cfg.gambleOverlaySource || process.env.GAMBLE_OVERLAY_SOURCE || 'gamble';

  return {
    gamble: {
      scene: gambleScene,
      source: gambleSource,
      duration: 5000,
      position: 'center'
    },
    'space-mountain': {
      scene: gambleScene,
      source: 'space-mountain-overlay',
      duration: 6000,
      position: 'center'
    },
    'classic-gamble': {
      scene: gambleScene,
      source: 'classic-gamble-overlay',
      duration: 5000,
      position: 'center'
    },
    notification: {
      scene: process.env.NOTIFICATION_SCENE || 'Alerts',
      source: 'notification-overlay',
      duration: 3000,
      position: 'top-right'
    }
  };
}

export async function showOverlay(
  type: string,
  data: any
): Promise<void> {
  const overlays = await getOverlaysConfig();
  const config = overlays[type];
  if (!config) {
    console.warn(`[Overlay] Unknown overlay type: ${type}`);
    return;
  }

  try {
    // Write data to JSON file
    const dataPath = path.join(OVERLAY_DIR, `${type}.json`);
    await fs.mkdir(OVERLAY_DIR, { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify({ ...data, timestamp: Date.now() }, null, 2));

    // Show overlay in OBS
    const url = `http://127.0.0.1:3100/overlay/${type}`;
    await setBrowserSource(config.scene, config.source, url);

    // Auto-hide after 15 seconds
    setTimeout(async () => {
      await setBrowserSource(config.scene, config.source, 'about:blank');
    }, 15000);

    console.log(`[Overlay] Showed ${type} for 15000ms`);
  } catch (error) {
    console.error(`[Overlay] Failed to show ${type}:`, error);
  }
}

export async function getOverlayData(type: string): Promise<any> {
  try {
    const dataPath = path.join(OVERLAY_DIR, `${type}.json`);
    const data = await fs.readFile(dataPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getOverlayConfig(type: string): OverlayConfig | null {
  const fallback: Record<string, OverlayConfig> = {
    gamble: { scene: 'Alerts', source: 'gamble', duration: 5000, position: 'center' },
    'space-mountain': { scene: 'Alerts', source: 'space-mountain-overlay', duration: 6000, position: 'center' },
    'classic-gamble': { scene: 'Alerts', source: 'classic-gamble-overlay', duration: 5000, position: 'center' },
    notification: { scene: 'Alerts', source: 'notification-overlay', duration: 3000, position: 'top-right' },
  };
  return fallback[type] || null;
}
