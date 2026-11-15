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

const files = import.meta.glob('../../assets/ui-sprout/sfx/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
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

export const sfx = {
  click: () => play('click', () => tone(660, 0, 0.08, 'triangle', 0.05), 0.35),
  build: () => play('build', () => { tone(520, 0, 0.1, 'triangle'); tone(780, 0.08, 0.14, 'triangle'); }),
  delivery: () => play('deliver', () => { tone(520, 0, 0.1, 'triangle'); tone(780, 0.08, 0.14, 'triangle'); }, 0.3),
  sunrise: () => play('sunrise', () => { tone(392, 0, 0.25); tone(523, 0.12, 0.3); tone(659, 0.24, 0.4); }),
  earth: () => play('earth', () => { tone(880, 0, 0.12, 'square', 0.03); tone(1175, 0.1, 0.18, 'square', 0.03); }),
  lost: () => play('lost', () => { tone(440, 0, 0.2, 'sawtooth', 0.03); tone(330, 0.15, 0.3, 'sawtooth', 0.03); }),
  sleep: () => play('sleep', () => tone(220, 0, 0.5, 'sine', 0.06)),
  rover: () => play('rover', () => tone(990, 0, 0.06, 'square', 0.02), 0.25),
  mission: () => play('mission', () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.35, 'triangle', 0.07))),
  launch: () => play('launch', () => { for (let i = 0; i < 14; i++) tone(120 + i * 40, i * 0.12, 0.3, 'sawtooth', 0.025); }),
};
