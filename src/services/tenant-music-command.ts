import { twitchMusicSessionId } from '@/lib/twitch-media-scope';
import type { HearMeOutBotActionPayload } from './hearmeout-actions';

export async function handleTenantMusicCommand(input: {
  message: string; tenantId: string; username: string; userId: string;
  canControl: boolean; isBroadcaster: boolean;
  execute: (payload: HearMeOutBotActionPayload) => Promise<any>;
  reply: (text: string) => Promise<unknown>;
}) {
  const match = input.message.trim().match(/^!(sr|wr|skip|next|play|pause|stop|clear|np|nowplaying|status|mute|unmute|vol|volume|playlist|radio|autoradio)(?:\s+(.*))?$/i);
  if (!match) return false;
  let command = match[1].toLowerCase();
  const argument = String(match[2] || '').trim();
  if (command === 'sr') {
    try { const url = new URL(argument); if (url.pathname === '/playlist' && url.searchParams.has('list')) command = 'playlist'; } catch {}
  }
  const reply = async (text: string) => { await input.reply(text).catch(() => {}); };
  const base = { tenantId: input.tenantId, streamMode: 'twitch' as const,
    sessionId: twitchMusicSessionId(input.tenantId), lane: 'music' as const,
    actorName: input.username, actorUserId: input.userId,
    actorRole: input.isBroadcaster ? 'owner' : input.canControl ? 'moderator' : 'member' };
  if (command === 'play') { await reply('!play is disabled globally. Use !sr <song or YouTube URL> to request music.'); return true; }
  if (command === 'wr') { await reply('@' + input.username + ', !wr is disabled for this stream. Use !sr <song or YouTube URL>.'); return true; }
  const readOnly = ['np', 'nowplaying', 'status'].includes(command) || ['playlist', 'radio', 'autoradio'].includes(command) && (!argument || argument.toLowerCase() === 'status');
  const source = command === 'sr' && /^(source|overlay|obs)$/i.test(argument);
  if (source && !input.isBroadcaster) { await reply('The broadcaster can get their OBS source with !sr source.'); return true; }
  if (command !== 'sr' && !readOnly && !input.canControl) { await reply('@' + input.username + ', only the broadcaster or a moderator can use !' + command + '.'); return true; }
  try {
    if (command === 'sr') {
      if (!argument) { await reply('Use !sr <song or YouTube URL>, or !playlist <public YouTube playlist URL> for backup music.'); return true; }
      const result = await input.execute({ ...base, action: source ? 'hmo.media.source' : 'hmo.media.request', query: argument });
      await reply(source ? 'OBS browser source (1920×1080): ' + result.sourceUrl : '@' + input.username + ', "' + (result.request?.item?.title || argument) + '" is queued for this stream.');
    } else if (['playlist', 'radio', 'autoradio'].includes(command)) {
      const value = argument.replace(/^add\s+/i, '');
      const control = /^(on|off|status|clear)$/i.test(value) ? value.toLowerCase() : value ? 'set' : 'status';
      const result = await input.execute({ ...base, action: 'hmo.media.playlist', control, query: control === 'set' ? value : undefined });
      await reply('🎵 Backup playlist ' + (result.playlist?.enabled ? 'on' : 'off') + ': ' + (result.playlist?.title || 'not set') + ' (' + (result.playlist?.count || 0) + ' songs). Song requests play first.');
    } else if (readOnly) {
      const result = await input.execute({ ...base, action: 'hmo.media.state.read' });
      await reply(result.session?.current ? '▶️ Now playing: ' + result.session.current.item.title + ' · ' + (result.session.queue?.length || 0) + ' requests queued.' : 'Nothing is playing in this stream.');
    } else {
      const control = ['skip', 'next'].includes(command) ? 'next' : command === 'stop' ? 'pause' : command === 'vol' ? 'volume' : command;
      const value = control === 'volume' ? Number(argument) : undefined;
      if (control === 'volume' && (!argument || !Number.isFinite(value) || value! < 0 || value! > 100)) { await reply('Use !volume 0-100.'); return true; }
      if (argument && control !== 'volume' && argument.toLowerCase() !== 'music') { await reply('This stream has music only. Use !' + command + ' without a movie lane.'); return true; }
      const result = await input.execute({ ...base, action: 'hmo.media.control', control, value });
      const title = result.session?.current?.item?.title;
      await reply(control === 'next' ? '⏭️ Skipped. ' + (title ? 'Now playing: ' + title + '.' : 'No songs queued.') : control === 'volume' ? '🔊 Music volume set to ' + value + '%.' : '🎵 Music ' + control + (title ? ': ' + title : '') + '.');
    }
  } catch (error) { await reply('Music command failed: ' + (error instanceof Error ? error.message : String(error))); }
  return true;
}
