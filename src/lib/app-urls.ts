import appUrls from '../../app-urls.json';

type AppUrlEnvironment = keyof typeof appUrls;

function normalizeAppUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getAppUrlForEnvironment(environment: AppUrlEnvironment): string {
  return normalizeAppUrl(appUrls[environment]);
}

export function getEnvironmentAppUrl(): string {
  return getAppUrlForEnvironment(process.env.NODE_ENV === 'production' ? 'production' : 'development');
}

export function getRuntimeAppUrl(): string {
  const loopbackPort = new URL(getAppUrlForEnvironment('loopback')).port;
  const runtimePort = process.env.PORT || process.env.NEXT_PUBLIC_STREAMWEAVE_PORT;
  const environment = process.env.NODE_ENV === 'production' && runtimePort !== loopbackPort
    ? 'production'
    : 'development';
  return getAppUrlForEnvironment(environment);
}

export function getLoopbackAppUrl(port?: string | number | null): string {
  const loopbackUrl = new URL(getAppUrlForEnvironment('loopback'));
  const normalizedPort = port === undefined || port === null ? '' : String(port).trim();
  if (normalizedPort) loopbackUrl.port = normalizedPort;
  return normalizeAppUrl(loopbackUrl.toString());
}

export function getKnownAppUrls(): string[] {
  return [
    getAppUrlForEnvironment('production'),
    getAppUrlForEnvironment('development'),
    getAppUrlForEnvironment('loopback'),
  ];
}
