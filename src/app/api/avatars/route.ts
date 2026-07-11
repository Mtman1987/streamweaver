import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { resolve } from 'path';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { tenantPath } from '@/lib/tenant';

const AVATAR_MEDIA_TYPES = ['idle', 'talking', 'gesture', 'private-dm', 'public-discord'];

function avatarDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/avatars');
  return resolve(process.cwd(), 'data', 'avatars');
}

function settingsFile(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'tokens/avatar-settings.json');
  return resolve(process.cwd(), 'tokens', 'avatar-settings.json');
}

export async function POST(request: NextRequest) {
    try {
        const session = getTenantFromRequest(request);
        const tid = session?.tenantId;
        const contentType = request.headers.get('content-type') || '';

        let type: string;
        let fileExt: string;
        let fileBuffer: Buffer;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file') as File | null;
            type = (formData.get('type') as string) || '';
            if (!file || !type || !AVATAR_MEDIA_TYPES.includes(type)) {
                return apiError('Missing file or type', { status: 400, code: 'INVALID_BODY' });
            }
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            fileExt = ext === 'json' ? 'json' : ext;
            fileBuffer = Buffer.from(await file.arrayBuffer());
        } else {
            const body = await request.json().catch(() => null);
            if (!body?.type || !AVATAR_MEDIA_TYPES.includes(body.type)) {
                return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
            }
            type = body.type;
            const data = body.data;
            const animationType = body.animationType;
            fileExt = (() => {
                if (typeof animationType === 'string' && animationType.length > 0) return animationType === 'lottie' ? 'json' : animationType;
                if (typeof data === 'string' && data.startsWith('data:video/mp4')) return 'mp4';
                if (typeof data === 'string' && data.startsWith('data:image/gif')) return 'gif';
                return 'json';
            })();
            if (typeof data === 'string' && data.startsWith('data:')) {
                fileBuffer = Buffer.from(data.replace(/^data:.+;base64,/, ''), 'base64');
            } else {
                fileBuffer = Buffer.from(JSON.stringify(data));
            }
        }

        const filename = `${type}.${fileExt}`;
        const dir = avatarDir(tid);
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, filename), fileBuffer);

        // Persist settings
        const normalizedType = fileExt === 'json' ? 'lottie' : fileExt;
        let settings: any = {
            isVisible: false, isTalking: false, currentAnimation: 'idle',
            animationType: normalizedType, idleFile: '', talkingFile: '',
        };
        try {
            const existing = await readFile(settingsFile(tid), 'utf-8');
            settings = { ...settings, ...(JSON.parse(existing) || {}) };
        } catch {}
        settings.animationType = normalizedType;
        settings[`${type}File`] = filename;
        const settingsDir = resolve(settingsFile(tid), '..');
        await mkdir(settingsDir, { recursive: true });
        await writeFile(settingsFile(tid), JSON.stringify(settings, null, 2));

        console.log(`[Avatar API] Saved ${filename} for tenant ${tid || 'global'} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);
        return apiOk({ success: true, filename });
    } catch (error: any) {
        console.error('[Avatar API] Error:', error);
        return apiError(error?.message || 'Failed to save avatar', { status: 500, code: 'INTERNAL_ERROR' });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const session = getTenantFromRequest(request);
        const tid = session?.tenantId;
        const body = await request.json().catch(() => null);
        if (!body) return apiError('Invalid body', { status: 400, code: 'INVALID_BODY' });
        let settings: any = {};
        try { settings = JSON.parse(await readFile(settingsFile(tid), 'utf-8')); } catch {}
        if (body.displayMode) settings.displayMode = body.displayMode;
        const dir = resolve(settingsFile(tid), '..');
        await mkdir(dir, { recursive: true });
        await writeFile(settingsFile(tid), JSON.stringify(settings, null, 2));
        return apiOk({ success: true });
    } catch (error: any) {
        return apiError(error?.message || 'Failed to update settings', { status: 500, code: 'INTERNAL_ERROR' });
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');
        const format = searchParams.get('format') || 'lottie';
        // Allow tenant from session or query param (for overlays)
        const session = getTenantFromRequest(request);
        const tid = session?.tenantId || searchParams.get('tenant') || undefined;
        
        if (type === 'settings') {
            try {
                const data = await readFile(settingsFile(tid), 'utf-8');
                return apiOk({ data: JSON.parse(data) });
            } catch {
                return apiOk({ data: {
                    isVisible: false,
                    isTalking: false,
                    currentAnimation: 'idle',
                    animationType: 'lottie'
                }});
            }
        }
        
        if (!type || !AVATAR_MEDIA_TYPES.includes(type)) {
            return apiError('Invalid type', { status: 400, code: 'INVALID_QUERY' });
        }

        const tryFiles =
            format !== 'lottie'
                ? [`${type}.${format}`]
                : [`${type}.json`, `${type}.mp4`, `${type}.gif`];

        const dir = avatarDir(tid);
        for (const file of tryFiles) {
            const filePath = resolve(dir, file);
            try {
                await access(filePath);
                if (file.endsWith('.json')) {
                    const data = await readFile(filePath, 'utf-8');
                    return apiOk({ data: JSON.parse(data), animationType: 'lottie', file });
                }
                if (file.endsWith('.mp4') || file.endsWith('.gif')) {
                    const buf = await readFile(filePath);
                    const mime = file.endsWith('.mp4') ? 'video/mp4' : 'image/gif';
                    return new NextResponse(buf, { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' } });
                }
                const mediaType = file.endsWith('.mp4') ? 'mp4' : 'gif';
                return apiOk({ url: `/avatars/${file}`, animationType: mediaType, file });
            } catch {}
        }

        return apiError('Avatar not found', { status: 404, code: 'NOT_FOUND' });
    } catch {
        return apiError('Avatar not found', { status: 404, code: 'NOT_FOUND' });
    }
}
