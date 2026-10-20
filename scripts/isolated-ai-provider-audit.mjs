#!/usr/bin/env node
// Isolated, read-only provider probes. Never logs keys, headers, prompts, or raw provider bodies.
import fs from 'node:fs';

const timeoutMs = 15000;
const results = [];
const hasKey = (name) => Boolean(String(process.env[name] || '').trim());
const redactCategory = (status, body = '') => {
  const s = String(body).toLowerCase();
  if (status === 401 || status === 403) return 'auth_or_permission';
  if (status === 429 || /rate.?limit|quota|too many requests/.test(s)) return 'rate_or_quota';
  if (status === 404 || /model.*not found|unknown model/.test(s)) return 'model_or_endpoint';
  if (status >= 500) return 'provider_server_error';
  return 'request_rejected';
};

async function probeChat({provider, credential, key, url, model, format = 'openai'}) {
  if (!String(key || '').trim()) {
    results.push({provider, credential, kind:'chat', status:'not_configured'});
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    let response;
    if (format === 'gemini') {
      const endpoint = url + '?key=' + encodeURIComponent(key);
      response = await fetch(endpoint, {
        method:'POST', signal:controller.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:'Reply with exactly: OK'}]}],generationConfig:{maxOutputTokens:12,temperature:0}})
      });
    } else {
      response = await fetch(url, {
        method:'POST', signal:controller.signal,
        headers:{'authorization':'Bearer '+key,'content-type':'application/json'},
        body:JSON.stringify({model,messages:[{role:'user',content:'Reply with exactly: OK'}],max_tokens:12,temperature:0,stream:false})
      });
    }
    const body = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const content = format === 'gemini'
      ? parsed?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim()
      : parsed?.choices?.[0]?.message?.content;
    results.push({
      provider, credential, kind:'chat',
      status: response.ok && typeof content === 'string' && content.length > 0 ? 'pass' : 'fail',
      httpStatus: response.status, category: response.ok ? (content ? undefined : 'empty_or_unexpected_response') : redactCategory(response.status, body),
      model, elapsedMs:Date.now()-started, outputVerified:Boolean(response.ok && typeof content === 'string' && content.trim())
    });
  } catch (e) {
    results.push({provider,credential,kind:'chat',status:'fail',category:e?.name==='AbortError'?'timeout':'network_or_parse_error',elapsedMs:Date.now()-started});
  } finally { clearTimeout(timer); }
}

async function probePollinationsImage() {
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent('simple blue circle on plain white background') + '?width=256&height=256&nologo=true&seed=846291';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  const started = Date.now();
  try {
    const response = await fetch(url,{signal:controller.signal,redirect:'follow'});
    const contentType = String(response.headers.get('content-type')||'').toLowerCase();
    const bytes = await response.arrayBuffer();
    results.push({provider:'pollinations',credential:'public_no_key',kind:'image',status:response.ok && contentType.startsWith('image/') && bytes.byteLength > 1000 ? 'pass':'fail',httpStatus:response.status,contentType:contentType.split(';')[0],bytes:bytes.byteLength,elapsedMs:Date.now()-started,outputVerified:response.ok && contentType.startsWith('image/') && bytes.byteLength > 1000});
  } catch(e) {
    results.push({provider:'pollinations',credential:'public_no_key',kind:'image',status:'fail',category:e?.name==='AbortError'?'timeout':'network_or_provider_error',elapsedMs:Date.now()-started});
  } finally { clearTimeout(timer); }
}

const specs = [
  {provider:'gemini',credential:'GEMINI_API_KEY',key:process.env.GEMINI_API_KEY,format:'gemini',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',model:'gemini-2.5-flash'},
  {provider:'gemini',credential:'GOOGLE_GENAI_API_KEY',key:process.env.GOOGLE_GENAI_API_KEY,format:'gemini',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',model:'gemini-2.5-flash'},
  {provider:'groq',credential:'GROQ_API_KEY',key:process.env.GROQ_API_KEY,url:'https://api.groq.com/openai/v1/chat/completions',model:process.env.GROQ_MODEL||'openai/gpt-oss-20b'},
  {provider:'nvidia',credential:'NVIDIA_API_KEY',key:process.env.NVIDIA_API_KEY,url:'https://integrate.api.nvidia.com/v1/chat/completions',model:process.env.NVIDIA_NIM_MODEL||'openai/gpt-oss-20b'},
  {provider:'nvidia',credential:'NVIDIA_2_API_KEY',key:process.env.NVIDIA_2_API_KEY,url:'https://integrate.api.nvidia.com/v1/chat/completions',model:process.env.NVIDIA_NIM_MODEL||'openai/gpt-oss-20b'},
  {provider:'cerebras',credential:'CEREBRAS_API_KEY',key:process.env.CEREBRAS_API_KEY,url:'https://api.cerebras.ai/v1/chat/completions',model:process.env.CEREBRAS_MODEL||'gpt-oss-120b'},
  {provider:'openrouter',credential:'OPENROUTER_API_KEY',key:process.env.OPENROUTER_API_KEY,url:'https://openrouter.ai/api/v1/chat/completions',model:(process.env.OPENROUTER_MODEL||'openrouter/free').trim()},
  {provider:'mistral',credential:'MISTRAL_API_KEY',key:process.env.MISTRAL_API_KEY,url:'https://api.mistral.ai/v1/chat/completions',model:process.env.MISTRAL_MODEL||'mistral-small-latest'},
];

for (const spec of specs) await probeChat(spec);
await probePollinationsImage();

const report = {title:'Isolated AI provider credential audit',generatedAt:new Date().toISOString(),scope:'external API probes only; no app/runtime changes',results};
fs.writeFileSync('provider-audit-results.json',JSON.stringify(report,null,2)+'\n');
for (const r of results) {
  const extra = [r.httpStatus ? 'HTTP '+r.httpStatus : '',r.category||'',r.model||'',r.elapsedMs != null ? r.elapsedMs+'ms':''].filter(Boolean).join(' | ');
  console.log([r.status.toUpperCase(),r.kind,r.provider,r.credential,extra].filter(Boolean).join(' | '));
}
console.log('Summary: '+results.filter(r=>r.status==='pass').length+' passed; '+results.filter(r=>r.status==='fail').length+' failed; '+results.filter(r=>r.status==='not_configured').length+' credentials not configured in this runner.');
