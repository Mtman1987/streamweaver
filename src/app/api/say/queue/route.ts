import { NextRequest, NextResponse } from 'next/server';
import { addSayQueueItem, getSayQueue } from '../_store';
import { resolveSayQueueStreamKey } from '../_stream';
import { generateTTS } from '@/services/tts-provider';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { getSayVoicePreference } from '@/services/say-tts';
import { speakInHearMeOutRoom } from '@/services/hearmeout-actions';

export async function POST(request: NextRequest) {
  const { text, tenantId, tenantIds, voice, speakerUserId, speakerName } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  const cleanText = String(text).slice(0, 500);
  const requestedTenantIds = Array.isArray(tenantIds) ? tenantIds : [tenantId];
  const queueTenantIds = Array.from(new Set(await Promise.all(requestedTenantIds.map(resolveSayQueueStreamKey))));
  const activeQueueTenantIds = queueTenantIds.filter((id) => hasActiveTtsConsumer(id, 'say'));
  const queueTenantId = activeQueueTenantIds[0] || queueTenantIds[0] || 'global';
  const isDiscordRoom = queueTenantId.startsWith('discord:');

  // Discord TTS now has a real shared consumer inside HearMeOut. For Twitch and
  // legacy standalone players, keep the old guard that avoids paid synthesis
  // when nobody is listening.
  if (!isDiscordRoom && activeQueueTenantIds.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'no-active-say-listener',
      tenantId: queueTenantId,
      queued: 0,
      queues: [],
    });
  }

  const explicitVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : undefined;
  const savedDiscordVoice = !explicitVoice && isDiscordRoom && speakerUserId
    ? await getSayVoicePreference(speakerUserId, 'discord')
    : undefined;
  const voiceOverride = explicitVoice || savedDiscordVoice;

  try {
    const audioDataUri = await generateTTS(
      cleanText,
      voiceOverride,
      queueTenantId,
      isDiscordRoom
        ? { requireActiveConsumer: false }
        : { requireActiveConsumer: true, consumerScope: 'say' },
    );
    if (!audioDataUri) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'tts-returned-empty-audio',
        tenantId: queueTenantId,
        queued: 0,
        queues: [],
      });
    }

    if (isDiscordRoom) {
      try {
        const roomResult = await speakInHearMeOutRoom({
          audioDataUri,
          tenantId: queueTenantId,
          actorUserId: typeof speakerUserId === 'string' ? speakerUserId : undefined,
          actorName: typeof speakerName === 'string' ? speakerName : undefined,
        });
        return NextResponse.json({
          ok: true,
          tenantId: queueTenantId,
          delivered: 'hearmeout-room',
          roomId: roomResult.roomId || process.env.HEARMEOUT_PUBLIC_TTS_ROOM_ID || 'discord-activity',
          queued: 0,
          queues: [],
          voice: voiceOverride || null,
        });
      } catch (roomError) {
        console.warn('[Say Queue] HearMeOut room TTS failed; checking local Say Player fallback:', roomError);
        if (activeQueueTenantIds.length === 0) throw roomError;
      }
    }

    // Compatibility fallback for Twitch and for a Discord channel whose shared
    // HearMeOut delivery is temporarily unavailable but has an active old Say Player.
    const targetQueues = activeQueueTenantIds.length ? activeQueueTenantIds : [queueTenantId];
    const queued = targetQueues.map((id) => {
      const item = addSayQueueItem(id, audioDataUri);
      const sayQueue = getSayQueue(id);
      return { tenantId: id, queued: sayQueue.length, id: item.id };
    });
    return NextResponse.json({
      ok: true,
      tenantId: queueTenantId,
      delivered: isDiscordRoom ? 'local-fallback' : 'say-player',
      queued: queued[0]?.queued || 0,
      id: queued[0]?.id,
      queues: queued,
      voice: voiceOverride || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tts-failed' }, { status: 502 });
  }
}