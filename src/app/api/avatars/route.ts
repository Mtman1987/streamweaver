import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { resolve } from 'path';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const SETTINGS_FILE = resolve(process.cwd(), 'tokens', 'avatar-settings.json');
const PUBLIC_AVATARS_DIR = resolve(process.cwd(), 'public', 'avatars');

const avatarUploadSchema = z.object({
    type: z.enum(['idle', 'talking', 'gesture']),
    data: z.unknown(),
    animationType: z.enum(['lottie', 'json', 'mp4', 'gif']).optional(),
});

export async function POST(request: NextRequest) {
    try {
        const parsed = avatarUploadSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
        }

        const { type, data, animationType } = parsed.data;
        
        // Save file to public/avatars
        await mkdir(PUBLIC_AVATARS_DIR, { recursive: true });

        const normalizedType = (() => {
            if (typeof animationType === 'string' && animationType.length > 0) {
                return animationType === 'lottie' ? 'json' : animationType;
            }
            if (typeof data === 'string' && data.startsWith('data:video/mp4')) return 'mp4';
            if (typeof data === 'string' && data.startsWith('data:image/gif')) return 'gif';
            return 'json';
        })();
        
        const filename = `${type}.${normalizedType}`;
        const filepath = resolve(PUBLIC_AVATARS_DIR, filename);
        
        // Handle base64 data (MP4/GIF) vs JSON (Lottie)
        if (typeof data === 'string' && data.startsWith('data:')) {
            const base64Data = data.replace(/^data:.+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await writeFile(filepath, buffer);
        } else {
            // Lottie JSON
            await writeFile(filepath, JSON.stringify(data));
        }

        // Persist settings so OBS overlay can load without browser localStorage
        let settings: any = {
            isVisible: false,
            isTalking: false,
            currentAnimation: 'idle',
            animationType: normalizedType === 'json' ? 'lottie' : normalizedType,
            idleFile: '',
            talkingFile: '',
        };
        try {
            const existing = await readFile(SETTINGS_FILE, 'utf-8');
            settings = { ...settings, ...(JSON.parse(existing) || {}) };
        } catch {}
        settings.animationType = normalizedType === 'json' ? 'lottie' : normalizedType;
        settings[`${type}File`] = filename;
        await mkdir(resolve(process.cwd(), 'tokens'), { recursive: true });
        await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        
        return apiOk({ success: true, filename });
    } catch (error: any) {
        console.error('[Avatar API] Error:', error);
        return apiError(error?.message || 'Failed to save avatar', { status: 500, code: 'INTERNAL_ERROR' });
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');
        const format = searchParams.get('format') || 'lottie';
        
        if (type === 'settings') {
            try {
                const data = await readFile(SETTINGS_FILE, 'utf-8');
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
        
        if (!type || !['idle', 'talking', 'gesture'].includes(type)) {
            return apiError('Invalid type', { status: 400, code: 'INVALID_QUERY' });
        }

        const tryFiles =
            format !== 'lottie'
                ? [`${type}.${format}`]
                : [`${type}.json`, `${type}.mp4`, `${type}.gif`];

        for (const file of tryFiles) {
            const filePath = resolve(PUBLIC_AVATARS_DIR, file);
            try {
                await access(filePath);
                if (file.endsWith('.json')) {
                    const data = await readFile(filePath, 'utf-8');
                    return apiOk({ data: JSON.parse(data), animationType: 'lottie', file });
                }
                const mediaType = file.endsWith('.mp4') ? 'mp4' : 'gif';
                return apiOk({ url: `/avatars/${file}`, animationType: mediaType, file });
            } catch {}
        }

        return apiError('Avatar not found', { status: 404, code: 'NOT_FOUND' });
    } catch (error) {
        return apiError('Avatar not found', { status: 404, code: 'NOT_FOUND' });
    }
}
