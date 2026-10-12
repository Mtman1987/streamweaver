
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let testRoot:string; test.before(async()=>{testRoot=await mkdtemp(path.join(os.tmpdir(),'sw-loyalty-suite-'));process.env.PERSIST_ROOT=testRoot;}); test.after(async()=>rm(testRoot,{recursive:true,force:true}));
import { parseLoyaltyImport } from '../src/services/loyalty-import-parser';

test('CSV and JSON normalize users, exact balances, explicit units and duplicate maxima',()=>{
  assert.deepEqual(parseLoyaltyImport('User,Points,Watchtime\r\n"@Viewer","1,200",120\r\nviewer,900,180','seconds').rows,
    [{username:'viewer',points:'1200',watchMinutes:3}]);
  assert.deepEqual(parseLoyaltyImport(JSON.stringify({users:[{username:'A',points:'999999999999999999999',hours:1.5},{username:'b',minutes:7}]}),'seconds').rows,
    [{username:'a',points:'999999999999999999999',watchMinutes:90},{username:'b',watchMinutes:7}]);
  assert.deepEqual(parseLoyaltyImport('username,points,minutes\nv, ,1\nv,0,','minutes').rows,[{username:'v',points:'0',watchMinutes:1}]);
  for (const value of ['username,points\nv,-1','username,watchtime\nv,nope','username,points\nv,1\nbad name,2','username,points\nv,"1'])
    assert.throws(()=>parseLoyaltyImport(value,'minutes'));
  assert.throws(()=>parseLoyaltyImport('[{"username":"v","points":9007199254740992}]','minutes'));
  assert.deepEqual(parseLoyaltyImport('username,points\nv,1200.0\nw,"1,200"','minutes').rows,
    [{username:'v',points:'1200'},{username:'w',points:'1200'}]);
  const badPoints='username,points,watchtime\nviewer,not-a-number,120\nsecond,also-bad,90';
  assert.deepEqual(parseLoyaltyImport(badPoints,'minutes','watchtime').rows,[{username:'viewer',watchMinutes:120},{username:'second',watchMinutes:90}]);
  assert.deepEqual(parseLoyaltyImport('username,points,watchtime\nviewer,1,invalid','minutes','points').rows,[{username:'viewer',points:'1'}]);
  assert.throws(()=>parseLoyaltyImport(badPoints,'minutes','all'),/invalid points/);
});

test('tracker authenticates each tenant, deduplicates users, and isolates a failed channel',async()=>{
  const {runWatchtimeTracker}=await import('../src/services/watchtime-tracker');
  const calls:any[]=[]; const urls:string[]=[]; const warn=console.warn; console.warn=()=>{};
  try { await runWatchtimeTracker(3000,{
    listTenants:async()=>['a','broken','b'],
    getStoredTokens:async(id:string)=>({broadcasterUsername:id.toUpperCase()}) as any,
    internalServiceHeaders:()=>({'x-internal-token':'test'}) as any,
    fetch:async(url:any,options:any)=>{
      urls.push(String(url)); assert.equal(options.headers['x-internal-token'],'test');
      return Response.json(String(url).includes('tenant=broken') ? {error:'denied'} : {chatters:[{user_login:'Viewer'},{user_login:'viewer'}]}, {status:String(url).includes('tenant=broken')?401:200});
    },
    incrementWatchtime:async(...args:any[])=>{calls.push(args);}
  } as any); } finally {console.warn=warn;}
  assert.equal(urls.length,3);
  assert.deepEqual(calls,[[['viewer'],'a',{tenantId:'a',username:'a'}],[['viewer'],'b',{tenantId:'b',username:'b'}]]);
});

