import { describe, it, expect } from 'vitest';
import { resolveTrackedValue, calcGoalProgress } from '../../../src/lib/finance/goal';
import type { GoalMetrics } from '../../../src/lib/finance/goal';

const metrics: GoalMetrics = {
  netWorth: 100000,
  currentAssets: 120000,
  investableAssets: 80000,
  totalSavings: 50000,
  totalInvestments: 30000,
  cpfTotal: 40000,
  availableFunds: 60000,
};

describe('resolveTrackedValue', () => {
  it('returns netWorth', () => expect(resolveTrackedValue('net_worth', metrics)).toBe(100000));
  it('returns currentAssets', () => expect(resolveTrackedValue('current_assets', metrics)).toBe(120000));
  it('returns investableAssets', () => expect(resolveTrackedValue('investable_assets', metrics)).toBe(80000));
  it('returns totalSavings', () => expect(resolveTrackedValue('total_savings', metrics)).toBe(50000));
  it('returns totalInvestments', () => expect(resolveTrackedValue('total_investments', metrics)).toBe(30000));
  it('returns cpfTotal', () => expect(resolveTrackedValue('cpf_total', metrics)).toBe(40000));
  it('returns availableFunds', () => expect(resolveTrackedValue('available_funds', metrics)).toBe(60000));
  it('returns null when metric is null', () => {
    expect(resolveTrackedValue('net_worth', { ...metrics, netWorth: null })).toBeNull();
  });
});

describe('calcGoalProgress', () => {
  it('returns 0 when targetAmount is 0', () => expect(calcGoalProgress(50000, 0)).toBe(0));
  it('returns 0 when targetAmount is negative', () => expect(calcGoalProgress(50000, -1)).toBe(0));
  it('returns 50 when halfway', () => expect(calcGoalProgress(50000, 100000)).toBe(50));
  it('clamps to 100 when over target', () => expect(calcGoalProgress(150000, 100000)).toBe(100));
  it('clamps to 0 when negative value', () => expect(calcGoalProgress(-1000, 100000)).toBe(0));
  it('returns 100 at exact target', () => expect(calcGoalProgress(100000, 100000)).toBe(100));
});
