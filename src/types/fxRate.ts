export interface FxRateRecord {
  PK: string;
  SK: string;
  baseCurrency: string;
  date: string;
  rates: Record<string, number>;
  createdAt: string;
  ttl: number;
}
