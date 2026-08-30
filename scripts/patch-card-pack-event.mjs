import fs from 'node:fs';

function replaceOnce(file, before, after, already) {
  const source = fs.readFileSync(file, 'utf8');
  if (already && source.includes(already)) return;
  if (!source.includes(before)) throw new Error(`card-pack patch target not found in ${file}`);
  fs.writeFileSync(file, source.replace(before, after));
}

replaceOnce(
  'src/server/routes.ts',
  "const allowedTypes = new Set(['pokemon-pack-opened', 'quackverse-pack-opened', 'public-image-generated']);",
  "const allowedTypes = new Set(['card-pack-opened', 'pokemon-pack-opened', 'quackverse-pack-opened', 'public-image-generated']);",
  "'card-pack-opened', 'pokemon-pack-opened'",
);

replaceOnce(
  'src/app/(app)/overlay-urls/page.tsx',
  `  {\n    name: 'Pokemon Pack Overlay',\n    path: '/pokemon-pack-overlay',\n    description: 'Animated pack opening experience when viewers redeem !pack.',\n    recommended: '1920x1080',\n  },`,
  `  {\n    name: 'Card Pack Overlay · Pokemon + Quackverse',\n    path: '/overlay/card-pack',\n    description: 'One shared animated booster reveal for Pokemon and Quackverse pack openings from Twitch, Discord, Overlay Bay, and OBS.',\n    recommended: '960x540 or 1920x1080',\n  },`,
  "name: 'Card Pack Overlay · Pokemon + Quackverse'",
);
