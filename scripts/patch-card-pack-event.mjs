import fs from 'node:fs';

const file = 'src/server/routes.ts';
const source = fs.readFileSync(file, 'utf8');
const before = "const allowedTypes = new Set(['pokemon-pack-opened', 'quackverse-pack-opened', 'public-image-generated']);";
const after = "const allowedTypes = new Set(['card-pack-opened', 'pokemon-pack-opened', 'quackverse-pack-opened', 'public-image-generated']);";
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('card-pack event patch target not found');
  fs.writeFileSync(file, source.replace(before, after));
}
