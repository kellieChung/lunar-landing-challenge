// One guided tooltip at a time: a bubble placed beside the element it talks
// about, with a pulsing outline on that element. Used by the Explore tour and
// the Moon Base tutorial. Fixed positioning, so it works over any layout.

export interface TipOptions {
  target: Element;
  text: string;
  step?: string; // e.g. "1 of 4"
  hint?: string; // a short "what to do now" line under the text
  next?: string; // label of the button that closes or advances it; none = advances by doing the thing
  onNext?: () => void;
  onSkip?: () => void; // shows a "Skip tour" link
  skipLabel?: string;
}

const GAP = 12;
const MARGIN = 8;

export class Tip {
  private el: HTMLElement;
  private textEl: HTMLElement;
  private hintEl: HTMLElement;
  private stepEl: HTMLElement;
  private nextBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;
  private target: Element | null = null;
  private opts: TipOptions | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tip';
    this.el.setAttribute('role', 'dialog');
    this.el.hidden = true;
    this.el.innerHTML = `<div class="tip-step"></div><p class="tip-text"></p><p class="tip-hint"></p>
      <div class="tip-row"><button type="button" class="tip-skip"></button><button type="button" class="tip-next"></button></div>`;
    this.stepEl = this.el.querySelector('.tip-step')!;
    this.textEl = this.el.querySelector('.tip-text')!;
    this.hintEl = this.el.querySelector('.tip-hint')!;
    this.nextBtn = this.el.querySelector('.tip-next')!;
    this.skipBtn = this.el.querySelector('.tip-skip')!;
    this.nextBtn.onclick = () => this.opts?.onNext?.();
    this.skipBtn.onclick = () => this.opts?.onSkip?.();
    document.body.append(this.el);
    window.addEventListener('resize', () => this.place());
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(opts: TipOptions): void {
    const same = this.opts?.text === opts.text && this.target === opts.target;
    this.opts = opts;
    if (this.target !== opts.target) {
      this.target?.classList.remove('tip-pulse');
      opts.target.classList.add('tip-pulse');
      this.target = opts.target;
    }
    this.stepEl.textContent = opts.step ?? '';
    this.stepEl.hidden = !opts.step;
    if (!same) this.textEl.textContent = opts.text;
    this.hintEl.textContent = opts.hint ?? '';
    this.hintEl.hidden = !opts.hint;
    this.nextBtn.textContent = opts.next ?? '';
    this.nextBtn.hidden = !opts.next;
    this.skipBtn.textContent = opts.skipLabel ?? 'Skip tour';
    this.skipBtn.hidden = !opts.onSkip;
    this.el.hidden = false;
    this.place();
  }

  hide(): void {
    this.el.hidden = true;
    this.target?.classList.remove('tip-pulse');
    this.target = null;
    this.opts = null;
  }

  /** Beside the target: left of it if it sits on the right, otherwise above, else below. */
  place(): void {
    if (!this.target || this.el.hidden) return;
    const r = this.target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let left: number;
    let top: number;
    if (r.left + r.width / 2 > vw * 0.6 && r.left - GAP - w >= MARGIN) {
      left = r.left - GAP - w;
      top = r.top + r.height / 2 - h / 2;
    } else if (r.top - GAP - h >= MARGIN) {
      left = r.left + r.width / 2 - w / 2;
      top = r.top - GAP - h;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = r.bottom + GAP;
    }
    this.el.style.left = `${Math.min(Math.max(MARGIN, left), vw - w - MARGIN)}px`;
    this.el.style.top = `${Math.min(Math.max(MARGIN, top), vh - h - MARGIN)}px`;
  }
}
