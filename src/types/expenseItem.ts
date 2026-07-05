export interface ExpenseItem {
  PK: string;
  SK: string;
  id: string;
  sub: string;
  amount: number;
  currency: string;
  name: string;
  date: string; // YYYY-MM-DD
  notes?: string;
  exchangeRate?: number; // 1 unit of expense currency = X units of user's base currency
  receiptKey?: string;
  lineItems?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
