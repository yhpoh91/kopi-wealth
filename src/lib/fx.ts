import { getFxRate, putFxRate } from '../repositories/fxRate';
import { clock } from './clock';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

export async function fetchRates(baseCurrency: string): Promise<Record<string, number>> {
  const res = await fetch(`${FRANKFURTER_URL}?from=${encodeURIComponent(baseCurrency)}`);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json() as { rates: Record<string, number> };
  return data.rates;
}

export async function getOrFetchRates(baseCurrency: string): Promise<{ rates: Record<string, number>; date: string }> {
  const today = clock.today();
  const cached = await getFxRate(baseCurrency, today);
  if (cached) return { rates: cached.rates, date: cached.date };

  const rates = await fetchRates(baseCurrency);
  const now = clock.nowIso();
  const ttl = Math.floor(clock.nowMs() / 1000) + 48 * 60 * 60;
  await putFxRate({
    PK: `FXRATE#${baseCurrency}`,
    SK: `FXRATE#${today}`,
    baseCurrency,
    date: today,
    rates,
    createdAt: now,
    ttl,
  });
  return { rates, date: today };
}

export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return amount;
  const rate = rates[from];
  if (rate === undefined) return null;
  return amount / rate;
}
