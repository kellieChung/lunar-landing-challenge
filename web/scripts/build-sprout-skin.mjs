// Builds the UI skin sprites from the Sprout Lands UI Basic pack (Cup Nooble,
// https://cupnooble.itch.io), recoloured from wood/cream to space grey with
// blue and purple accents.
//
// The pack's free licence forbids redistributing the sprites, even modified,
// so the output folder (src/assets/ui-sprout/) is gitignored. Download the
// pack yourself and run:
//
//   SPROUT_DIR="/path/to/Sprout Lands - UI Pack - Basic pack" npm run skin
//
// Without it the app falls back to the plain CSS look.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crop, readPng, writePng } from './png.mjs';

const PACK = process.env.SPROUT_DIR ?? join(homedir(), 'Downloads', 'Sprout Lands - UI Pack - Basic pack');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'ui-sprout');

if (!existsSync(PACK)) {
  console.error(`Sprout Lands pack not found at:\n  ${PACK}\nSet SPROUT_DIR to the unzipped pack folder.`);
  process.exit(1);
}

// The pack's wood palette, light to dark.
const WOOD = ['f3e5c2', 'e8cfa6', 'dcb98a', 'c49a6c', 'b68962', 'aa7959', '90625d', '6b4b5b'];

// Target ramps, one entry per WOOD shade.
const RAMPS = {
  grey:   ['8d94a8', '6e7489', '5a5f73', '4a4f62', '3d4254', '2f3343', '1c1f2a', '12141c'],
  blue:   ['9cc8ff', '5aa9ff', '3f8ae0', '326fc0', '2a5ca0', '234a85', '1a2f5a', '101a33'],
  purple: ['c3adff', '9b7bff', '8063e0', '6a50c0', '5a43a0', '4a3785', '2a2050', '191330'],
};

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

function recolor(img, ramp, { interior, overrides = {} } = {}) {
  const map = new Map(WOOD.map((w, i) => [w, hex(overrides[w] ?? RAMPS[ramp][i])]));
  const px = new Uint8Array(img.px);
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const key = [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    const to = map.get(key);
    if (!to) throw new Error(`unmapped colour #${key}`);
    px.set(to, i);
    // Dark panel interiors become translucent so the scene shows through.
    if (interior && key === interior.color) {
      px.set(hex(interior.to), i);
      px[i + 3] = interior.alpha;
    }
  }
  return { ...img, px };
}

// Timeline bar states, darkest to lightest: [outline, top band, face].
const STATE_RAMPS = {
  sun: ['6b4a12', 'e0a020', 'ffc845'],
  earth: ['173a73', '3f86d6', '5aa9ff'],
  both: ['14502f', '33a86b', '4fd18b'],
  none: ['0a0b0f', '1b1e24', '262a33'],
};

/** Recolour by lightness rank: the sprite's distinct colours, dark to light, map onto `ramp`. */
function recolorByRank(img, ramp) {
  const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
  const seen = new Map();
  for (let i = 0; i < img.px.length; i += 4) {
    if (!img.px[i + 3]) continue;
    seen.set(img.px.slice(i, i + 3).join(','), lum(img.px[i], img.px[i + 1], img.px[i + 2]));
  }
  const order = [...seen].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  if (order.length !== ramp.length) throw new Error(`expected ${ramp.length} colours, found ${order.length}`);
  const map = new Map(order.map((k, i) => [k, hex(ramp[i])]));
  const px = new Uint8Array(img.px);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]) px.set(map.get(img.px.slice(i, i + 3).join(',')), i);
  }
  return { ...img, px };
}

/** Place `img` on a transparent canvas of w x h at (x, y). */
function pad(img, w, h, x, y) {
  const px = new Uint8Array(w * h * 4);
  for (let r = 0; r < img.height; r++) {
    px.set(img.px.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * w + x) * 4);
  }
  return { width: w, height: h, px };
}

/** Composite several sprites onto one transparent canvas. */
function compose(w, h, parts) {
  const px = new Uint8Array(w * h * 4);
  for (const [img, x, y] of parts) {
    for (let r = 0; r < img.height; r++) {
      for (let c = 0; c < img.width; c++) {
        const s = (r * img.width + c) * 4;
        if (img.px[s + 3]) px.set(img.px.subarray(s, s + 4), ((y + r) * w + x + c) * 4);
      }
    }
  }
  return { width: w, height: h, px };
}

const sheet = readPng(join(PACK, 'Sprite sheets', 'Sprite sheet for Basic Pack.png'));
const menu = readPng(join(PACK, 'Sprite sheets', 'Setting menu.png'));
const at = (x, y, w, h) => crop(sheet, x, y, w, h);

const raised = at(11, 59, 26, 28);              // cream square button with a 2 px drop
const flat = pad(at(59, 59, 26, 26), 26, 28, 0, 2); // same button pushed down 2 px
const slot = at(107, 107, 26, 26);              // darker flat tile
const frame = at(153, 105, 30, 30);             // wooden frame, dark interior
const bar = at(163, 178, 90, 27);               // long raised bar
const pill = at(277, 133, 7, 18);               // vertical pill handle
const plain = crop(menu, 139, 12, 106, 122);    // plain settings panel (no title)
const tlBar = at(466, 73, 28, 14);             // slider bar: outline, top band, face
const corners = compose(26, 26, [
  [at(180, 148, 8, 9), 0, 0],
  [at(196, 148, 8, 9), 18, 0],
  [at(180, 164, 8, 9), 0, 17],
  [at(196, 164, 8, 9), 18, 17],
]);

// Writes ui-sprout/index.css, which main.ts picks up with an eager glob, so the
// skin only loads when these sprites exist.
const out = {
  'btn.png': recolor(raised, 'grey'),
  'btn-hover.png': recolor(raised, 'purple'),
  'btn-pressed.png': recolor(flat, 'grey'),
  'btn-on.png': recolor(flat, 'blue'),
  'slot.png': recolor(slot, 'grey'),
  'slot-purple.png': recolor(slot, 'purple'),
  'panel.png': recolor(frame, 'grey', {
    // Lighter rails than the plain ramp so the frame reads against space.
    overrides: { b68962: '6e7489', '90625d': '1c1f2a' },
    interior: { color: '6b4b5b', to: '0b0d14', alpha: 214 },
  }),
  'card.png': recolor(plain, 'grey'),
  'bar.png': recolor(bar, 'grey'),
  'ribbon.png': recolor(bar, 'purple'),
  'thumb.png': recolor(pill, 'blue'),
  'select.png': recolor(corners, 'purple'),
  ...Object.fromEntries(Object.entries(STATE_RAMPS).map(([k, ramp]) => [`tl-${k}.png`, recolorByRank(tlBar, ramp)])),
  'select-on.png': recolor(corners, 'blue'),
};

mkdirSync(OUT, { recursive: true });
for (const [name, img] of Object.entries(out)) writePng(join(OUT, name), img);
copyFileSync(join(PACK, 'fonts', 'pixelFont-7-8x14-sproutLands.ttf'), join(OUT, 'pixel.ttf'));
writeFileSync(join(OUT, 'index.css'), '/* generated by scripts/build-sprout-skin.mjs */\n@import "../../skin.css";\n');
console.log(`Wrote ${Object.keys(out).length} sprites + pixel.ttf to ${OUT}`);
