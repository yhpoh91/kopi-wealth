import { describe, it, expect } from 'vitest';
import { calcReceivableStatus } from '../../../src/lib/finance/receivable';

describe('calcReceivableStatus', () => {
  it('returns settled when outstanding is 0', () => {
    expect(calcReceivableStatus(100000, 0)).toBe('settled');
  });

  it('returns outstanding when outstanding equals original', () => {
    expect(calcReceivableStatus(100000, 100000)).toBe('outstanding');
  });

  it('returns outstanding when outstanding exceeds original (interest)', () => {
    expect(calcReceivableStatus(100000, 105000)).toBe('outstanding');
  });

  it('returns partially_received when 0 < outstanding < original', () => {
    expect(calcReceivableStatus(100000, 50000)).toBe('partially_received');
  });

  it('returns partially_received when outstanding is 1 (almost settled)', () => {
    expect(calcReceivableStatus(100000, 1)).toBe('partially_received');
  });

  it('returns settled when both amounts are 0', () => {
    expect(calcReceivableStatus(0, 0)).toBe('settled');
  });
});
