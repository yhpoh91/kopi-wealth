export type EfType = 'none' | 'budget_based';

export interface FinancialSettings {
  PK: string;           // SETTINGS#{sub}
  SK: string;           // SETTINGS
  sub: string;
  displayName?: string;
  currency: string;     // e.g. SGD, USD, MYR
  timezone: string;     // e.g. Asia/Singapore
  // Reserved Funds
  ef1SavingsFixed?: number;
  ef1SavingsPct?: number;
  ef1InvestmentFixed?: number;
  ef1InvestmentPct?: number;
  // Emergency Fund
  efType?: EfType;
  ef2LeanMonthly?: number;
  ef2LeanMonths?: number;
  ef2FatMonthly?: number;
  ef2FatMonths?: number;
  createdAt: string;
  updatedAt: string;
}
