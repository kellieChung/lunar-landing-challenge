// Guard for production deploys: the Sprout Lands skin is gitignored (its licence
// forbids redistribution), so make sure `npm run skin` has generated it before
// we build and ship, or the live site would fall back to the plain look.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'ui-sprout');
const problems = [];
if (!existsSync(join(root, 'index.css'))) problems.push('index.css is missing');
for (const [dir, ext] of [['g', '.png'], ['sfx', '.wav']]) {
  const p = join(root, dir);
  const n = existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(ext)).length : 0;
  if (n === 0) problems.push(`${dir}/ has no ${ext} files`);
}

if (problems.length) {
  console.error(`Pixel skin not generated (${root}):\n  - ${problems.join('\n  - ')}`);
  console.error('Run `npm run skin` (needs the Sprout Lands packs, see README) before deploying.');
  process.exit(1);
}
console.log('Pixel skin present.');
