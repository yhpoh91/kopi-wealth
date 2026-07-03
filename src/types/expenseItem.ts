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
  receiptKey?: string;
  lineItems?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
