import { describe, it, expect } from 'vitest';
import {
  calcReservedFunds,
  calcAvailableFunds,
  calcEmergencyFund,
} from '../../../src/lib/finance/reserved-funds';
import type { FinancialSettings } from '../../../src/types/financialSettings';

const base: FinancialSettings = {
  PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1',
  currency: 'SGD', timezone: 'Asia/Singapore',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('calcReservedFunds', () => {
  it('returns zeros when no settings configured', () => {
    const result = calcReservedFunds(50000, 30000, base);
    expect(result).toEqual({ reservedSavings: 0, reservedInvestments: 0 });
  });

  it('applies fixed savings reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1SavingsFixed: 10000 });
    expect(result.reservedSavings).toBe(10000);
    expect(result.reservedInvestments).toBe(0);
  });

  it('applies pct savings reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1SavingsPct: 20 });
    expect(result.reservedSavings).toBe(10000);
  });

  it('adds fixed + pct savings reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1SavingsFixed: 5000, ef1SavingsPct: 10 });
    expect(result.reservedSavings).toBe(10000); // 5000 + 50000*0.10
  });

  it('clamps reservedSavings to savings total', () => {
    const result = calcReservedFunds(5000, 30000, { ...base, ef1SavingsFixed: 999999 });
    expect(result.reservedSavings).toBe(5000);
  });

  it('applies fixed investment reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1InvestmentFixed: 15000 });
    expect(result.reservedInvestments).toBe(15000);
  });

  it('applies pct investment reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1InvestmentPct: 50 });
    expect(result.reservedInvestments).toBe(15000);
  });

  it('adds fixed + pct investment reservation', () => {
    const result = calcReservedFunds(50000, 30000, { ...base, ef1InvestmentFixed: 5000, ef1InvestmentPct: 10 });
    expect(result.reservedInvestments).toBe(8000); // 5000 + 30000*0.10
  });

  it('clamps reservedInvestments to investments total', () => {
    const result = calcReservedFunds(50000, 1000, { ...base, ef1InvestmentFixed: 999999 });
    expect(result.reservedInvestments).toBe(1000);
  });

  it('handles null savings/investments', () => {
    const result = calcReservedFunds(null, null, { ...base, ef1SavingsFixed: 5000 });
    expect(result.reservedSavings).toBe(0);
    expect(result.reservedInvestments).toBe(0);
  });
});

describe('calcAvailableFunds', () => {
  it('returns full amounts when no reservations', () => {
    const result = calcAvailableFunds(50000, 30000, 0, 0);
    expect(result).toEqual({ availableSavings: 50000, availableInvestments: 30000 });
  });

  it('subtracts reservations', () => {
    const result = calcAvailableFunds(50000, 30000, 10000, 15000);
    expect(result).toEqual({ availableSavings: 40000, availableInvestments: 15000 });
  });

  it('clamps to zero', () => {
    const result = calcAvailableFunds(5000, 3000, 10000, 5000);
    expect(result).toEqual({ availableSavings: 0, availableInvestments: 0 });
  });

  it('handles null totals', () => {
    const result = calcAvailableFunds(null, null, 0, 0);
    expect(result).toEqual({ availableSavings: null, availableInvestments: null });
  });
});

describe('calcEmergencyFund', () => {
  it('returns null when efType is none', () => {
    const result = calcEmergencyFund({ ...base, efType: 'none' }, 50000, 30000);
    expect(result).toBeNull();
  });

  it('returns null when efType not set', () => {
    const result = calcEmergencyFund(base, 50000, 30000);
    expect(result).toBeNull();
  });

  it('calculates lean EF target from budget_based', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 },
      50000, 30000
    );
    expect(result).not.toBeNull();
    expect(result!.leanTarget).toBe(18000);
  });

  it('calculates fat EF target from budget_based', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2FatMonthly: 5000, ef2FatMonths: 12 },
      50000, 30000
    );
    expect(result!.fatTarget).toBe(60000);
  });

  it('computes actual EF as savings + investments total', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 },
      40000, 20000
    );
    expect(result!.actual).toBe(60000);
  });

  it('marks lean met when actual >= leanTarget', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 },
      50000, 0
    );
    expect(result!.leanMet).toBe(true);
  });

  it('marks lean not met when actual < leanTarget', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 },
      5000, 0
    );
    expect(result!.leanMet).toBe(false);
  });

  it('marks fat met when actual >= fatTarget', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2FatMonthly: 5000, ef2FatMonths: 6 },
      50000, 0
    );
    expect(result!.fatMet).toBe(true);
  });

  it('handles null savings/investments (actual = 0)', () => {
    const result = calcEmergencyFund(
      { ...base, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 },
      null, null
    );
    expect(result!.actual).toBe(0);
    expect(result!.leanMet).toBe(false);
  });

  it('handles missing monthly/months fields (defaults to 0)', () => {
    const result = calcEmergencyFund({ ...base, efType: 'budget_based' }, 50000, 30000);
    expect(result!.leanTarget).toBe(0);
    expect(result!.fatTarget).toBe(0);
    expect(result!.leanMet).toBe(true);
    expect(result!.fatMet).toBe(true);
  });
});
