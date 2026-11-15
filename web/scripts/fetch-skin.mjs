// Runs before every build (npm "prebuild"). The Sprout Lands skin may not be
// redistributed, so it lives in a PRIVATE GitHub repo instead of this one.
// On Vercel the build downloads it with a read-only token; locally the copy
// made by `npm run skin` is used as is.
//
//   SKIN_TOKEN  fine-grained GitHub token, Contents: read-only on the skin repo
//   SKIN_REPO   owner/name of that repo (default below)
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src', 'assets', 'ui-sprout');
const repo = process.env.SKIN_REPO || 'kellieChung/lunar-landing-skin';
const token = process.env.SKIN_TOKEN;
const onVercel = !!process.env.VERCEL;

const present = () => existsSync(join(dest, 'index.css')) && existsSync(join(dest, 'g')) && readdirSync(join(dest, 'g')).length > 0;

if (present() && !onVercel) {
  console.log('fetch-skin: using the local skin.');
  process.exit(0);
}
if (!token) {
  if (onVercel) {
    console.error('fetch-skin: SKIN_TOKEN is not set in the Vercel project, so the pixel skin cannot be downloaded.');
    console.error('Add it under Settings -> Environment Variables (see README "Deploy (Vercel)"). Failing so a plain build never goes live.');
    process.exit(1);
  }
  console.log('fetch-skin: no local skin and no SKIN_TOKEN; building the plain look.');
  process.exit(0);
}

const res = await fetch(`https://api.github.com/repos/${repo}/tarball/HEAD`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'skin-fetch' },
});
if (!res.ok) {
  console.error(`fetch-skin: GitHub answered ${res.status} for ${repo}. Check SKIN_REPO and that SKIN_TOKEN can read it.`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const tar = spawnSync('tar', ['-xz', '--strip-components=1', '-C', dest], { input: Buffer.from(await res.arrayBuffer()) });
if (tar.status !== 0) {
  console.error(`fetch-skin: could not unpack the skin: ${tar.stderr}`);
  process.exit(1);
}
const check = spawnSync(process.execPath, [join(here, 'check-skin.mjs')], { stdio: 'inherit' });
process.exit(check.status ?? 1);