test('import is tenant scoped, backed up, preserves higher totals, and does not replay spent points',async()=>{
  const root=testRoot;
  try {
    const points=await import('../src/services/points');
    const stats=await import('../src/services/user-stats');
    const importer=await import('../src/services/loyalty-import');
    const a={tenantId:'import-a',username:'channel_a'}, b={tenantId:'import-b',username:'channel_b'};
    await points.setPoints('viewer',500,a);
    await points.setPoints('viewer',700,b);
    await stats.incrementWatchtime(['viewer'],'channel_b',b);
    const csv='username,points,watchtime\nViewer,1000,120\nconstructor,10,2';
    const preview=await importer.previewLoyaltyImport(csv,'minutes',a);
    assert.equal(preview.changed,2); assert.equal(preview.channel,'channel_a');
    await assert.rejects(importer.applyLoyaltyImport(csv,'minutes','wrong',a));
    const result=await importer.applyLoyaltyImport(csv,'minutes',preview.digest,a);
    assert.equal(result.imported,2);
    assert.equal((await points.getPoints('viewer',a)).pointsRaw,'1000');
    assert.equal((await stats.getUser('@VIEWER',a)).watchtime,120);
    assert.equal((await points.getPoints('constructor',a)).pointsRaw,'10');
    assert.equal((await stats.getUser('constructor',a)).watchtime,2);
    assert.equal((await points.getPoints('viewer',b)).pointsRaw,'700');
    assert.equal((await stats.getUser('viewer',b)).watchtime,1);
    // Storage layout is owned by storage.ts; locate receipt/backup below tenant.
    async function walk(dir:string):Promise<string[]> { const out:string[]=[]; for(const entry of await readdir(dir,{withFileTypes:true})) { const f=path.join(dir,entry.name);out.push(...(entry.isDirectory()?await walk(f):[f])); }return out; }
    const backupPath=(await walk(path.join(root,'tenants','import-a'))).find(f=>f.endsWith('loyalty-import-'+result.backupId+'.json'))!;
    assert.equal(JSON.parse(await readFile(backupPath,'utf8')).points.viewer.points,'500');
    await points.addPoints('viewer',-100,'spend',a);
    assert.equal((await importer.previewLoyaltyImport(csv,'minutes',a)).alreadyImported,true);
    assert.equal((await importer.applyLoyaltyImport(csv,'minutes',preview.digest,a)).imported,0);
    assert.equal((await points.getPoints('viewer',a)).pointsRaw,'900');
    await Promise.all(Array.from({length:10},()=>points.addPoints('viewer',1,'concurrent',a)));
    assert.equal((await points.getPoints('viewer',a)).pointsRaw,'910');
    await stats.incrementWatchtime(['viewer'],'channel_a',a);
    assert.equal((await stats.getUser('viewer',a)).watchtime,121);
    const statsPath=path.join(root,'tenants','import-a','data','user-stats.json');
    const raw=JSON.parse(await readFile(statsPath,'utf8')); raw.viewer.watchtimeByChannel.channel_a=130;raw.viewer.watchtime=130;
    await writeFile(statsPath+'.external',JSON.stringify(raw));await rename(statsPath+'.external',statsPath);
    assert.equal((await stats.getUser('VIEWER',a)).watchtime,130);
    const lower='username,points,watchtime\nviewer,10,2';
    await importer.applyLoyaltyImport(lower,'minutes',parseLoyaltyImport(lower,'minutes').digest,a);
    assert.equal((await points.getPoints('viewer',a)).pointsRaw,'910');
    assert.equal((await stats.getUser('viewer',a)).watchtime,130);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('import API rejects unauthenticated writes',async()=>{
 const {POST}=await import('../src/app/api/import/loyalty/route');
 const {NextRequest}=await import('next/server');
 const response=await POST(new NextRequest('http://localhost/api/import/loyalty',{method:'POST',body:JSON.stringify({action:'apply',tenantId:'victim',text:'username,points\nv,1',unit:'minutes'})}));
 assert.equal(response.status,401);
});


test('Twitch tracking requires auth, skips offline streams and follows every page without avatar requests',async()=>{
 const vm=await import('node:vm'); const ts=await import('typescript');
 const source=await readFile(path.join(process.cwd(),'src/app/api/chat/chatters/route.ts'),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let auth=true,live=true,repeated=false; let pages=0;const urls:string[]=[];
 const mocks:Record<string,any>={
 'next/server':{},
 '@/lib/token-utils.server':{getStoredTokens:async()=>({}),ensureValidToken:async()=> 'fake-token',isTwitchAuthFailure:()=>false},
 '@/lib/tenant-context':{getTenantFromRequest:()=>auth?{tenantId:'a'}:null},
 '@/lib/api-response':{apiOk:(v:any)=>Response.json(v),apiError:(error:string,options:any)=>Response.json({error},{status:options.status})},
 '@/lib/local-config/service':{initializeLocalConfig:async()=>{},getConfigSection:async()=>({clientId:'fake-client',clientSecret:'fake-secret'})},
 '@/lib/internal-service-auth':{hasInternalServiceAccess:()=>false}
 };
 const exports:any={};
 vm.runInNewContext(js,{exports,require:(name:string)=>mocks[name],URL,AbortSignal,console,
 fetch:async(url:string)=>{
  urls.push(String(url));
  if(String(url).includes('/validate'))return Response.json({user_id:'123'});
  if(String(url).includes('/streams?'))return Response.json({data:live?[{id:'live'}]:[]});
  if(String(url).includes('/chat/chatters?')){pages++;assert.equal(new URL(url).searchParams.get('first'),'1000'); return Response.json({data:[{user_login:'viewer'+pages}],pagination:pages===1||repeated?{cursor:'next'}:{}});}
  throw new Error('Unexpected avatar request');
 }});
 const request={nextUrl:new URL('http://localhost/api/chat/chatters?tenant=victim&tracking=1')};
 auth=false;assert.equal((await exports.GET(request)).status,401);assert.equal(urls.length,0);
 auth=true;live=false;assert.deepEqual(await (await exports.GET(request)).json(),{chatters:[],live:false});assert.equal(pages,0);
 live=true;assert.deepEqual(await (await exports.GET(request)).json(),{chatters:[{user_login:'viewer1'},{user_login:'viewer2'}],live:true});assert.equal(pages,2);
 pages=0;repeated=true;assert.equal((await exports.GET(request)).status,502);
});
