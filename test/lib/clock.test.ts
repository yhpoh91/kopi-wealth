import { describe, it, expect } from 'vitest';
import { clock } from '../../src/lib/clock';

describe('clock', () => {
  it('nowMs returns a number close to Date.now()', () => {
    const before = Date.now();
    const result = clock.nowMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('nowIso returns an ISO 8601 string', () => {
    expect(clock.nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('today returns YYYY-MM-DD', () => {
    expect(clock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
