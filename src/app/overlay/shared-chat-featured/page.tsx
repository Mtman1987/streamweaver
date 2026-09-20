"use client";

import * as React from "react";

type FeaturedBadge = { id: string; label?: string; imageUrl?: string };
type FeaturedMedia = {
  type: "image" | "video" | "audio" | "sticker" | "emote" | "link-preview";
  url: string;
  thumbnailUrl?: string;
  alt?: string;
  meta?: Record<string, unknown>;
};
type FeaturedEvent = {
  eventId: string;
  platform: string;
  sourceName?: string;
  channelName?: string;
  sender: { displayName: string; avatarUrl?: string; badges?: FeaturedBadge[]; roles?: string[] };
  text: string;
  media?: FeaturedMedia[];
  donation?: { display?: string; amount: number; currency: string };
  membership?: { tier?: string };
  reward?: { title?: string };
};
type FeaturedPayload = {
  event: FeaturedEvent | null;
  presentation: { style: "glass" | "solid" | "minimal"; durationSeconds: number };
};
type MessagePart =
  | { key: string; type: "text"; text: string }
  | { key: string; type: "emote"; media: FeaturedMedia };

const badgeIcons: Record<string, string> = {
  broadcaster: "★", moderator: "◆", vip: "♦", subscriber: "✦", founder: "♛", member: "✦",
};

function emoteRanges(media: FeaturedMedia): Array<[number, number]> {
  const ranges = media.meta?.ranges;
  if (!Array.isArray(ranges)) return [];
  return ranges.flatMap((range) => {
    const match = String(range).match(/^(\d+)-(\d+)$/);
    return match ? [[Number(match[1]), Number(match[2])] as [number, number]] : [];
  });
}

function messageParts(event: FeaturedEvent): MessagePart[] {
  const placements = (event.media || [])
    .filter((entry) => entry.type === "emote")
    .flatMap((entry) => emoteRanges(entry).map(([start, end]) => ({ start, end, entry })))
    .sort((a, b) => a.start - b.start);
  if (!placements.length) return [{ key: "message", type: "text", text: event.text }];

  const parts: MessagePart[] = [];
  let cursor = 0;
  placements.forEach(({ start, end, entry }, index) => {
    if (start < cursor || start >= event.text.length) return;
    if (start > cursor) parts.push({ key: `text-${index}`, type: "text", text: event.text.slice(cursor, start) });
    parts.push({ key: `emote-${index}-${start}`, type: "emote", media: entry });
    cursor = Math.min(event.text.length, end + 1);
  });
  if (cursor < event.text.length) parts.push({ key: "text-last", type: "text", text: event.text.slice(cursor) });
  return parts;
}

function badgeLabel(badge: FeaturedBadge): string {
  return badge.label || badge.id.replaceAll("_", " ");
}

