export type IncomeType = 'salary' | 'rental' | 'other';
export type IncomeFrequency = 'monthly' | 'quarterly' | 'annual';

export interface IncomeSource {
  PK: string;               // INCOME#{sub}
  SK: string;               // INCOME#{id}
  GSI1PK: string;           // USER#{sub}
  GSI1SK: string;           // INCOME#{createdAt}
  id: string;
  sub: string;
  type: IncomeType;
  name?: string;
  amount: number;
  currency: string;
  exchangeRate?: number;    // 1 unit of income currency = X units of base currency
  frequency: IncomeFrequency;
  startDate?: string;       // YYYY-MM-DD
  endDate?: string;         // YYYY-MM-DD
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export function toMonthlyAmount(source: IncomeSource): number {
  switch (source.frequency) {
    case 'monthly':   return source.amount;
    case 'quarterly': return source.amount / 3;
    case 'annual':    return source.amount / 12;
  }
}
