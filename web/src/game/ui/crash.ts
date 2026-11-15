// The opening cutscene: the lander drops toward the Moon, leaking fuel, while
// Astrofrog radios the mayday. A DOM overlay under the radio box; call land()
// when the lines are done and it touches down, kicks up dust and fades away.

const LANDER = `
<svg viewBox="0 0 120 120" class="g-crash-lander" aria-hidden="true">
  <g class="g-crash-flame"><path d="M50 92 L60 118 L70 92 Z" fill="#ffb02e"/><path d="M54 92 L60 108 L66 92 Z" fill="#fff3b0"/></g>
  <path d="M30 78 L18 104 M90 78 L102 104 M44 84 L38 104 M76 84 L82 104" stroke="#cfd6de" stroke-width="4" stroke-linecap="round"/>
  <path d="M12 104 h14 M94 104 h14" stroke="#cfd6de" stroke-width="4" stroke-linecap="round"/>
  <rect x="28" y="56" width="64" height="30" rx="4" fill="#d9a441" stroke="#8a6420" stroke-width="3"/>
  <path d="M40 56 L46 26 H74 L80 56 Z" fill="#e8ecf0" stroke="#7d8894" stroke-width="3"/>
  <circle cx="60" cy="40" r="8" fill="#5bb4ff" stroke="#2c5d86" stroke-width="3"/>
  <rect x="44" y="86" width="32" height="8" fill="#7d8894"/>
  <circle class="g-crash-leak-hole" cx="86" cy="72" r="3" fill="#222"/>
</svg>`;

export interface CrashScene {
  /** Touch down, then fade out. Resolves when the overlay is gone. */
  land(): Promise<void>;
}

export function playCrash(stage: HTMLElement, reduced: boolean): CrashScene {
  const el = document.createElement('div');
  el.className = 'g-crash' + (reduced ? ' g-crash-reduced' : '');
  const stars = Array.from({ length: 60 }, () =>
    `<i style="left:${Math.random() * 100}%;top:${Math.random() * 70}%;animation-delay:${(Math.random() * 3).toFixed(2)}s"></i>`).join('');
  const drops = Array.from({ length: 6 }, (_, i) => `<b style="animation-delay:${(i * 0.18).toFixed(2)}s"></b>`).join('');
  el.innerHTML = `
    <div class="g-crash-stars">${stars}</div>
    <div class="g-crash-ground"></div>
    <div class="g-crash-ship"><div class="g-crash-wobble">${LANDER}<div class="g-crash-leak">${drops}</div></div></div>
    <div class="g-crash-dust"></div>
    <div class="g-crash-alarm"></div>
    <div class="g-crash-warn">⚠ FUEL LEAK ⚠</div>`;
  stage.append(el);
  return {
    land: () => new Promise((done) => {
      el.classList.add('g-crash-landing');
      const wait = reduced ? 300 : 1600;
      setTimeout(() => {
        el.classList.add('g-crash-out');
        setTimeout(() => { el.remove(); done(); }, reduced ? 200 : 700);
      }, wait);
    }),
  };
}
