import { describe, it, expect } from 'vitest';
import { calcLiabilityStatus } from '../../../src/lib/finance/liability';

describe('calcLiabilityStatus', () => {
  it('returns settled when outstanding is 0', () => {
    expect(calcLiabilityStatus(100000, 0)).toBe('settled');
  });

  it('returns outstanding when outstanding equals original', () => {
    expect(calcLiabilityStatus(100000, 100000)).toBe('outstanding');
  });

  it('returns outstanding when outstanding exceeds original (interest)', () => {
    expect(calcLiabilityStatus(100000, 105000)).toBe('outstanding');
  });

  it('returns partially_returned when 0 < outstanding < original', () => {
    expect(calcLiabilityStatus(100000, 50000)).toBe('partially_returned');
  });

  it('returns partially_returned when outstanding is 1 (almost settled)', () => {
    expect(calcLiabilityStatus(100000, 1)).toBe('partially_returned');
  });

  it('returns outstanding when original is 0 and outstanding is 0 (edge: treat as settled)', () => {
    expect(calcLiabilityStatus(0, 0)).toBe('settled');
  });
});
