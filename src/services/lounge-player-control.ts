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
