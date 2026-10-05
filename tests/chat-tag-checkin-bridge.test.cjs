const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file, req, globals = {}) {
  const m = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText, {module:m,exports:m.exports,require:req,console,process,Date,Set,Map,Math,global:{},fetch:()=>{throw Error('Unexpected OAuth call');},...globals});
  return m.exports;
}
test('Chat Tag candidates use the existing Discord intersection without broadcaster OAuth', async () => {
  const source=load('src/services/checkin-sources.ts', id=>{
    if(id.includes('local-config'))return {getConfigSection:async()=>({})};
    if(id==='./known-bots')return {isKnownBot:async name=>name==='robot'};
    if(id==='./discord-stream-hub')return {getDiscordStreamHubDefaultGuildId:async()=> 'guild',getDiscordStreamHubCheckinMembers:async()=>[{twitchLogin:'alice'},{twitchLogin:'robot'}]};
    if(id.includes('token-utils'))return {getStoredTokens:()=>{throw Error('OAuth must not be required');}};
    return {};
  });
  const result=await source.spaceMountainSourceFromChatters([
    {login:'alice',name:'Alice',userId:'1'},{login:'outsider',name:'Outsider',userId:'2'},{login:'robot',name:'Robot',userId:'3'},
  ], 'player_channel');
  assert.deepEqual(Array.from(result.entries,x=>x.name),['Alice']);assert.equal(result.selectionMode,'bulk');
  assert.equal(result.entries[0].twitchLogin,'alice');
});
for (const confirmed of [true, false])
test(`shared check-in credits the Nebula wallet and only announces confirmed credit: ${confirmed}`, async () => {
  let delivered='', recorded=0, bonus=0;
  const flow=load('src/services/checkin-flow.ts',id=>{
    if(id==='node:crypto')return require(id);
    if(id==='./nebula-actions')return {awardNebulaCheckinBonus:async input=>{
      assert.equal(input.awardId,'stable-checkin');assert.equal(input.channel,'player_channel');
      assert.equal(input.username,'alice');assert.equal(input.userId,'1');
      if(!confirmed)throw Error('Nebula unavailable');
      bonus+=100;return {amount:100,balance:420,currency:'nebula'};
    }};
    if(id==='./twitch')return {sendChatMessage:()=>{throw Error('Chat Tag owns delivery');}};
    if(id==='./checkin-stats')return {recordDetailedCheckin:()=>{recorded++;return {entryTotal:1}}};
    if(id==='./checkin-sources')return {getCheckinSource:()=>{throw Error('Must use observed chat candidates');}};
    if(id.includes('token-utils'))return {getStoredTokens:async()=>null};
    if(id==='./points')throw Error('The front-seat bonus must never write StreamWeaver points');
    if(id==='./ai-provider')return {generateAIResponse:async()=> 'Alice, take the front seat!'};
    if(id.includes('bot-settings'))return {getBotName:()=> 'Stella',getBotPersonality:()=> ''};
    if(id.includes('checkin-overlay-state'))return {createCheckinOverlayEvent:(type,payload)=>({type,payload}),rememberCheckinOverlayEvent:()=>{}};
    if(id.includes('/tenant'))return {SPACEMOUNTAIN_SYSTEM_TENANT_ID:'spacemountainlive'};
    return {};
  });
  const result=await flow.runBulkCheckin('space-mountain','alice',0,'player_channel',{
    source:{entries:[{id:1,key:'space-mountain:1',name:'Alice',imageUrl:'',twitchUserId:'1'}],sourceLabel:'Space Mountain Riders'},
    awardId:'stable-checkin',channel:'player_channel',
    deliver:async text=>{delivered=text},
  });
  assert.equal(recorded,1);assert.equal(bonus,confirmed?100:0);assert.equal(result.payload.frontSeat,'Alice');assert.equal(result.reply,delivered);assert.match(delivered,/Riders: 1/);
  assert.equal(result.payload.frontSeatBonusPoints,confirmed?100:0);
  if(confirmed){assert.match(delivered,/100 Nebula points/);assert.match(delivered,/Nebula balance: 420/);}
  else{assert.match(delivered,/could not be confirmed/);assert.doesNotMatch(delivered,/100/);}
});
test('empty membership produces an explicit result without awarding points', async () => {
  const flow=load('src/services/checkin-flow.ts',()=>({}));
  let delivered='';
  const result=await flow.runBulkCheckin('space-mountain','alice',0,'host',{source:{entries:[]},deliver:async text=>{delivered=text}});
  assert.match(result.reply,/no eligible/);assert.equal(delivered,result.reply);
});

