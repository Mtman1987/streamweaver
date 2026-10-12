const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
test('follow subscription uses Twitch v2 conditions and retires only the replaced broadcaster follow', async () => {
 const calls=[];
 const fetch=async(url,options={})=>{
  calls.push({url,options});
  if(options.method==='POST') return {ok:true,json:async()=>({data:[{id:'new'}]})};
  if(options.method==='DELETE')return {ok:true};
  return {ok:true,json:async()=>({data:[
   {id:'new',type:'channel.follow',condition:{broadcaster_user_id:'1518834930'}},
   {id:'old',type:'channel.follow',condition:{broadcaster_user_id:'1518834930'}},
   {id:'other',type:'channel.follow',condition:{broadcaster_user_id:'other'}},
   {id:'redemption',type:'channel.channel_points_custom_reward_redemption.add',condition:{broadcaster_user_id:'1518834930'}}
  ]})};
 };
 const source=fs.readFileSync('src/services/eventsub.ts','utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+output+'})',{console,process:{env:{}},fetch,setTimeout,clearTimeout})(
  ()=>({}),mod,mod.exports);
 await mod.exports.createFollowSubscription({clientId:'fixture',accessToken:'fixture',broadcasterId:'1518834930'},'session-fixture');
 const body=JSON.parse(calls[0].options.body);
 assert.deepEqual(body,{type:'channel.follow',version:'2',condition:{broadcaster_user_id:'1518834930',moderator_user_id:'1518834930'},transport:{method:'websocket',session_id:'session-fixture'}});
 assert.deepEqual(calls.filter(c=>c.options.method==='DELETE').map(c=>new URL(c.url).searchParams.get('id')),['old']);
});
