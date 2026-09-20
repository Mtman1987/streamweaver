import { LOUNGE_COMMAND_CATEGORIES } from '@/lib/lounge-command-directory';

export const metadata = {
  title: 'Space Mountain Lounge Command Guide',
  description: 'Every public chat command available across the 24/7 Space Mountain Lounge.',
};

export default function CommandGuidePage() {
  return (
    <main className="relative z-10 mx-auto min-h-screen w-full max-w-6xl px-4 py-10 text-white sm:px-8">
      <header className="rounded-3xl border border-cyan-300/20 bg-slate-950/80 p-6 shadow-2xl shadow-cyan-950/30 backdrop-blur sm:p-9">
        <p className="text-xs font-black uppercase tracking-[.28em] text-cyan-300">Space Mountain Lounge</p>
        <h1 className="mt-3 text-3xl font-black sm:text-5xl">Complete chat command guide</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
          This directory combines the live Lounge commands from StreamWeaver, HearMeOut, DiscordStreamHub,
          Nebula Arcade, Chat Tag and Twitch. In Twitch chat, type <strong>!commands</strong>, then reply with a category number.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Command categories">
          {LOUNGE_COMMAND_CATEGORIES.map((category) => (
            <a key={category.slug} href={`#${category.slug}`} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-cyan-100 no-underline hover:bg-cyan-300/10">
              {category.number}. {category.icon} {category.name}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {LOUNGE_COMMAND_CATEGORIES.map((category) => (
          <section key={category.slug} id={category.slug} className="scroll-mt-5 rounded-3xl border border-white/10 bg-slate-950/75 p-5 backdrop-blur sm:p-7">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-300/10 text-xl">{category.icon}</span>
              <div>
                <h2 className="text-xl font-black">{category.number}. {category.name}</h2>
                <p className="mt-1 text-sm leading-5 text-slate-400">{category.description}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {category.commands.map((command) => (
                <article key={`${category.slug}:${command.command}`} className="rounded-2xl border border-white/5 bg-white/[.035] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-black text-cyan-200">{command.command}</code>
                    {command.audience === 'moderator' && <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-200">Mod</span>}
                    <span className="rounded-full bg-violet-300/10 px-2 py-1 text-[10px] font-bold text-violet-200">{command.service}</span>
                    <span className="text-[10px] font-bold text-slate-500">{command.surfaces}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-300">{command.description}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
