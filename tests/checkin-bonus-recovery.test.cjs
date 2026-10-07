const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const input={awardId:'a'.repeat(64),channel:'host',username:'alice',userId:'123',displayName:'Alice'};
async function fixture(t,award){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'checkin-outbox-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const tenantPath=(id,file)=>path.join(root,'tenants',id,file),globalPath=file=>path.join(root,'global',file);
 await fs.mkdir(path.join(root,'tenants'),{recursive:true});
 const notices=[];
 const load=async()=>{const m={exports:{}};const src=await fs.readFile('src/services/checkin-bonus-recovery.ts','utf8');
 vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:id=>{
 if(id==='../lib/tenant')return{tenantPath,tenantRoot:id=>path.join(root,'tenants',id),globalPath};
 if(id==='../lib/token-utils.server')return{getStoredTokens:async()=>({broadcasterUsername:'host'})};
 if(id==='./twitch')return{sendTwitchChatMessage:async message=>{notices.push(message);}};
 if(id==='./twitch-client')return{getTenantIdFromChannel:()=> 'host'};
 if(id==='./nebula-actions')return{awardNebulaCheckinBonus:award};return require(id);
 },console:{info(){},warn(){},error(){}},setInterval,Date});return m.exports;};
 const receipt=tenantPath('host','data/chat-tag-checkins/'+input.awardId+'.json');await fs.mkdir(path.dirname(receipt),{recursive:true});
 return{root,load,receipt,notices};
}
test('lost response and process restart recover the original award exactly once and confirm its receipt',async t=>{
 let balance=0,calls=0;const ids=[];
 const f=await fixture(t,async value=>{ids.push(value.awardId);if(++calls===1){balance+=100;throw Error('response lost after commit');}return{amount:100,balance,currency:'nebula',duplicate:true};});
 await fs.writeFile(f.receipt,JSON.stringify({reply:'Ride! (Nebula bonus could not be confirmed)',payload:{kind:'space-mountain',frontSeatBonusStatus:'unconfirmed'}}));
 const before=await f.load();await before.rememberPendingCheckinBonus(input,'host');
 const now=Date.now()+61000;assert.equal(await before.recoverPendingCheckinBonuses(now),0);
 const restarted=await f.load();assert.equal(await restarted.recoverPendingCheckinBonuses(now+61000),1);
 const saved=JSON.parse(await fs.readFile(f.receipt,'utf8'));assert.equal(saved.payload.frontSeatBonusPoints,100);assert.equal(saved.payload.frontSeatBonusStatus,'credited');assert.doesNotMatch(saved.reply,/unconfirmed|could not/);
 assert.deepEqual(f.notices,['@alice earned +100 Nebula points for the front seat!']);
 assert.equal(balance,100);assert.deepEqual(ids,[input.awardId,input.awardId]);assert.equal(await restarted.recoverPendingCheckinBonuses(now+122000),0);
});
test('a pending HTTP receipt retains the durable award until the complete receipt can be updated',async t=>{
 const f=await fixture(t,async()=>({amount:100,balance:100,currency:'nebula',duplicate:false}));const api=await f.load();
 const task=await api.rememberPendingCheckinBonus(input,'host');await fs.writeFile(f.receipt,JSON.stringify({pending:true}));
 await api.completePendingCheckinBonus(task,{amount:100,balance:100,currency:'nebula',duplicate:false});assert.ok(await fs.stat(task));
 await fs.writeFile(f.receipt,JSON.stringify({payload:{kind:'space-mountain',frontSeatBonusStatus:'unconfirmed'}}));
 await api.completePendingCheckinBonus(task,{amount:100,balance:100,currency:'nebula',duplicate:true});await assert.rejects(fs.stat(task),{code:'ENOENT'});
});
test('saved award IDs cannot be reused for a different rider',async t=>{
 const f=await fixture(t,async()=>{throw Error('no wallet call');});const api=await f.load();await api.rememberPendingCheckinBonus(input,'host');
 await assert.rejects(api.rememberPendingCheckinBonus({...input,username:'bob'},'host'),/another rider/);
});
test('startup recovers previous failed check-ins stored under channel-name folders',async t=>{
 let called;const f=await fixture(t,async value=>{called=value;return{amount:100,balance:100,currency:'nebula',duplicate:false};});
 await fs.writeFile(f.receipt,JSON.stringify({payload:{kind:'space-mountain',frontSeatBonusStatus:'unconfirmed',frontSeat:'Alice',entry:{twitchLogin:'alice',twitchUserId:'123'}}}));
 const api=await f.load();await api.restoreUnfinishedCheckinBonuses();assert.equal(await api.recoverPendingCheckinBonuses(),1);assert.equal(called.awardId,input.awardId);assert.equal(called.channel,'host');
});
