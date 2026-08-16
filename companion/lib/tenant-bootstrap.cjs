'use strict';

const SPMT_ORIGIN = 'https://spmt.live';
const BOOTSTRAP_EXCHANGE_URL = `${SPMT_ORIGIN}/api/companion/bootstrap/exchange`;

function parseTenantBootstrapUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'spmt-companion:' || url.hostname !== 'bootstrap') return null;
    const code = String(url.searchParams.get('code') || '').trim();
    return code && code.length <= 512 ? { code } : null;
  } catch {
    return null;
  }
}

function findTenantBootstrapUrl(argv = []) {
  return argv.map((value) => String(value || '')).find((value) => parseTenantBootstrapUrl(value)) || '';
}

async function exchangeTenantBootstrap(fetcher, code, endpoint = BOOTSTRAP_EXCHANGE_URL) {
  const response = await fetcher(endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Companion tenant link failed (${response.status})`);
  if (!payload?.sessionToken || !payload?.device?.id || !payload?.pairingToken || !payload?.user?.id) {
    throw new Error('Companion tenant link returned an incomplete response');
  }
  return payload;
}

module.exports = {
  BOOTSTRAP_EXCHANGE_URL,
  SPMT_ORIGIN,
  exchangeTenantBootstrap,
  findTenantBootstrapUrl,
  parseTenantBootstrapUrl,
};
