'use client';
import { useEffect, useRef, useState } from 'react';
import { getOverlayTenantId } from '@/lib/client-tenant';
type Alert = { id: string; sequence: number; follower: string; test: boolean };
export default function FollowAlertPlayer() {
    const [tenant, setTenant] = useState('');
    useEffect(() => { setTenant(getOverlayTenantId() || ''); }, []);
    const [event, setEvent] = useState<Alert | null>(null);
    const [status, setStatus] = useState('ready');
    const video = useRef<HTMLVideoElement>(null);
    const queue = useRef<Alert[]>([]);
    const active = useRef(false);
    const cursor = useRef<number | undefined>(undefined);
    const statusRef = useRef('ready');
    statusRef.current = status;
    const advance = () => { active.current = false; setEvent(null); };
    useEffect(() => {
        if (!tenant) return;
        let cancelled = false, busy = false;
        const controller = new AbortController();
        const poll = async () => {
            if (busy) return; busy = true;
            const params = new URLSearchParams({ tenant, status: statusRef.current });
            if (cursor.current !== undefined) params.set('after', String(cursor.current));
            try {
                const response = await fetch('/api/overlay/follow?' + params, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) return;
                const data = await response.json();
                if (cancelled) return;
                cursor.current = data.cursor;
                queue.current.push(...(data.events || []));
                queue.current = queue.current.slice(-50);
                if (!active.current && queue.current.length) {
                    active.current = true;
                    setEvent(queue.current.shift()!);
                }
            } catch {} finally { busy = false; }
        };
        poll(); const timer = setInterval(poll, 500);
        return () => { cancelled = true; controller.abort(); clearInterval(timer); queue.current = []; cursor.current = undefined; active.current = false; };
    }, [tenant]);
    useEffect(() => {
        if (!event || !video.current) return;
        let cancelled = false;
        video.current.volume = 1;
        video.current.play().then(() => { if (!cancelled) setStatus('playing'); })
            .catch(() => { if (!cancelled) setStatus('blocked'); });
        const timeout = setTimeout(() => { if (!cancelled) { setStatus('ready'); advance(); } }, 15_000);
        return () => { cancelled = true; clearTimeout(timeout); };
    }, [event]);
    if (!tenant) return null;
    return <main>
        {event && <section>
            <video key={event.id} ref={video} src={'/api/overlay/follow/media?tenant=' + encodeURIComponent(tenant)}
                playsInline preload="auto" onEnded={() => { setStatus('ready'); advance(); }}
                onError={() => { setStatus('media-error'); advance(); }} />
            <h2>{event.test ? 'Follow test: ' : 'Thanks for following, '}{event.follower}!</h2>
            {status === 'blocked' && <button onClick={() => video.current?.play().then(() => setStatus('playing')).catch(() => setStatus('blocked'))}>Enable audio</button>}
        </section>}
        <style jsx>{`
            :global(html), :global(body) { margin:0; background:transparent !important; overflow:hidden; }
            main { position:fixed; z-index:1000; inset:0; display:flex; justify-content:center; align-items:center; font-family:system-ui,sans-serif; color:white; }
            section { width:min(640px,90vw); text-align:center; padding:16px; border-radius:20px; background:rgba(6,18,36,.92); border:2px solid #8cf1ff; box-shadow:0 0 32px #28b8d780; }
            video { display:block; width:100%; border-radius:12px; }
            h2 { margin:12px 0 0; font-size:28px; }
            button { margin-top:12px; padding:10px 18px; border:0; border-radius:8px; font-weight:700; cursor:pointer; }
        `}</style>
    </main>;
}
