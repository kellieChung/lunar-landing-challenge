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

// ===========================================================================
// Moon Base game sprites (ui-sprout/g/) and sounds (ui-sprout/sfx/).
// The game reads them through src/game/ui/sprites.ts and falls back to text
// labels for anything missing. Every sprite here is drawn at 2x (or 4x for a
// few hero sprites), so one sprite pixel is always 2 or 4 screen pixels.
// Optional packs (Sprites basic pack, Sorry pack) are skipped if not found.
// ===========================================================================

const SPRITES = process.env.SPROUT_SPRITES_DIR ?? join(homedir(), 'Downloads', 'Sprout Lands - Sprites - Basic pack');
const SORRY = process.env.SPROUT_SORRY_DIR ?? join(homedir(), 'Downloads', 'Sprout Sorry pack');
const G = join(OUT, 'g');
const SFX = join(OUT, 'sfx');
mkdirSync(G, { recursive: true });
mkdirSync(SFX, { recursive: true });

const ui = (...p) => readPng(join(PACK, ...p));
const emoji = ui('emojis-free', 'Emoji_Spritesheet_Free.png');
const white = ui('Sprite sheets', 'Icons', 'white icons.png');
const special = ui('Sprite sheets', 'Icons', 'special icons', 'Special Icons.png');
const teemo = ui('Sprite sheets', 'Dialouge UI', 'Emotes', 'Teemo Basic emote animations sprite sheet.png');
const weather = ui('emojis-free', 'emoji style ui', 'weather', 'Weather_Icons_smal_freel.png');
const settings = ui('Sprite sheets', 'UI Settings Buttons.png');
const play = ui('Sprite sheets', 'UI Big Play Button.png');
const dlgMed = ui('Sprite sheets', 'Dialouge UI', 'dialog box medium.png');
const contSheet = ui('Sprite sheets', 'Dialouge UI', 'dialog box character finished talking click to continue indicator - spritesheet .png');
const bubbles = ui('emojis-free', 'speech_bubble_grey.png');
const blocks = ui('emojis-free', 'emoji style ui', 'Inventory_Blocks_Spritesheet.png');

/** Swap listed colours, leave every other colour as it is. */
function swap(img, map) {
  const px = new Uint8Array(img.px);
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const key = [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (map[key]) px.set(hex(map[key]), i);
  }
  return { ...img, px };
}

