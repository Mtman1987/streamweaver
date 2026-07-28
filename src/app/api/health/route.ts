import { NextResponse } from 'next/server';

export async function GET() {
  const requiredSecretNames = ['BOT_SECRET_KEY', 'DSH_SERVICE_SECRET', 'MOUNTAINVIEW_STREAMWEAVER_SECRET', 'STREAMWEAVER_CLIENT_SECRET', 'STREAMWEAVER_SESSION_SECRET', 'SPMT_API_KEY'];
  const isPackagedLocalRuntime = process.env.STREAMWEAVER_PACKAGED_RUNTIME === '1';
  const missingSecretNames = process.env.NODE_ENV === 'production' && !isPackagedLocalRuntime
    ? requiredSecretNames.filter((name) => !String(process.env[name] || '').trim())
    : [];
  return NextResponse.json({
    status: missingSecretNames.length ? 'not-ready' : 'ok',
    timestamp: new Date().toISOString(),
    service: 'streamweaver',
    buildSha: process.env.BUILD_SHA || 'development',
    dependencies: {
      serviceCredentials: isPackagedLocalRuntime
        ? { status: 'local-runtime', required: false }
        : missingSecretNames.length
        ? { status: 'unavailable', missingSecretNames }
        : { status: 'configured' },
    },
  }, { status: missingSecretNames.length ? 503 : 200 });
}
