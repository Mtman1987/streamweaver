"use client";

import * as React from "react";
import { LOUNGE_COMMAND_CATEGORIES } from "@/lib/lounge-command-directory";
import { AutoFitText } from "@/components/overlay/auto-fit-text";

type Card = {
  command: string;
  description: string;
  service: string;
  category: string;
  icon: string;
  audience: "everyone" | "moderator";
};

const CARDS: Card[] = LOUNGE_COMMAND_CATEGORIES.flatMap((category) =>
  category.commands.map((command) => ({
    command: command.command,
    description: command.description,
    service: command.service,
    category: category.name,
    icon: category.icon,
    audience: command.audience || "everyone",
  })),
);

function commandExample(command: string): string {
  const first = command.split(" / ")[0].trim();
  return first
    .replace(/\[@user\]/g, "@mountaineer")
    .replace(/@user/g, "@mountaineer")
    .replace(/<user>/g, "@mountaineer")
    .replace(/<amount>/g, "100")
    .replace(/<seconds>/g, "60")
    .replace(/<duration>/g, "60")
    .replace(/<message>/g, "hello there")
    .replace(/<description>/g, "a dragon astronaut")
    .replace(/<song or URL>/g, "Thunderstruck")
    .replace(/<movie title>/g, "The Matrix")
    .replace(/<theme>/g, "dragon")
    .replace(/<text>/g, "space mountain")
    .replace(/<card>/g, "Pikachu")
    .replace(/<cards>/g, "Pikachu, Eevee")
    .replace(/<game>/g, "Just Chatting")
    .replace(/<title>/g, "Space Mountain Live")
    .replace(/<channel>/g, "spacemountainlive")
    .replace(/<color>/g, "blue")
    .replace(/\[set\]/g, "base")
    .replace(/\[music\|movie\]/g, "music")
    .replace(/\[0-100\]/g, "50")
    .replace(/\[seconds\]/g, "60")
    .replace(/\[@user\]/g, "@mountaineer");
}

function nextIndex(current: number): number {
  if (CARDS.length <= 1) return 0;
  let next = current;
  while (next === current) next = Math.floor(Math.random() * CARDS.length);
  return next;
}

export default function LoungeCommandCardOverlay() {
  const [index, setIndex] = React.useState(() => Math.floor(Math.random() * Math.max(1, CARDS.length)));

  React.useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => nextIndex(current)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const card = CARDS[index] || CARDS[0];
  if (!card) return null;
  const example = commandExample(card.command);

  return (
    <main className="stage">
      <style jsx global>{`
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden !important; background: transparent !important; }
        * { box-sizing: border-box; }
      `}</style>
      <style jsx>{`
        .stage { position: fixed; inset: 0; padding: 5px; color: #fff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
        .card { position: relative; display: flex; height: 100%; flex-direction: column; overflow: hidden; border: 2px solid #25e9ff; border-radius: 13px; background: radial-gradient(circle at 82% 5%, rgba(70,225,255,.25), transparent 28%), linear-gradient(150deg, rgba(62,24,125,.98), rgba(19,44,112,.98) 58%, rgba(5,74,111,.98)); box-shadow: inset 0 0 18px rgba(74,230,255,.2), 0 0 14px rgba(25,229,255,.65); animation: cardIn .45s cubic-bezier(.2,.8,.2,1) both; }
        .stars { position: absolute; inset: 0; opacity: .22; background-image: radial-gradient(circle, rgba(255,255,255,.9) 0 1px, transparent 1.4px); background-size: 27px 27px; pointer-events: none; }
        .head { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 9px 10px 6px; }
        .eyebrow { color: #9ff6ff; font-size: 9px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
        .badge { flex: 0 0 auto; padding: 3px 6px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; background: rgba(255,255,255,.08); color: #f4fbff; font-size: 8px; font-weight: 900; text-transform: uppercase; }
        .body { position: relative; z-index: 1; display: flex; min-height: 0; flex: 1; flex-direction: column; padding: 4px 10px 9px; }
        .category { color: #d8c8ff; font-size: 10px; font-weight: 800; }
        .command { margin-top: 5px; color: #fff; font-family: Georgia, "Times New Roman", serif; font-size: clamp(21px, 10vw, 34px); font-weight: 900; line-height: .98; text-shadow: 0 2px 6px rgba(0,0,0,.7); overflow-wrap: anywhere; }
        .description { margin: 10px 0 0; color: #eefaff; font-size: clamp(13px, 5.7vw, 18px); font-weight: 760; line-height: 1.18; }
        .example { margin-top: auto; padding: 8px; border: 1px solid rgba(92,235,255,.48); border-radius: 9px; background: rgba(2,8,29,.72); }
        .example-label { display: block; color: #8defff; font-size: 8px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
        .example-code { display: block; margin-top: 3px; color: #fff2a6; font-size: clamp(11px, 4.8vw, 15px); font-weight: 900; line-height: 1.12; overflow-wrap: anywhere; }
        .footer { position: relative; z-index: 1; display: flex; justify-content: space-between; gap: 8px; padding: 0 10px 8px; color: rgba(223,245,255,.72); font-size: 8px; font-weight: 800; text-transform: uppercase; }
        @keyframes cardIn { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      <article key={card.command} className="card">
        <div className="stars" />
        <div className="head">
          <span className="eyebrow">COMMAND SPOTLIGHT</span>
          <span className="badge">{card.audience === "moderator" ? "MOD" : "CHAT"}</span>
        </div>
        <div className="body">
          <div className="category">{card.icon} {card.category}</div>
          <AutoFitText className="command" minFontSize={15} maxFontSize={34}>{card.command}</AutoFitText>
          <p className="description">{card.description}</p>
          <div className="example">
            <span className="example-label">Example</span>
            <span className="example-code">{example}</span>
          </div>
        </div>
        <footer className="footer"><span>{card.service}</span><span>{index + 1}/{CARDS.length}</span></footer>
      </article>
    </main>
  );
}
