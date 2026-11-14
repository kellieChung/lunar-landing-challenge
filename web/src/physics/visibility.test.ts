import { describe, expect, it } from 'vitest';
import { bodyAboveHorizon } from './visibility';

describe('bodyAboveHorizon', () => {
  const mask = Array.from({ length: 360 }, (_, i) => (i === 90 ? 3 : 1));
  it('is true above the mask and false below or exactly on it', () => {
    expect(bodyAboveHorizon({ az: 10, el: 1.01 }, mask)).toBe(true);
    expect(bodyAboveHorizon({ az: 10, el: 0.99 }, mask)).toBe(false);
    expect(bodyAboveHorizon({ az: 10, el: 1 }, mask)).toBe(false);
  });
  it('uses the mask at the body azimuth', () => {
    expect(bodyAboveHorizon({ az: 90, el: 2 }, mask)).toBe(false);
    expect(bodyAboveHorizon({ az: 91, el: 2 }, mask)).toBe(true);
  });
});
