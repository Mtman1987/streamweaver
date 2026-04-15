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
  return url;
};

export const getStaticWebSocketUrl = () => {
  if (ENV_WS_URL) {
    return ENV_WS_URL;
  }
  const port = sanitizePort(DEFAULT_WS_PORT);
  const host = DEFAULT_WS_HOST;
  return port ? `ws://${host}:${port}` : `ws://${host}`;
};

export const getBrowserWebSocketUrl = (tenantId?: string) => {
  let url = '';
  if (ENV_WS_URL) {
    url = ENV_WS_URL;
  } else if (typeof window === 'undefined') {
    url = getStaticWebSocketUrl();
  } else {
    const pageProtocol = stripProtocol(window.location.protocol);
    const protocol = pageProtocol === 'https' ? 'wss' : 'ws';
    const hostname = window.location.hostname;
    const port = sanitizePort(
      process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || DEFAULT_WS_PORT
    );

    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
      url = port
        ? `${protocol}://127.0.0.1:${port}`
        : `${protocol}://127.0.0.1`;
    } else if (hostname.endsWith('.cloudworkstations.dev') && port) {
      const wsHost = hostname.replace(/^\d+-/, `${port}-`);
      url = `${protocol}://${wsHost}`;
    } else if (port) {
      url = `${protocol}://${hostname}:${port}`;
    } else {
      url = `${protocol}://${hostname}`;
    }
  }

  // Append tenant ID if provided
  if (tenantId) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}tenant=${encodeURIComponent(tenantId)}`;
  }

  return appendLocalApiKey(url);
};

export const STREAMWEAVE_WS_URL = getStaticWebSocketUrl();
