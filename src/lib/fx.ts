import { getFxRate, putFxRate } from '../repositories/fxRate';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

export async function fetchRates(baseCurrency: string): Promise<Record<string, number>> {
  const res = await fetch(`${FRANKFURTER_URL}?from=${encodeURIComponent(baseCurrency)}`);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json() as { rates: Record<string, number> };
  return data.rates;
}

export async function getOrFetchRates(baseCurrency: string): Promise<Record<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = await getFxRate(baseCurrency, today);
  if (cached) return cached.rates;

  const rates = await fetchRates(baseCurrency);
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 48 * 60 * 60;
  await putFxRate({
    PK: `FXRATE#${baseCurrency}`,
    SK: `FXRATE#${today}`,
    baseCurrency,
    date: today,
    rates,
    createdAt: now,
    ttl,
  });
  return rates;
}

export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return amount;
  const rate = rates[from];
  if (rate === undefined) return null;
  return amount / rate;
}
