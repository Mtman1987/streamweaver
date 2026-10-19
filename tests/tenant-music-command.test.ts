import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTenantMusicCommand } from '../src/services/tenant-music-command';
import { readFileSync } from 'node:fs';

test('tenant skip calls its music control once and emits one success reply', async () => {
 const sent: any[] = [], replies: string[] = [];
 assert(await handleTenantMusicCommand({message:'!skip',tenantId:'fatkid',username:'mod',userId:'1',canControl:true,isBroadcaster:false,
 execute:async p=>{sent.push(p);return {session:{current:{item:{title:'Next'}}}}}, reply:async t=>{replies.push(t)}}));
 assert.equal(sent.length,1);assert.equal(sent[0].sessionId,'watch-twitch-fatkid-music');assert.equal(sent[0].streamMode,'twitch');
 assert.equal(sent[0].control,'next');assert.equal(replies.length,1);assert.match(replies[0],/Now playing: Next/);assert(!/lounge|failed/i.test(replies[0]));
});
test('tenant commands cannot control movies and unauthorized viewers cannot skip', async () => {
 let calls=0;const replies:string[]=[];
 const input={tenantId:'fatkid',username:'viewer',userId:'2',canControl:false,isBroadcaster:false,execute:async()=>{calls++;return{}},reply:async(t:string)=>{replies.push(t)}};
 await handleTenantMusicCommand({...input,message:'!skip'});
 await handleTenantMusicCommand({...input,message:'!wr a movie'});
 assert.equal(calls,0);assert.equal(replies.length,2);
});
test('playlist and volume stay in the originating stream; failure replies are singular', async () => {
 const sent:any[]=[],replies:string[]=[];
 const input={tenantId:'fatkid',username:'owner',userId:'3',canControl:true,isBroadcaster:true,execute:async(p:any)=>{sent.push(p);return {playlist:{enabled:true,title:'Backup',count:12}}},reply:async(t:string)=>{replies.push(t)}};
 await handleTenantMusicCommand({...input,message:'!playlist https://www.youtube.com/playlist?list=PL1234567890'});
 await handleTenantMusicCommand({...input,message:'!volume 25'});
 assert.equal(sent[0].action,'hmo.media.playlist');assert.equal(sent[0].control,'set');assert.equal(sent[1].control,'volume');assert.equal(sent[1].value,25);
 assert(sent.every(p=>p.sessionId==='watch-twitch-fatkid-music'));assert.equal(replies.length,2);
 replies.length=0;
 await handleTenantMusicCommand({...input,message:'!skip',execute:async()=>{throw Error('unavailable')}});
 assert.equal(replies.length,1);
});
test('tenant commands are consumed before legacy imported actions and lounge control code', () => {
 const source=readFileSync(new URL('../src/services/chat-dispatcher.ts',import.meta.url),'utf8');
 assert(source.indexOf('&& await handleTenantMusicCommand(') < source.indexOf('const hearMeOutCommand ='));
});

test('!play is silently consumed for every tenant without invoking the media action', async () => {
 const sent: any[] = [], replies: string[] = [];
 const handled = await handleTenantMusicCommand({
  message:'!play',tenantId:'the_lovely_princess_snow',username:'viewer',userId:'4',
  canControl:true,isBroadcaster:true,
  execute:async p=>{sent.push(p);return{}},reply:async t=>{replies.push(t)}
 });
 assert.equal(handled,true);assert.equal(sent.length,0);assert.equal(replies.length,0);
});
test('global dispatcher silently ignores !play before tenant and shared Lounge handlers', () => {
 const source=readFileSync(new URL('../src/services/chat-dispatcher.ts',import.meta.url),'utf8');
 assert(source.indexOf('!play may belong to another bot') < source.indexOf('await handleTenantMusicCommand('));
 assert(source.indexOf('!play may belong to another bot') < source.indexOf('const hearMeOutCommand ='));
 assert(!source.includes('!play is disabled globally.'));
});

test('!sr shuffle on/off/status controls shuffle in the tenant Twitch stream', async () => {
 const sent:any[]=[], replies:string[]=[];
 const input={tenantId:'fatkid',username:'owner',userId:'3',canControl:true,isBroadcaster:true,
  execute:async(p:any)=>{sent.push(p);return {playlist:{enabled:true,shuffleEnabled:p.control!=='shuffle-off',title:'Backup',count:12}};},
  reply:async(t:string)=>{replies.push(t)}};
 await handleTenantMusicCommand({...input,message:'!sr shuffle on'});
 await handleTenantMusicCommand({...input,message:'!sr shuffle off'});
 await handleTenantMusicCommand({...input,message:'!sr shuffle status'});
 assert.deepEqual(sent.map(p=>p.control),['shuffle-on','shuffle-off','shuffle-status']);
 assert(sent.every(p=>p.action==='hmo.media.playlist'&&p.sessionId==='watch-twitch-fatkid-music'));
 assert.match(replies[0],/ON/);assert.match(replies[1],/OFF/);assert.match(replies[2],/ON/);
});
