const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('real Twitch dispatcher lets ordinary viewers save and repeated users replay raid aliases without loading commands', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-raid-dispatch-'));
 process.env.PERSIST_ROOT = root;
 const raid = await import('../src/services/raid-message.ts');
 const source = fs.readFileSync('src/services/chat-dispatcher.ts','utf8');
 const ast = ts.createSourceFile('chat.ts',source,ts.ScriptTarget.Latest,true);
 const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleTwitchMessage');
 assert(fn);
 const js = ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const replies=[];
 const context = {
  exports:{},console,process:{env:{}},global:{},Date,Map,Set,
  getTenantIdFromChannel:()=> 'fixture',
  handleBotWakeCommand:async()=>false,isSharedBotAwake:async()=>true,setSharedBotAwake:async()=>{},
  SPACEMOUNTAIN_SYSTEM_TENANT_ID:'system',SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL:'spacemountainlive',
  sendChatMessage:async(text,as,channel,tenant)=>replies.push({text,channel,tenant}),
  processedMessages:new Set(),
  consumeLoungeCommandMenuChoice:()=>null,
  rewriteSpmtLegacyAlias:()=>null,
  detectMtFixItIntent:()=>({matched:false}),consumePendingMtSupportRequest:()=>false,
  isTheCountTwitchLogin:()=>false,isConfirmedLoungeStellaShoutout:()=>false,
  isKnownBot:async()=>false,isConfiguredTwitchBotUsername:async()=>false,isLoreBotUsername:async()=>false,
  appendPublicChatMessages:async()=>{},VERBOSE_LOGS:false,
  getAllCommands:()=>{throw Error('Raid must not depend on configured commands');},
  require:(id)=>{
   if(id==='./raid-message')return raid;
   if(id==='../lib/user-config')return {readUserConfigSync:()=>({})};
   if(id==='fs')return {existsSync:()=>false};
   if(id==='path')return path;
   if(id==='../lib/tenant')return {tenantPath:(t,f)=>path.join(root,t,f),communityBotTokensPath:()=>path.join(root,'none')};
   throw Error('Unexpected dependency: '+id);
  },
 };
 vm.runInNewContext(js,context);
 const handle=context.exports.handleTwitchMessage;
 const tags=(id,user)=>({id,username:user,'display-name':user,mod:'0',badges:{},'room-id':'fixture'});
 try {
  await handle('#fixture',tags('1','viewer'),'!raid Open clan message',false);
  await handle('#fixture',tags('2','viewer'),'!raid',false);
  await handle('#fixture',tags('3','viewer'),'!raid',false);
  await handle('#fixture',tags('4','anotherViewer'),'!raidmessage',false);
  await handle('#fixture',{...tags('5','fixture'),badges:{broadcaster:'1'}},'!raidmessage',true);
  assert.equal(replies.length,5);
  assert.match(replies[0].text,/saved/);
  for(const reply of replies.slice(1)) {
   assert.equal(reply.text,'Open clan message');
   assert.equal(reply.tenant,'fixture');
   assert.equal(reply.channel,'fixture');
  }
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
