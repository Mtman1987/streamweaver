export type StellaChaosMode = 'chill' | 'normal' | 'playful' | 'chaos' | 'wtf-million';
let mode: StellaChaosMode = 'normal';
let intensity = 35;
export type StellaRoleMode = 'host' | 'producer' | 'collab' | 'arcade-steward';
let role: StellaRoleMode = 'host';
let collabWith = '';
let changedAt = Date.now();
export function setStellaChaosMode(next: StellaChaosMode, nextIntensity?: number){
 mode=next; intensity=Math.max(0,Math.min(1_000_000,Number.isFinite(Number(nextIntensity))?Number(nextIntensity):({chill:8,normal:35,playful:120,chaos:1000,'wtf-million':1_000_000}[next])));
 changedAt=Date.now(); return getStellaChaosMode();
}
export function setStellaRoleMode(next: StellaRoleMode, partner=''){ role=next; collabWith=String(partner||'').trim().replace(/^@/,'').slice(0,80); changedAt=Date.now(); return getStellaChaosMode(); }
export function getStellaChaosMode(){ return {mode,intensity,role,collabWith,changedAt}; }
