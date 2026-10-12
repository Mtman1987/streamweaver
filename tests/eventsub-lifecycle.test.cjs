const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
function fixture() {
 const sockets = [], timers = new Map(), subscriptions = [], alerts = [];
 let timerId = 0;
 class Socket extends EventEmitter {
  static OPEN = 1;
  constructor(url) { super(); this.url=url; this.readyState=1; sockets.push(this); }
  close() { this.readyState=3; this.emit('close',1000,Buffer.from('client disconnected')); }
 }
 const fetch = async (url, init={}) => {
  if(url.includes('/validate')) return {ok:true,json:async()=>({user_id:'1518834930',scopes:['moderator:read:followers']})};
  if(init.method==='POST') { subscriptions.push(JSON.parse(init.body)); return {ok:true,json:async()=>({data:[{id:'sub-'+subscriptions.length}]})}; }
  return {ok:true,json:async()=>({data:[]})};
 };
 const tokens={broadcasterToken:'fixture',broadcasterUsername:'fixture',twitchClientId:'fixture'};
 const mockRequire = name => {
  if(name==='ws') return {WebSocket:Socket};
  if(name.includes('token-utils')) return {getStoredTokens:async()=>tokens,ensureValidToken:async()=> 'fixture',isTwitchCredentialQuarantined:()=>false};
  if(name.includes('constants')) return {TIMEOUTS:{RECONNECT_MIN_DELAY:10000,RECONNECT_MAX_DELAY:60000}};
  if(name==='./follow-alert') return {publishFollowAlert:async input=>{alerts.push(input);return true}};
  return {};
 };
 const output=ts.transpileModule(fs.readFileSync('src/services/eventsub.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+output+'})',{
  console:{log(){},warn(){},error(){}},process:{env:{TWITCH_CLIENT_SECRET:'fixture'}},fetch,
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),
 })(mockRequire,mod,mod.exports);
 const message = async (socket, type, payload, id='event-id') => {
  const raw=JSON.stringify({metadata:{message_type:type,message_id:id},payload});
  await Promise.all(socket.listeners('message').map(listener=>listener(raw)));
 };
 return {sockets,timers,subscriptions,alerts,api:mod.exports,message};
}
test('replacing a socket cannot let the old close callback restart the new listener', async () => {
 const f=fixture();
 await f.api.startEventSub('1518834930');
 const old=f.sockets[0];
 await f.api.startEventSub('1518834930');
 assert.equal(f.sockets.length,2);
 assert.equal(old.readyState,3);
 assert.equal(f.timers.size,0);
 assert.equal(f.api.isEventSubConnected('1518834930'),true);
 old.emit('close',1000,Buffer.from('delayed close'));
 assert.equal(f.timers.size,0);
});
test('manual reconnect clears a genuine pending retry; simultaneous starts share one socket', async () => {
 const f=fixture();
 await Promise.all([f.api.startEventSub('1518834930'),f.api.startEventSub('1518834930')]);
 assert.equal(f.sockets.length,1);
 f.sockets[0].close();
 assert.equal(f.timers.size,1);
 await f.api.startEventSub('1518834930');
 assert.equal(f.timers.size,0);
 assert.equal(f.sockets.length,2);
});
test('Twitch session transfer keeps the old listener until welcome and does not recreate subscriptions', async () => {
 const f=fixture();
 await f.api.startEventSub('1518834930');
 const old=f.sockets[0];
 await f.message(old,'session_welcome',{session:{id:'session-first'}});
 assert.equal(f.subscriptions.length,1);
 await f.api.startEventSub('1518834930','wss://eventsub.wss.twitch.tv/ws?reconnect=fixture');
 const next=f.sockets[1];
 assert.equal(old.readyState,1);
 await f.message(next,'session_welcome',{session:{id:'session-next'}});
 assert.equal(old.readyState,3);
 assert.equal(f.subscriptions.length,1);
 assert.equal(f.timers.size,0);
});
test('real follow notifications queue the same tenant alert while unrelated or retired notifications do not', async () => {
 const f=fixture();
 await f.api.startEventSub('1518834930');
 const old=f.sockets[0];
 const payload={subscription:{type:'channel.follow'},event:{broadcaster_user_id:'1518834930',user_name:'New Friend'}};
 await f.message(old,'notification',payload);
 assert.equal(f.alerts.length,1);
 assert.equal(f.alerts[0].tenantId,'1518834930');
 assert.equal(f.alerts[0].follower,'New Friend');
 await f.message(old,'notification',{...payload,event:{...payload.event,broadcaster_user_id:'other'}});
 await f.api.startEventSub('1518834930');
 await f.message(old,'notification',payload);
 assert.equal(f.alerts.length,1);
});
