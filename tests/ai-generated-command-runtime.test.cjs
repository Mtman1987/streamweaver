const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(rel, mocks = {}) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, reportDiagnostics: true });
  assert.equal(output.diagnostics.length, 0);
  const mod = { exports: {} };
  const req = id => id in mocks ? mocks[id] : id.startsWith('node:') || ['crypto', 'fs', 'path'].includes(id) ? require(id) : {};
  vm.runInNewContext('(function(require,module,exports){'+output.outputText+'\n})', { console, process: { env: {} }, setTimeout, clearTimeout, fetch: async()=>{throw Error('Unexpected external call');} })(req, mod, mod.exports);
  return mod.exports;
}
const types = load('src/services/automation/types.ts');
const commandStore = new Map(), actionStore = new Map();
const fixture = [
 { type: 123, name: 'targetUser', value: '%rawInput%' },
 { type: 120, condition: '%targetUser% == ""', trueActions: [{type:'send-chat',message:'@%user% aim at someone'}],
 falseActions:[{type:'execute-code',language:'javascript',code:'await reply("@"+user+" kicks "+args.targetUser);',timeoutMs:100}] }
];
const builder=load('src/services/automation/ai-workflow-builder.ts',{
 '@/services/automation/types':types,
 '@/services/ai-provider':{getAIConfig:()=>({apiKey:'test-fixture'}),generateAIResponse:async()=>JSON.stringify({assistantMessage:'draft',automation:{name:'Kick',command:{command:'!testkick'},triggers:[],subActions:fixture}})},
 '@/ai/flows/generate-flow-node':{generateFlowNode:async()=>({subtype:'send-chat',data:{message:'draft'}})},
 '@/lib/runtime-origin':{getInternalAppUrl:()=> 'http://localhost'},
 '@/lib/commands-store':{getAllCommands:async()=>[...commandStore.values()],createCommand:async c=>{const v={...c,id:'test-command'};commandStore.set(v.id,v);return v;},updateCommand:async(id,d)=>Object.assign(commandStore.get(id),d),deleteCommand:async id=>commandStore.delete(id)},
 '@/lib/actions-store':{createAction:async a=>{const v={...a,id:'test-action'};actionStore.set(v.id,v);return v;},getAllActions:async()=>[...actionStore.values()],updateAction:async(id,d)=>Object.assign(actionStore.get(id),d),deleteAction:async id=>actionStore.delete(id)}
});
test('AI creation normalizes both nested branches, links export action, and preserves code review',async()=>{
 const made=await builder.createWorkflowFromPrompt({message:'create !testkick with random fun outcomes',tenantId:'fixture',userName:'owner'});
 assert.equal(made.command.actionId,made.action.id);
 assert.equal(made.action.triggers[0].commandId,made.command.id);
 assert.equal(made.requiresReview,true);
 assert.equal(made.action.enabled,false);
 assert.equal(made.action.subActions[0].variableName,'targetUser');
 const cond=made.action.subActions[1];
 assert.equal(cond.input,'%targetUser%');
 assert.equal(cond.operation,0);
 assert.equal(cond.subActions[0].subActions[0].type,10);
 assert.equal(cond.subActions[1].subActions[0].type,99999);
 assert.equal(cond.subActions[1].subActions[0].enabled,true);
});
test('unsupported AI condition and step type fail explicitly',()=>{
 assert.throws(()=>builder.normalizeGeneratedSubActions([{type:120,condition:'eval(mystery)'}]),/Unsupported condition/);
 assert.throws(()=>builder.normalizeGeneratedSubActions([{type:'imaginary-step'}]),/Unsupported automation/);
});
test('normalized action executes empty and targeted branches through the real executor',async()=>{
 const messages=[];
 const handlers=load('src/services/automation/subactions/SubActionHandlers.ts');
 const twitch=load('src/services/automation/subactions/TwitchHandlers.ts');
 const variableStore={listGlobalVariables:async()=>({}),listUserVariables:async()=>({})};
 const executorModule=load('src/services/automation/SubActionExecutor.ts',{
 './types':types,'./subactions/SubActionHandlers':handlers,'./subactions/TwitchHandlers':twitch,
 '@/lib/automation-variables-store':variableStore,
 '@/services/twitch':{sendChatMessage:async(text,as,channel,tenant)=>messages.push({text,channel,tenant})}
 });
 // Intercept the Twitch primitive's HTTP output; code output uses the mocked send function.
 const original=twitch.TwitchHandlers.handleTwitchSendMessage;
 twitch.TwitchHandlers.handleTwitchSendMessage=async(s,c)=>{
 messages.push({text:s.text.replace(/%user%/g,c.user).replace(/%targetUser%/g,c.variables.targetUser),tenant:c.tenantId});
 return {success:true};
 };
 const steps=builder.normalizeGeneratedSubActions(fixture);
 for(const raw of ['', '@target']){
  const ctx={user:'viewer',userName:'viewer',tenantId:'fixture',args:{rawInput:raw},variables:{rawInput:raw,user:'viewer',channel:'fixture-channel'}};
  assert.equal(await new executorModule.SubActionExecutor().executeAction({subActions:steps},ctx),true);
 }
 assert.equal(messages.length,2);
 assert.equal(messages[0].text,'@viewer aim at someone');
 assert.equal(messages[1].text,'@viewer kicks @target');
 assert.equal(messages[1].tenant,'fixture');
 assert.equal(messages[1].channel,'fixture-channel');
 twitch.TwitchHandlers.handleTwitchSendMessage=original;
});
test('roll route accepts missing amount and still delegates to the native wagering handler',()=>{
 const dispatcher=fs.readFileSync(path.join(root,'src/services/chat-dispatcher.ts'),'utf8');
 assert(dispatcher.includes('if (/^!roll(?:\\s|$)/i.test(actualMessage))'));
 assert(dispatcher.includes('const betInput = actualMessage.slice(5).trim();'));
 assert(dispatcher.includes('await handleRoll(actualUsername, betInput, userPoints, tenantId)'));
 for(const msg of ['!roll','!ROLL','!roll 100','!roll\t100']) assert(/^!roll(?:\s|$)/i.test(msg));
 assert(!/^!roll(?:\s|$)/i.test('!roller'));
});

test('direct condition children normalize into executable IF_BLOCK and mixed branches fail clearly',()=>{
 const steps=builder.normalizeGeneratedSubActions([{type:120,input:'%rawInput%',operation:7,subActions:[{type:'send-chat',message:'saved'}]}]);
 assert.equal(steps[0].subActions[0].type,99901);
 assert.equal(steps[0].subActions[0].subActions[0].text,'saved');
 assert.throws(()=>builder.normalizeGeneratedSubActions([{type:120,input:'%rawInput%',subActions:[{type:'if-block',subActions:[]},{type:'send-chat',message:'bad'}]}]),/Do not mix/);
});
