import { beforeEach, describe, expect, it } from 'vitest';
import { Coach, resetTutorial, tutorialDone, type TipLike } from './coach';

// No DOM in the test environment: a stub localStorage, stub elements and a stub tooltip.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
};

const shown = (name: string) => ({ name, isConnected: true, getClientRects: () => [1] }) as unknown as Element;
const hidden = (name: string) => ({ name, isConnected: true, getClientRects: () => [] }) as unknown as Element;

type ShowOpts = Parameters<TipLike['show']>[0];
function fakeTip() {
  const log: ShowOpts[] = [];
  const tip: TipLike = { show: (o) => { log.push(o); }, hide: () => {} };
  return { tip, log, last: () => log[log.length - 1] };
}

describe('Coach', () => {
  beforeEach(() => store.clear());

  it('runs once per browser: finishing remembers, reset brings it back', () => {
    expect(tutorialDone()).toBe(false);
    expect(new Coach().active).toBe(true);
    new Coach(true, fakeTip().tip).finish();
    expect(tutorialDone()).toBe(true);
    expect(new Coach().active).toBe(false);
    resetTutorial();
    expect(new Coach().active).toBe(true);
  });

  it('steps through a beat, skipping targets that are missing or not drawn', async () => {
    const t = fakeTip();
    const c = new Coach(true, t.tip);
    const p = c.beat('look', [
      { target: () => shown('a'), text: 'A' },
      { target: () => null, text: 'missing' },
      { target: () => hidden('h'), text: 'hidden' },
      { target: () => shown('b'), text: 'B', hint: () => 'hint B' },
    ]);
    expect(t.last().text).toBe('A');
    expect(t.last().step).toBe('Tutorial · 1 of 2');
    expect(t.last().next).toBe('Next');
    t.last().onNext!();
    expect(t.last().text).toBe('B');
    expect(t.last().hint).toBe('hint B');
    expect(t.last().next).toBe('Got it');
    t.last().onNext!();
    await p;
    expect(t.log).toHaveLength(2);
  });

  it('plays each beat only once per run', async () => {
    const t = fakeTip();
    const c = new Coach(true, t.tip);
    const p = c.beat('x', [{ target: () => shown('a'), text: 'A' }]);
    t.last().onNext!();
    await p;
    await c.beat('x', [{ target: () => shown('a'), text: 'A' }]);
    expect(t.log).toHaveLength(1);
    expect(c.played('x')).toBe(true);
  });

  it('skip ends the tutorial for good', async () => {
    const t = fakeTip();
    const c = new Coach(true, t.tip);
    const p = c.beat('x', [{ target: () => shown('a'), text: 'A' }, { target: () => shown('b'), text: 'B' }]);
    t.last().onSkip!();
    await p;
    expect(c.active).toBe(false);
    expect(tutorialDone()).toBe(true);
    await c.beat('y', [{ target: () => shown('c'), text: 'C' }]);
    expect(t.log).toHaveLength(1);
  });

  it('a new beat (or hide) cuts the current one short', async () => {
    const t = fakeTip();
    const c = new Coach(true, t.tip);
    const p = c.beat('x', [{ target: () => shown('a'), text: 'A' }, { target: () => shown('b'), text: 'B' }]);
    c.hide();
    await p; // resolves without reaching B
    expect(t.log.map((o) => o.text)).toEqual(['A']);
    expect(c.active).toBe(true);
  });
});
