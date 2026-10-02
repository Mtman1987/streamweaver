import assert from 'node:assert/strict';
import test from 'node:test';
import { raffleDurationMs, raffleWheelPhase, raffleAnnouncementReady } from '../src/lib/raffle-wheel-timing';
const start=1000000;
function draw(spins:number[],presented=true) {
 return {startedAt:new Date(start).toISOString(),revealAt:new Date(start+raffleDurationMs(spins)).toISOString(),stepMs:12000,eliminationOrder:spins.map((_,i)=>'name'+i),spinDurationsMs:spins,presentedAt:presented?new Date(start).toISOString():undefined,visualRevealedAt:undefined as string|undefined};
}
test('ten entrants take 90–162 seconds, including one pause per elimination',()=>{
 assert.equal(raffleDurationMs(Array(9).fill(8000)),90000);
 assert.equal(raffleDurationMs(Array(9).fill(16000)),162000);
});
test('wheel does not advance while waiting to appear',()=>{
 const d=draw([8000,16000],false);
 assert.equal(raffleWheelPhase(d,start+999999).count,0);
 assert.equal(raffleWheelPhase(d,start+999999).complete,false);
 assert.equal(raffleAnnouncementReady(d,start+999999),false);
});
test('each spin lands and pauses before exactly one name is removed',()=>{
 const d=draw([8000,16000]);
 for(const [elapsed,count,paused,complete] of [[7999,0,false,false],[8000,0,true,false],[9999,0,true,false],[10000,1,false,false],[25999,1,false,false],[26000,1,true,false],[28000,2,false,true]] as const){
 const phase=raffleWheelPhase(d,start+elapsed);
 assert.equal(phase.count,count);assert.equal(phase.paused,paused);assert.equal(phase.complete,complete);
 }
});
test('winner chat requires painted reveal and a stream-delay allowance',()=>{
 const d=draw([8000]);const reveal=Date.parse(d.revealAt);
 assert.equal(raffleAnnouncementReady(d,reveal+999999),false);
 d.visualRevealedAt=new Date(reveal+3000).toISOString();
 assert.equal(raffleAnnouncementReady(d,reveal+17999),false);
 assert.equal(raffleAnnouncementReady(d,reveal+18000),true);
});
test('one entrant still waits for presentation and its reveal',()=>{
 const d=draw([]);assert.equal(raffleWheelPhase(d,start+7999).complete,false);assert.equal(raffleWheelPhase(d,start+8000).complete,true);
});
