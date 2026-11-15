// Sound effects: the Sorry pack's own short sounds (copied into
// assets/ui-sprout/sfx/ by `npm run skin`), with tiny Web Audio tones as the
// fallback when the pack isn't there. Muted state is remembered in this
// browser only.

const KEY = 'moonbase:muted';
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

const files = import.meta.glob('../../assets/ui-sprout/sfx/{click,deliver}.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const WAV: Record<string, string> = Object.fromEntries(Object.entries(files).map(([p, u]) => [p.slice(p.lastIndexOf('/') + 1, -4), u]));
const cache = new Map<string, HTMLAudioElement>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(on: boolean): void {
  muted = on;
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // not remembered
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.08): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    // no audio available
  }
}

/** Play the pack's sound `name`, or the fallback tones. */
function play(name: string, fallback: () => void, volume = 0.5): void {
  if (muted) return;
  const src = WAV[name];
  if (!src) return fallback();
  try {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(src);
      cache.set(name, a);
    }
    const n = a.cloneNode() as HTMLAudioElement;
    n.volume = volume;
    void n.play().catch(() => undefined);
  } catch {
    fallback();
  }
}

/** Low noise through a falling lowpass: an engine heard through the ground and the lander's frame. */
function rumble(seconds: number, gain = 0.22): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    const n = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; // brown-ish noise
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.06);
    g.gain.setValueAtTime(gain, t0 + seconds * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + seconds + 0.05);
  } catch {
    // no audio available
  }
}

let lastDing = -Infinity;
let lastClick = -Infinity;

// Only short blips: a click for buttons and a soft ding when a line or a
// dialogue appears (throttled so fast time can't spam it). The pack's longer
// jingles are not used.
export const sfx = {
  click: () => {
    lastClick = performance.now();
    play('click', () => tone(660, 0, 0.08, 'triangle', 0.05), 0.35);
  },
  ding: () => {
    const now = performance.now();
    if (now - lastDing < 1500 || now - lastClick < 300) return; // a click already made a sound
    lastDing = now;
    play('deliver', () => tone(880, 0, 0.12, 'triangle', 0.04), 0.25);
  },
  /** Countdown beat; `last` is the higher "go" note. */
  tick: (last = false) => {
    if (!muted) tone(last ? 1320 : 660, 0, last ? 0.35 : 0.12, 'square', 0.035);
  },
  rumble: (seconds: number) => {
    if (!muted) rumble(seconds);
  },
  /** A small rising chime (milestones). */
  sparkle: () => {
    if (muted) return;
    [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, i * 0.07, 0.25, 'triangle', 0.03));
  },
};
