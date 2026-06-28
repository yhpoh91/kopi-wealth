export type InvestmentType =
  | 'stocks'
  | 'etf'
  | 'unit_trust'
  | 'bonds'
  | 'crypto'
  | 'robo'
  | 'reit'
  | 'private_equity'
  | 'insurance_linked'
  | 'other';

export const INVESTMENT_TYPES: InvestmentType[] = [
  'stocks', 'etf', 'unit_trust', 'bonds', 'crypto',
  'robo', 'reit', 'private_equity', 'insurance_linked', 'other',
];

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  stocks: 'Stocks',
  etf: 'ETF',
  unit_trust: 'Unit Trust / Fund',
  bonds: 'Bonds',
  crypto: 'Crypto',
  robo: 'Robo-Advisor',
  reit: 'REIT',
  private_equity: 'Private Equity',
  insurance_linked: 'Insurance-Linked',
  other: 'Other',
};

export interface Investment {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  sub: string;
  name: string;
  type: InvestmentType;
  currency: string;
  value: number;
  institution?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface InvestmentSnapshot {
  PK: string;
  SK: string;
  investId: string;
  value: number;
  recordedAt: string;
  createdAt: string;
}
