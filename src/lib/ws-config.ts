const DEFAULT_WS_PORT =
  process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT ||
  process.env.WS_PORT ||
  '8090';

const DEFAULT_WS_HOST =
  process.env.NEXT_PUBLIC_STREAMWEAVE_WS_HOST ||
  '127.0.0.1';

const ENV_WS_URL = process.env.NEXT_PUBLIC_STREAMWEAVE_WS_URL;

const sanitizePort = (port?: string | number) => {
  if (!port && port !== 0) {
    return '';
  }
  const normalized = String(port).trim();
  if (!normalized || normalized === '80' || normalized === '443') {
    return '';
  }
  return normalized;
};

const stripProtocol = (protocol: string) =>
  protocol.endsWith(':') ? protocol.slice(0, -1) : protocol;

const appendLocalApiKey = (url: string) => {
  if (typeof window === 'undefined') {
    return url;
  }

  const apiKey = window.localStorage.getItem('streamweaver.localApiKey') || '';
  if (!apiKey) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.searchParams.set('apiKey', apiKey);
    return parsed.toString();
  } catch {
    return url;
  }
};

export const getStaticWebSocketUrl = () => {
  if (ENV_WS_URL) {
    return ENV_WS_URL;
  }
  const port = sanitizePort(DEFAULT_WS_PORT);
  const host = DEFAULT_WS_HOST;
  return port ? `ws://${host}:${port}` : `ws://${host}`;
};

export const getBrowserWebSocketUrl = () => {
  if (ENV_WS_URL) {
    return appendLocalApiKey(ENV_WS_URL);
  }

  if (typeof window === 'undefined') {
    return getStaticWebSocketUrl();
  }

  const pageProtocol = stripProtocol(window.location.protocol);
  const protocol = pageProtocol === 'https' ? 'wss' : 'ws';
  const hostname = window.location.hostname;
  const port = sanitizePort(
    process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || DEFAULT_WS_PORT
  );

  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return appendLocalApiKey(port
      ? `${protocol}://127.0.0.1:${port}`
      : `${protocol}://127.0.0.1`);
  }

  if (hostname.endsWith('.cloudworkstations.dev') && port) {
    const wsHost = hostname.replace(/^\d+-/, `${port}-`);
    return appendLocalApiKey(`${protocol}://${wsHost}`);
  }

  if (port) {
    return appendLocalApiKey(`${protocol}://${hostname}:${port}`);
  }
  return appendLocalApiKey(`${protocol}://${hostname}`);
};

export const STREAMWEAVE_WS_URL = getStaticWebSocketUrl();
