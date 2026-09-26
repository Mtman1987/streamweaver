const NEBULA_URL = String(process.env.NEBULA_ARCADE_BASE_URL || process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
function secret(){ return String(process.env.CHAT_TAG_SECRET || process.env.BOT_SECRET_KEY || '').trim(); }
async function call(path:string, init:RequestInit={}){
  const token=secret(); if(!token) throw new Error('Nebula service secret is not configured.');
  const response=await fetch(NEBULA_URL+path,{...init,headers:{'content-type':'application/json','x-bot-secret':token,...(init.headers||{})},signal:typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
  const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body?.error||('Nebula returned HTTP '+response.status)); return body;
}
export async function executeNebulaCommand(input:{channel:string;username:string;userId?:string;displayName?:string;message:string}){
 return call('/api/game-hub/command',{method:'POST',body:JSON.stringify({...input,isBroadcaster:true,isModerator:true,source:'streamweaver-bot-action'})});
}
export async function manageNebulaOverlay(input:{operation:'list'|'create'|'update';channel:string;id?:string;name?:string;gameIds?:string[];layout?:string;transparent?:boolean}){
 if(input.operation==='list') return call('/api/game-hub/bot-overlays?channel='+encodeURIComponent(input.channel));
 const method=input.operation==='create'?'POST':'PATCH'; return call('/api/game-hub/bot-overlays',{method,body:JSON.stringify(input)});
}