for (const [nativeStatus, chatStatus] of [['sent', 'sent'], ['cooldown', 'sent'], ['unavailable', 'sent'], ['sent', 'not-sent']])
test(`service bridge deduplicates both shoutouts and isolates failures: ${nativeStatus}/${chatStatus}`, async () => {
  let authorized=false,calls=0,shoutouts=0,chatShoutouts=0;
  const receipts=new Map();
  const bridge=load('src/app/api/internal/chat-tag/checkin/route.ts',id=>{
    if(id==='zod')return require('zod');
    if(id==='node:crypto')return require(id);
    if(id==='node:path')return require(id);
    if(id==='node:fs')return {promises:{
      mkdir:async()=>{},
      open:async file=>{if(receipts.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});receipts.set(file,'');return {writeFile:async text=>receipts.set(file,text),close:async()=>{}}},
      readFile:async file=>receipts.get(file),writeFile:async(file,text)=>receipts.set(file,text),
    }};
    if(id.includes('api-response'))return {apiOk:body=>({status:200,body}),apiError:(error,o)=>({status:o.status,body:{error}})};
    if(id.includes('internal-service-auth'))return {hasInternalServiceAccess:()=>authorized};
    if(id==='@/lib/tenant')return {tenantPath:(tenant,file)=>tenant+'/'+file};
    if(id.includes('twitch-client'))return {getTenantIdFromChannel:()=>undefined};
    if(id.includes('local-config'))return {getConfigSection:async()=>({})};
    if(id.includes('checkin-sources'))return {spaceMountainSourceFromChatters:async candidates=>({entries:candidates})};
    if(id.includes('checkin-shoutout'))return {
      sendStellaCheckinShoutout:async channel=>{shoutouts++;assert.equal(channel,'player_channel');return {status:nativeStatus,channel,destination:'spacemountainlive',sender:'stellabot87'};},
      sendStellaCheckinChatShoutout:async channel=>{chatShoutouts++;assert.equal(channel,'player_channel');return {status:chatStatus,channel,destination:'spacemountainlive',sender:'stellabot87',messageId:chatStatus === 'sent' ? 'confirmed-message' : undefined};},
      formatCheckinShoutoutReply:()=> 'Stella sent the shoutout.',
      formatCheckinChatShoutoutReply:()=> chatStatus === 'sent' ? '' : 'Chat !so failed.',
    };
    if(id.includes('checkin-flow'))return {runBulkCheckin:async(kind,actor,cost,tenant,options)=>{calls++;assert.equal(tenant,'player_channel');assert.equal(options.source.entries[0].login,'alice');assert.equal(options.channel,'player_channel');assert.equal(options.awardId,require('node:crypto').createHash('sha256').update('player_channel:message-one').digest('hex'));return {reply:'Alice in front!',payload:{frontSeat:'alice'}};}};
    return {};
  });
  const req={json:async()=>({channel:'player_channel',username:'alice',requestId:'message-one',chatters:[{login:'alice',name:'Alice',userId:'1'}]})};
  assert.equal((await bridge.POST(req)).status,401);assert.equal(calls,0);assert.equal(shoutouts,0);assert.equal(chatShoutouts,0);
  authorized=true;
  const results=await Promise.all([bridge.POST(req),bridge.POST(req)]);
  assert.equal(results[0].body.reply,'Alice in front! Stella sent the shoutout.' + (chatStatus === 'sent' ? '' : ' Chat !so failed.'));assert.equal(calls,1);
  assert.equal(results[0].body.shoutout.status,nativeStatus);assert.equal(results[0].body.chatShoutout.status,chatStatus);
  assert.equal(results[1].body.duplicate,true);assert.equal(shoutouts,1);assert.equal(chatShoutouts,1);
  const duplicate=await bridge.POST(req);
  assert.equal(duplicate.body.duplicate,true);assert.equal(calls,1);assert.equal(shoutouts,1);assert.equal(chatShoutouts,1);
  assert.equal(duplicate.body.chatShoutout.status,chatStatus);
});

test('Nebula service retries a lost response with the same award identity and requires a wallet receipt', async () => {
  const input={awardId:'stable-award',channel:'host',username:'alice',userId:'1'};
  const calls=[];
  const service=load('src/services/nebula-actions.ts',()=>({}),{
    process:{env:{CHAT_TAG_SECRET:'test-only-service-secret'}},AbortSignal,
    fetch:async(url,init)=>{
      calls.push({url,body:JSON.parse(init.body)});
      if(calls.length===1)throw Error('Response lost after commit');
      return {ok:true,json:async()=>({ok:true,award:{...input,amount:100,balance:500,currency:'nebula',duplicate:true}})};
    },
  });
  const award=await service.awardNebulaCheckinBonus(input);
  assert.equal(award.balance,500);assert.equal(calls.length,2);
  assert.deepEqual(calls[0].body,calls[1].body);
  assert.match(calls[0].url,/\/api\/game-hub\/checkin-bonus$/);
  const bad=load('src/services/nebula-actions.ts',()=>({}),{
    process:{env:{CHAT_TAG_SECRET:'test-only-service-secret'}},AbortSignal,
    fetch:async()=>({ok:true,json:async()=>({ok:true})}),
  });
  await assert.rejects(bad.awardNebulaCheckinBonus(input),/did not confirm/);
});
