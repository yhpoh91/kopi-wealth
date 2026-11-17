import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/featureFlag', () => ({ getFeatureFlag: vi.fn() }));

import { evaluateFlag, isFeatureEnabled } from '../../src/lib/feature-flags';
import { getFeatureFlag } from '../../src/repositories/featureFlag';
import type { FeatureFlag } from '../../src/types/featureFlag';

const flag = (over: Partial<FeatureFlag> = {}): FeatureFlag =>
  ({ PK: 'FEATURE#f', SK: 'FEATURE#f', name: 'f', enabled: true, createdAt: 'x', updatedAt: 'x', ...over });

describe('evaluateFlag', () => {
  it('is off when the flag does not exist or is disabled', () => {
    expect(evaluateFlag(null, 'u')).toBe(false);
    expect(evaluateFlag(flag({ enabled: false, allowedSubs: ['u'] }), 'u')).toBe(false);
  });
  it('is on for everyone when enabled with no rollout', () => {
    expect(evaluateFlag(flag(), 'u')).toBe(true);
  });
  it('blockedSubs wins over allowedSubs', () => {
    expect(evaluateFlag(flag({ allowedSubs: ['u'], blockedSubs: ['u'] }), 'u')).toBe(false);
  });
  it('allowedSubs is on even at 0% rollout', () => {
    expect(evaluateFlag(flag({ rolloutPercent: 0, allowedSubs: ['u'] }), 'u')).toBe(true);
  });
  it('rollout 0 is off and 100 is on', () => {
    expect(evaluateFlag(flag({ rolloutPercent: 0 }), 'u')).toBe(false);
    expect(evaluateFlag(flag({ rolloutPercent: 100 }), 'u')).toBe(true);
  });
  it('rollout is stable per user and splits roughly as asked', () => {
    const f = flag({ rolloutPercent: 30 });
    const subs = Array.from({ length: 1000 }, (_, i) => `sub${i}`);
    const on = subs.filter((s) => evaluateFlag(f, s));
    expect(on).toEqual(subs.filter((s) => evaluateFlag(f, s)));
    expect(on.length).toBeGreaterThan(220);
    expect(on.length).toBeLessThan(380);
  });
});

describe('isFeatureEnabled', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads FEATURE#{name} and evaluates it', async () => {
    vi.mocked(getFeatureFlag).mockResolvedValue(flag());
    expect(await isFeatureEnabled('f', 'u')).toBe(true);
    expect(getFeatureFlag).toHaveBeenCalledWith('f');
  });
  it('is off when the read fails', async () => {
    vi.mocked(getFeatureFlag).mockRejectedValue(new Error('ddb'));
    expect(await isFeatureEnabled('f', 'u')).toBe(false);
  });
});
