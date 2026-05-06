import { writeOverlayData } from './overlay-manager';

export interface BicOverlayPayload {
  total: number;
  lastUser: string;
  lastUserCount: number;
}

export async function publishBicOverlay(payload: BicOverlayPayload): Promise<void> {
  await writeOverlayData('bic-counter', payload);

  try {
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({
        type: 'overlay-update',
        payload: {
          type: 'bic-counter',
          data: { ...payload, timestamp: Date.now() },
        },
      });
    }
  } catch (error) {
    console.warn('[Bic] Failed to broadcast overlay update:', error);
  }
}
