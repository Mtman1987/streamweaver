import { NextRequest } from 'next/server';
import { readPrivateChatMessages, appendPrivateChatMessages, type PrivateChatMessage } from '@/lib/private-chat-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const privateChatMessageSchema = z.object({
  type: z.enum(['user', 'ai']),
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().max(4000),
  timestamp: z.string().trim().min(1).max(64),
  attachments: z.array(z.object({
    id: z.string().optional(),
    url: z.string().trim().min(1),
    filename: z.string().optional(),
    content_type: z.string().optional(),
  }).passthrough()).optional(),
  embeds: z.array(z.object({}).passthrough()).optional(),
}).refine((value) => value.message || value.attachments?.length || value.embeds?.length, {
  message: 'Message or media is required',
});

function requirePrivateTenant(request: NextRequest): string | null {
  return getTenantFromRequest(request)?.tenantId || null;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = requirePrivateTenant(request);
    if (!tenantId) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    const messages = await readPrivateChatMessages(undefined, tenantId);
    return apiOk({ messages });
  } catch (error) {
    console.error('Private chat GET API error:', error);
    return apiError('Failed to load messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tenantId = requirePrivateTenant(request);
    if (!tenantId) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    const { getPrivateChatFilePath } = await import('@/lib/private-chat-store');
    const { promises: fsp } = await import('fs');
    const filePath = getPrivateChatFilePath(tenantId);
    await fsp.writeFile(filePath, '[]');
    console.log(`[Private Chat] Cleared history for tenant ${tenantId}`);
    return apiOk({ cleared: true });
  } catch (error) {
    console.error('Private chat DELETE API error:', error);
    return apiError('Failed to clear messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = requirePrivateTenant(request);
    if (!tenantId) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });

    const parsedBody = privateChatMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
    }

    const { type, username, message, timestamp, attachments, embeds } = parsedBody.data;
    const normalizedAttachments: PrivateChatMessage['attachments'] | undefined = attachments
      ?.reduce<NonNullable<PrivateChatMessage['attachments']>>((acc, attachment) => {
        if (!attachment.url) return acc;
        acc.push({
          id: String(attachment.id || attachment.url || attachment.filename || ''),
          url: attachment.url,
          filename: String(attachment.filename || 'attachment'),
          ...(attachment.content_type ? { content_type: attachment.content_type } : {}),
        });
        return acc;
      }, []);

    await appendPrivateChatMessages(
      [{ type, username, message, timestamp, attachments: normalizedAttachments, embeds }],
      100,
      tenantId
    );

    console.log(`[Private Chat] Saved ${type} message from ${username} for tenant ${tenantId}`);
    return apiOk({ success: true });
  } catch (error) {
    console.error('Private chat API error:', error);
    return apiError('Failed to save message', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
