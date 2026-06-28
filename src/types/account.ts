export type AccountType = 'savings' | 'checking' | 'fixed_deposit' | 'cash';

export interface Account {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  sub: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  institution?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface AccountSnapshot {
  PK: string;
  SK: string;
  accountId: string;
  balance: number;
  recordedAt: string;
  createdAt: string;
}
