import { readJsonFile, writeJsonFile } from './storage';

const LOUNGE_REFRESH_FILE = 'lounge-browser-refresh.json';
const LOUNGE_MEDIA_PLAYER_RESTART_FILE = 'lounge-media-player-restart.json';
const LOUNGE_REFRESH_CONTEXT = { tenantId: 'spacemountainlive', username: 'lounge' };
const LOUNGE_REFRESH_COOLDOWN_MS = 2 * 60_000;
const LOUNGE_MEDIA_PLAYER_RESTART_COOLDOWN_MS = 15_000;
type LoungeRefreshState = { requestedAt: number; requestedBy: string };

export async function getLoungeBrowserRefresh() {
  const state = await readJsonFile<LoungeRefreshState>(
    LOUNGE_REFRESH_FILE, { requestedAt: 0, requestedBy: '' }, LOUNGE_REFRESH_CONTEXT,
  );
  return { requestedAt: Number(state.requestedAt) || 0 };
}

export async function requestLoungeBrowserRefresh(actor: string) {
  const state = await getLoungeBrowserRefresh();
  const now = Date.now();
  if (now - state.requestedAt < LOUNGE_REFRESH_COOLDOWN_MS) {
    return { ...state, accepted: false };
  }
  await writeJsonFile(LOUNGE_REFRESH_FILE, { requestedAt: now, requestedBy: actor }, LOUNGE_REFRESH_CONTEXT);
  return { requestedAt: now, accepted: true };
}

export async function getLoungeMediaPlayerRestart() {
  const state = await readJsonFile<LoungeRefreshState>(
    LOUNGE_MEDIA_PLAYER_RESTART_FILE, { requestedAt: 0, requestedBy: '' }, LOUNGE_REFRESH_CONTEXT,
  );
  return { requestedAt: Number(state.requestedAt) || 0 };
}

export async function requestLoungeMediaPlayerRestart(actor: string) {
  const state = await getLoungeMediaPlayerRestart();
  const now = Date.now();
  if (now - state.requestedAt < LOUNGE_MEDIA_PLAYER_RESTART_COOLDOWN_MS) {
    return { ...state, accepted: false };
  }
  await writeJsonFile(LOUNGE_MEDIA_PLAYER_RESTART_FILE, { requestedAt: now, requestedBy: actor }, LOUNGE_REFRESH_CONTEXT);
  return { requestedAt: now, accepted: true };
}

let spotlightRestartNonce = 0;
let spotlightRestartedAt = '';

export function requestSpotlightRestart() {
  spotlightRestartNonce += 1;
  spotlightRestartedAt = new Date().toISOString();
  return { restartNonce: spotlightRestartNonce, restartedAt: spotlightRestartedAt };
}

export function getSpotlightControlState() {
  return { restartNonce: spotlightRestartNonce, restartedAt: spotlightRestartedAt };
}