export default function SharedChatFeaturedOverlay() {
  const [tenant, setTenant] = React.useState("");
  const [fallback, setFallback] = React.useState("");
  const [payload, setPayload] = React.useState<FeaturedPayload | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTenant(params.get("tenant") || "");
    setFallback(params.get("fallback") || "");
  }, []);

  React.useEffect(() => {
    if (!tenant) return;
    let active = true;
    const load = async () => {
      try {
        const fallbackQuery = fallback === "latest" ? "&fallback=latest" : "";
        const response = await fetch(`/api/shared-chat/featured?tenant=${encodeURIComponent(tenant)}${fallbackQuery}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json();
        if (active) setPayload(next);
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tenant, fallback]);

  const event = payload?.event || null;
  const attachments = (event?.media || []).filter((entry) => entry.type !== "emote" && entry.type !== "audio");
  const badges = event?.sender.badges || [];
  const roles = (event?.sender.roles || []).filter((role) => role !== "viewer" && role !== "bot");
  const displayBadges: FeaturedBadge[] = badges.length ? badges.slice(0, 3) : roles.slice(0, 2).map((role) => ({ id: role, label: role }));
  const initial = event?.sender.displayName.trim().charAt(0).toUpperCase() || "★";
  const textLength = event?.text.length || 0;
  const messageClass = textLength > 150 ? "message small" : textLength > 85 ? "message medium" : "message";

  return (
    <main className="featured-chat-stage">
      <style jsx global>{`html, body { background: transparent !important; overflow: hidden !important; } * { box-sizing: border-box; }`}</style>
      <style jsx>{`
        .featured-chat-stage { position: fixed; inset: 0; padding: 5px; overflow: hidden; color: #fff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
        .showcase {
          position: relative; display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; overflow: hidden;
          border: 2px solid #25e9ff; border-radius: 13px;
          background: radial-gradient(circle at 82% 4%, rgba(55,221,255,.28), transparent 31%), linear-gradient(150deg, rgba(107,38,173,.97), rgba(33,75,176,.98) 55%, rgba(10,111,173,.98));
          box-shadow: inset 0 0 18px rgba(74,230,255,.25), 0 0 14px rgba(25,229,255,.7);
          animation: featureIn .48s cubic-bezier(.2,.8,.2,1) both;
        }
        .showcase::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .3; background-image: radial-gradient(circle, rgba(255,255,255,.8) 0 1px, transparent 1.5px); background-size: 31px 31px; }
        .header { position: relative; z-index: 1; flex: 0 0 auto; padding: 9px 8px 7px; text-align: center; font-family: Georgia, "Times New Roman", serif; font-size: clamp(14px, 6vw, 21px); font-weight: 900; letter-spacing: .035em; line-height: 1; text-shadow: 0 2px 5px rgba(0,0,0,.65); }
        .chat-card { position: relative; z-index: 1; display: flex; min-height: 0; flex: 1; flex-direction: column; margin: 0 8px 8px; padding: 9px; overflow: hidden; border: 1.5px solid rgba(51,225,255,.85); border-radius: 10px; background: linear-gradient(145deg, rgba(4,9,34,.96), rgba(7,15,46,.94)); box-shadow: inset 0 0 18px rgba(18,67,131,.45); }
        .sender { display: grid; grid-template-columns: 47px minmax(0,1fr); align-items: center; gap: 8px; flex: 0 0 auto; }
        .avatar, .avatar-fallback { width: 47px; height: 47px; border: 2px solid #6fefff; border-radius: 50%; box-shadow: 0 0 10px rgba(37,233,255,.48); }
        .avatar { object-fit: cover; }
        .avatar-fallback { display: grid; place-items: center; background: linear-gradient(145deg,#7143c9,#168fc8); font-family: Georgia,serif; font-size: 25px; font-weight: 900; }
        .identity { min-width: 0; }
        .name { overflow: hidden; color: #fff; font-family: Georgia,"Times New Roman",serif; font-size: clamp(18px,8vw,28px); font-weight: 900; line-height: 1.05; text-overflow: ellipsis; text-shadow: 0 2px 3px #000; white-space: nowrap; }
        .identity-meta { display: flex; align-items: center; gap: 4px; margin-top: 4px; overflow: hidden; }
        .platform, .badge { display: inline-flex; max-width: 100%; align-items: center; gap: 3px; overflow: hidden; border-radius: 999px; font-size: 9px; font-weight: 900; line-height: 1; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
        .platform { flex: 0 0 auto; padding: 5px 7px; background: #6543a8; color: #fff; }
        .badge { padding: 4px 6px; border: 1px solid rgba(255,219,96,.55); background: rgba(255,197,46,.14); color: #ffe678; }
        .badge-image { width: 12px; height: 12px; object-fit: contain; }
        .message { min-height: 0; margin: 9px 0 0; overflow: hidden; color: #f8fbff; font-size: clamp(19px,8.5vw,30px); font-weight: 800; line-height: 1.16; overflow-wrap: anywhere; text-shadow: 0 2px 3px rgba(0,0,0,.9); }
        .message.medium { font-size: clamp(16px,7vw,24px); }
        .message.small { font-size: clamp(14px,5.6vw,20px); }
        .inline-emote { display: inline-block; width: 1.35em; height: 1.35em; margin: -.18em .08em; object-fit: contain; vertical-align: middle; }
        .media-preview { position: relative; min-height: 68px; flex: 1 1 42%; margin-top: 8px; overflow: hidden; border: 1px solid rgba(74,230,255,.78); border-radius: 8px; background: #020615; }
        .media-preview img { width: 100%; height: 100%; object-fit: cover; }
        .media-label { position: absolute; right: 5px; bottom: 5px; padding: 3px 6px; border-radius: 999px; background: rgba(2,6,21,.8); color: #9cefff; font-size: 8px; font-weight: 900; text-transform: uppercase; }
        .special { flex: 0 0 auto; margin-top: 7px; color: #ffe56d; font-size: 13px; font-weight: 900; line-height: 1.1; }
        .waiting { align-items: center; justify-content: center; text-align: center; }
        .waiting-mark { font-size: 42px; filter: drop-shadow(0 0 9px #25e9ff); }
        .waiting-copy { margin-top: 9px; color: #c7f8ff; font-size: 16px; font-weight: 800; line-height: 1.25; }
        @keyframes featureIn { from { opacity: 0; transform: translateY(24px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      <article key={event?.eventId || "waiting"} className="showcase">
        <header className="header">SPACE MOUNTAIN CHAT</header>
        {!event ? (
          <section className="chat-card waiting"><div className="waiting-mark">✦</div><div className="waiting-copy">Waiting for the next community message…</div></section>
        ) : (
          <section className="chat-card">
            <div className="sender">
              {event.sender.avatarUrl ? <img className="avatar" src={event.sender.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial}</div>}
              <div className="identity">
                <div className="name">{event.sender.displayName}</div>
                <div className="identity-meta">
                  <span className="platform">{event.platform.toUpperCase()}</span>
                  {displayBadges.map((badge) => (
                    <span className="badge" key={badge.id} title={badgeLabel(badge)}>
                      {badge.imageUrl ? <img className="badge-image" src={badge.imageUrl} alt="" /> : <span>{badgeIcons[badge.id] || "✦"}</span>}
                      <span>{badgeLabel(badge)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <p className={messageClass}>
              {messageParts(event).map((part) => part.type === "text"
                ? <React.Fragment key={part.key}>{part.text}</React.Fragment>
                : <img key={part.key} className="inline-emote" src={part.media.url} alt={part.media.alt || "emote"} />)}
            </p>

            {attachments.length > 0 && (
              <div className="media-preview">
                <img src={attachments[0].thumbnailUrl || attachments[0].url} alt={attachments[0].alt || "Shared chat media"} />
                <span className="media-label">{attachments[0].type}</span>
              </div>
            )}

            {(event.donation || event.membership || event.reward) && (
              <div className="special">
                {event.donation?.display || (event.donation ? `${event.donation.amount} ${event.donation.currency}` : "")}
                {event.membership ? ` ✦ ${event.membership.tier || "Member"}` : ""}
                {event.reward ? ` ✦ ${event.reward.title || "Channel reward"}` : ""}
              </div>
            )}
          </section>
        )}
      </article>
    </main>
  );
}
