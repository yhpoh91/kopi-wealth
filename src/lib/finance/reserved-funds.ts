import type { FinancialSettings } from '../../types/financialSettings';

export interface ReservedFundsResult {
  reservedSavings: number;
  reservedInvestments: number;
}

export interface AvailableFundsResult {
  availableSavings: number | null;
  availableInvestments: number | null;
}

export interface EmergencyFundResult {
  leanTarget: number;
  fatTarget: number;
  actual: number;
  leanMet: boolean;
  fatMet: boolean;
}

export function calcReservedFunds(
  savingsTotal: number | null,
  investmentsTotal: number | null,
  settings: FinancialSettings,
): ReservedFundsResult {
  const s = savingsTotal ?? 0;
  const inv = investmentsTotal ?? 0;
  const hasSavings = savingsTotal !== null;
  const hasInvestments = investmentsTotal !== null;

  const rawSavings = (settings.ef1SavingsFixed ?? 0) + s * ((settings.ef1SavingsPct ?? 0) / 100);
  const rawInvestments = (settings.ef1InvestmentFixed ?? 0) + inv * ((settings.ef1InvestmentPct ?? 0) / 100);

  return {
    reservedSavings: hasSavings ? Math.min(rawSavings, s) : 0,
    reservedInvestments: hasInvestments ? Math.min(rawInvestments, inv) : 0,
  };
}

export function calcAvailableFunds(
  savingsTotal: number | null,
  investmentsTotal: number | null,
  reservedSavings: number,
  reservedInvestments: number,
): AvailableFundsResult {
  return {
    availableSavings: savingsTotal !== null ? Math.max(0, savingsTotal - reservedSavings) : null,
    availableInvestments: investmentsTotal !== null ? Math.max(0, investmentsTotal - reservedInvestments) : null,
  };
}

export function calcEmergencyFund(
  settings: FinancialSettings,
  savingsTotal: number | null,
  investmentsTotal: number | null,
): EmergencyFundResult | null {
  if (!settings.efType || settings.efType === 'none') return null;

  const leanTarget = (settings.ef2LeanMonthly ?? 0) * (settings.ef2LeanMonths ?? 0);
  const fatTarget = (settings.ef2FatMonthly ?? 0) * (settings.ef2FatMonths ?? 0);
  const actual = (savingsTotal ?? 0) + (investmentsTotal ?? 0);

  return {
    leanTarget,
    fatTarget,
    actual,
    leanMet: actual >= leanTarget,
    fatMet: actual >= fatTarget,
  };
}
