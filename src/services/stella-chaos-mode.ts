export type StellaChaosMode = 'chill' | 'normal' | 'playful' | 'chaos' | 'wtf-million';
let mode: StellaChaosMode = 'normal';
let intensity = 35;
let changedAt = Date.now();
export function setStellaChaosMode(next: StellaChaosMode, nextIntensity?: number){
 mode=next; intensity=Math.max(0,Math.min(1_000_000,Number.isFinite(Number(nextIntensity))?Number(nextIntensity):({chill:8,normal:35,playful:120,chaos:1000,'wtf-million':1_000_000}[next])));
 changedAt=Date.now(); return getStellaChaosMode();
}
export function getStellaChaosMode(){ return {mode,intensity,changedAt}; }