/** Nearest-neighbour upscale (for cursors, which CSS cannot scale). */
function scale(img, k) {
  const w = img.width * k, h = img.height * k;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (((y / k) | 0) * img.width + ((x / k) | 0)) * 4;
    px.set(img.px.subarray(s, s + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, px };
}

/** Frames side by side: cells of cw x ch taken at the given [x, y] origins. */
function strip(sheet, cw, ch, origins) {
  return compose(cw * origins.length, ch, origins.map(([x, y], i) => [crop(sheet, x, y, cw, ch), i * cw, 0]));
}

/** Cells of a regular grid: frames of row `r` (cols c0..c0+n-1). */
const row = (sheet, cell, r, n, c0 = 0) => strip(sheet, cell, cell, Array.from({ length: n }, (_, i) => [(c0 + i) * cell, r * cell]));

const game = {}; // name -> { img, frames }
const put = (name, img, frames = 1) => { game[name] = { img, frames }; };

// ---- Chrome (wood -> space grey / blue / purple) ----
const dlg = crop(dlgMed, 2, 7, 124, 35);
put('dlg', recolor(dlg, 'grey', { interior: { color: 'e8cfa6', to: '12141c', alpha: 230 } }));
put('dlg-hi', recolor(dlg, 'blue', { interior: { color: 'e8cfa6', to: '101a33', alpha: 235 } }));
put('cont', recolor(contSheet, 'purple'), 7);
put('plate', recolor(crop(play, 3, 2, 90, 27), 'grey'));
put('plate-hover', recolor(crop(play, 3, 2, 90, 27), 'purple'));
put('plate-go', recolor(crop(play, 3, 2, 90, 27), 'blue'));
put('plate-down', recolor(pad(crop(play, 99, 4, 90, 25), 90, 27, 0, 2), 'blue'));
put('tray-slot', recolor(crop(blocks, 9, 9, 30, 32), 'grey'));

// ---- Neutral grey-white sprites (already space-friendly; kept as drawn) ----
put('round', crop(sheet, 343, 6, 18, 19));
put('round-down', pad(crop(sheet, 375, 8, 18, 17), 18, 19, 0, 2));
put('arrow-r', crop(sheet, 245, 2, 7, 12));
put('arrow-l', crop(sheet, 244, 18, 7, 12));
put('arrow-u', crop(sheet, 243, 36, 10, 9));
put('arrow-d', crop(sheet, 243, 52, 10, 9));
put('bubble', crop(bubbles, 209, 88, 31, 32));
const mouse = (n) => readPng(join(PACK, 'Sprite sheets', 'Mouse sprites', n));
put('cursor', scale(mouse('Triangle Mouse icon 1.png'), 2));
put('cursor-hover', scale(mouse('Triangle Mouse icon 2.png'), 2));
put('cursor-down', scale(mouse('Triangle Mouse icon 3.png'), 2));

// ---- Meter pips (4 x 12): empty, and lit in each state colour ----
const pipOff = crop(sheet, 2, 194, 4, 12);
put('pip-off', recolorByRank(pipOff, ['0b0d14', '23262f', '2f3343']));
put('pip-green', crop(sheet, 2, 210, 4, 12));
put('pip-red', crop(sheet, 2, 226, 4, 12));
put('pip-sun', recolorByRank(pipOff, ['3a2a0a', 'e0a020', 'ffc845']));
put('pip-blue', recolorByRank(pipOff, ['101a33', '3f86d6', '5aa9ff']));
put('pip-purple', recolorByRank(pipOff, ['191330', '8063e0', 'b49bff']));

// ---- Switches (settings sheet) ----
// Knob switches: wood knob -> grey, brown track -> dark grey; the green "on" track stays.
const knobMap = { ...Object.fromEntries(WOOD.map((w, i) => [w, RAMPS.grey[i]])), '645552': '12141c', '8c7369': '2f3343', '7b6762': '23262f' };
put('switch-off', swap(crop(settings, 2, 151, 28, 18), knobMap));
put('switch-on', swap(crop(settings, 66, 151, 28, 18), knobMap));

// ---- Icons (16 px, white) ----
const WHITE = [
  ['remote', 'chat', 'skull', 'gear', 'question', 'star'],
  ['alert', 'coin', 'cart', 'plant', 'trophy', 'crown'],
  ['plus', 'minus', 'home', 'check', 'cross', 'lock'],
];
WHITE.forEach((names, r) => names.forEach((n, c) => put(`i-${n}`, crop(white, c * 16, r * 16, 16, 16))));

// ---- Stars (special icons, 16 px cells; row 1 = outlined) ----
put('star-on', crop(special, 0, 16, 16, 16));
put('star-half', crop(special, 16, 16, 16, 16));
put('star-off', crop(special, 32, 16, 16, 16));

// ---- Emoji sheet (32 px cells, native colours): the scene glyphs ----
const EMOJI = {
  check: [0, 7], cross: [1, 7], alert: [2, 7], question: [3, 7], zzz: [4, 7],
  coin: [1, 8], heart: [3, 8], star: [4, 8], thumb: [0, 9],
  gameboy: [1, 11], tv: [3, 11], robot: [4, 11], sprout: [0, 12],
  rock: [4, 14], dirt: [0, 15], pick: [0, 16],
  sun: [0, 18], sunrise: [3, 18], moon: [4, 18],
};
for (const [n, [c, r]] of Object.entries(EMOJI)) put(`e-${n}`, crop(emoji, c * 32, r * 32, 32, 32));

// ---- Forecast weather (18 x 17 inside 32 px cells) ----
const WEATHER = { day: [0, 0], haze: [1, 0], night: [0, 1], 'night-cloud': [1, 1], dusk: [0, 2], dawn: [1, 2] };
for (const [n, [c, r]] of Object.entries(WEATHER)) put(`w-${n}`, crop(weather, c * 32 + 7, r * 32 + 7, 18, 17));

// ---- Earth: a round button painted as a small blue world ----
put('earth', recolorByRank(crop(sheet, 343, 6, 18, 19), ['101a33', '1f5aa8', '3f86d6', '4fd18b', '9cc8ff']));

// ---- Mascot (Teemo, 32 px cells; rows are emotes) ----
const TEEMO = { idle: [0, 1], blink: [1, 2], talk: [3, 4], love: [4, 2], cheer: [6, 2], happy: [7, 2], cool: [8, 2], angry: [9, 2], sad: [11, 2], sleepy: [12, 1], zzz: [13, 2] };
for (const [n, [r, frames]] of Object.entries(TEEMO)) put(`t-${n}`, row(teemo, 32, r, frames), frames);

// ---- Optional: Sprites basic pack ----
if (existsSync(SPRITES)) {
  const chest = readPng(join(SPRITES, 'Objects', 'Chest.png'));
  // Supply crate opening: 5 frames, 24 x 24, from the 48 px cells of row 0.
  put('crate', strip(chest, 24, 24, [0, 1, 2, 3, 4].map((k) => [48 * k + 12, 10])), 5);
  const tools = readPng(join(SPRITES, 'Objects', 'Basic_tools_and_meterials.png'));
  put('stone', crop(tools, 0, 16, 16, 16));
} else console.warn(`(optional) Sprites basic pack not found at ${SPRITES}: crate and stone sprites skipped`);

// ---- Optional: Sorry pack (patch chests, ice, fire, sounds) ----
if (existsSync(SORRY)) {
  const ea = (...p) => readPng(join(SORRY, 'Early Access', ...p));
  for (const kind of ['Golden', 'Silver', 'Pine']) {
    put(`patch-${kind.toLowerCase()}`, crop(ea('Plant update 2', 'Furniture', `${kind}_Chest.png`), 4, 8, 24, 24));
  }
  put('ice-trace', crop(ea('Sprout winter', 'ice tiles.png'), 16, 32, 16, 16));
  put('ice-rich', crop(ea('Sprout winter', 'winter items.png'), 16, 32, 16, 16));
  put('fire', ea('Sprout winter', 'fire animation.png'), 16);
  const SOUNDS = { click: 'bip_1', build: 'bing_1', deliver: 'blup_1', earth: 'phone_1', sleep: 'boo_1', sunrise: 'flute_1', rover: 'squick_1', launch: 'punch_1', lost: 'boo_2', mission: 'flute_3' };
  for (const [n, f] of Object.entries(SOUNDS)) copyFileSync(join(SORRY, 'Audio', `${f}.wav`), join(SFX, `${n}.wav`));
} else console.warn(`(optional) Sorry pack not found at ${SORRY}: chests, ice, fire and sounds skipped`);

const manifest = {};
for (const [name, { img, frames }] of Object.entries(game)) {
  writePng(join(G, `${name}.png`), img);
  manifest[name] = { w: img.width / frames, h: img.height, frames };
}
writeFileSync(join(G, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`Wrote ${Object.keys(game).length} game sprites to ${G}`);
