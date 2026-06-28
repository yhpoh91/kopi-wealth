export interface FinancialSettings {
  PK: string;           // SETTINGS#{sub}
  SK: string;           // SETTINGS
  sub: string;
  displayName?: string;
  currency: string;     // e.g. SGD, USD, MYR
  timezone: string;     // e.g. Asia/Singapore
  createdAt: string;
  updatedAt: string;
}
