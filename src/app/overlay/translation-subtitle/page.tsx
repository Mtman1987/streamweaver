'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type TranslationEvent = {
  eventId:string;
  createdAt:string;
  username:string;
  displayName:string;
  sourceText:string;
  translatedText:string;
  targetLanguage:string;
  durationMs:number;
};

function TranslationSubtitleContent() {
  const searchParams = useSearchParams();
  const tenant = searchParams.get('tenant') || '';
  const [event,setEvent] = useState<TranslationEvent | null>(null);
  const lastSeen = useRef('');
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled=false;
    const poll=async()=>{
      const params=new URLSearchParams();
      if(tenant)params.set('tenant',tenant);
      if(lastSeen.current)params.set('after',lastSeen.current);
      try{
        const response=await fetch(`/api/overlay/translation-subtitle?${params.toString()}`,{cache:'no-store'});
        if(!response.ok)return;
        const data=await response.json();
        const events=Array.isArray(data?.events)?data.events:[];
        const next=events.at(-1) as TranslationEvent|undefined;
        if(!next)return;
        lastSeen.current=next.createdAt;
        if(!cancelled)setEvent(next);
        if(hideTimer.current)clearTimeout(hideTimer.current);
        hideTimer.current=setTimeout(()=>{if(!cancelled)setEvent(null)},Math.max(3000,Number(next.durationMs)||9000));
      }catch{}
    };
    void poll();
    const timer=setInterval(poll,350);
    return()=>{cancelled=true;clearInterval(timer);if(hideTimer.current)clearTimeout(hideTimer.current)};
  },[tenant]);

  if(!event)return null;
  return <main className="translation-stage">
    <section className="translation-card">
      <div className="translation-kicker">STELLA LIVE TRANSLATION · {event.targetLanguage.toUpperCase()}</div>
      <div className="translation-copy">{event.translatedText}</div>
      <div className="translation-source">@{event.displayName || event.username} · {event.sourceText}</div>
    </section>
    <style jsx>{`
      :global(html),:global(body){margin:0;width:100%;height:100%;overflow:hidden;background:transparent!important}
      .translation-stage{position:fixed;inset:0;display:grid;align-items:end;justify-items:center;padding:0 6% 7%;pointer-events:none;font-family:Inter,system-ui,sans-serif}
      .translation-card{width:min(92vw,1200px);padding:18px 28px 16px;border:1px solid rgba(125,211,252,.35);border-radius:18px;background:linear-gradient(180deg,rgba(7,17,30,.86),rgba(2,6,23,.94));box-shadow:0 12px 40px rgba(0,0,0,.5);backdrop-filter:blur(10px);animation:slide-in .24s ease-out}
      .translation-kicker{font-size:clamp(10px,1vw,16px);font-weight:900;letter-spacing:.18em;color:#7dd3fc}
      .translation-copy{margin-top:.35rem;font-size:clamp(22px,3.1vw,52px);line-height:1.12;font-weight:900;color:white;text-shadow:0 2px 8px #000}
      .translation-source{margin-top:.5rem;font-size:clamp(11px,1.25vw,20px);line-height:1.3;color:#9bdcff}
      @keyframes slide-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
    `}</style>
  </main>;
}

export default function TranslationSubtitlePage(){
  return <Suspense fallback={null}><TranslationSubtitleContent/></Suspense>;
}
