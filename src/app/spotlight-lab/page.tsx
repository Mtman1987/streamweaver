import Link from 'next/link';

const tests = [
  ['Official API', '/spotlight-lab/official', 'One official player; changes channel through Twitch\'s API.'],
  ['Official URL reload', '/spotlight-lab/reload', 'Reloads the official player URL on every rotation.'],
  ['MultiTwitch URL reload', '/spotlight-lab/multitwitch', 'Reloads MultiTwitch with the next creator in its URL.'],
];

export default function SpotlightLabHome() {
  return <main className="lab-home"><style jsx>{`
    .lab-home { min-height:100vh; padding:48px 24px; color:#edf8ff; background:radial-gradient(circle at top left,#1e4791,transparent 40%),#070a1d; font-family:var(--font-inter),Arial,sans-serif; }
    section { max-width:900px; margin:auto; } h1 { font:800 clamp(32px,5vw,56px)/1 var(--font-space-grotesk),sans-serif; margin:0 0 12px; } p { color:#b9c9eb; line-height:1.6; } .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-top:30px; } a { display:block; min-height:150px; padding:20px; border:1px solid rgba(92,233,255,.5); border-radius:18px; color:inherit; text-decoration:none; background:rgba(15,26,70,.72); transition:transform .15s, background .15s; } a:hover { transform:translateY(-3px); background:rgba(35,58,125,.85); } strong { display:block; color:#77efff; font-size:20px; margin-bottom:10px; }
  `}</style><section><p>SPACE MOUNTAIN • SPOTLIGHT LAB</p><h1>Pick the player you want to test.</h1><p>Every test draws from the existing approved live community and partner list, rotates every 30 seconds, and begins only when you press Start.</p><div className="grid">{tests.map(([title, href, description]) => <Link key={href} href={href}><strong>{title}</strong><span>{description}</span></Link>)}</div></section></main>;
}
