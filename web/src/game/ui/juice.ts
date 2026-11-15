// Little celebrations on the HUD (rendering only): a confetti burst from an
// element, and a label that floats up and fades (+kg of ice delivered).

import { el, reducedMotion } from './dom';

const COLORS = ['#ffc845', '#5aa9ff', '#4fd18b', '#b49bff', '#ff6b6b', '#f2f3f5'];

/** Pixel confetti flying out of `target` and falling away. */
export function burst(target: Element, count = 26): void {
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const calm = reducedMotion();
  const n = calm ? Math.ceil(count / 3) : count;
  for (let i = 0; i < n; i++) {
    const bit = el('span', 'g-confetti');
    const size = 4 + Math.round(Math.random() * 4);
    bit.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${COLORS[i % COLORS.length]}`;
    document.body.append(bit);
    const a = Math.random() * Math.PI * 2;
    const d = calm ? 12 : 40 + Math.random() * 70;
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d * 0.7 - (calm ? 0 : 30);
    const spin = (Math.random() * 2 - 1) * 540;
    const anim = bit.animate([
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + (calm ? 0 : 60)}px)) rotate(${spin}deg) scale(0.8)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' });
    anim.onfinish = () => bit.remove();
  }
}

/** A short label rising from (x, y) in `container`'s own pixels, then fading. */
export function floatLabel(container: HTMLElement, x: number, y: number, text: string, cls = ''): void {
  const n = el('span', `g-float ${cls}`.trim(), text);
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  container.append(n);
  const rise = reducedMotion() ? 0 : 46;
  const anim = n.animate([
    { transform: 'translate(-50%, -30%) scale(0.7)', opacity: 0 },
    { transform: 'translate(-50%, -100%) scale(1.08)', opacity: 1, offset: 0.18 },
    { transform: `translate(-50%, calc(-100% - ${rise}px)) scale(1)`, opacity: 0 },
  ], { duration: 1700, easing: 'ease-out' });
  anim.onfinish = () => n.remove();
}
