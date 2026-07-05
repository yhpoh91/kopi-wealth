import { getFxRate, putFxRate } from '../repositories/fxRate';
import { clock } from './clock';

const FRANKFURTER_BASE = 'https://api.frankfurter.app';

async function fetchFromFrankfurter(dateOrLatest: string, baseCurrency: string): Promise<{ rates: Record<string, number>; date: string }> {
  const url = `${FRANKFURTER_BASE}/${dateOrLatest}?from=${encodeURIComponent(baseCurrency)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json() as { rates: Record<string, number>; date: string };
  return { rates: data.rates, date: data.date };
}

export async function fetchRates(baseCurrency: string): Promise<Record<string, number>> {
  const { rates } = await fetchFromFrankfurter('latest', baseCurrency);
  return rates;
}

export async function getOrFetchRates(baseCurrency: string): Promise<{ rates: Record<string, number>; date: string }> {
  const today = clock.today();
  const cached = await getFxRate(baseCurrency, today);
  if (cached) return { rates: cached.rates, date: cached.date };

  const { rates } = await fetchFromFrankfurter('latest', baseCurrency);
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

export async function getOrFetchHistoricalRate(from: string, to: string, date: string): Promise<number | null> {
  if (from === to) return 1;
  // Cache keyed by the from-currency + date (rates map contains all target currencies)
  const cached = await getFxRate(from, date);
  if (cached) return cached.rates[to] ?? null;

  const { rates, date: resolvedDate } = await fetchFromFrankfurter(date, from);
  const now = clock.nowIso();
  const ttl = Math.floor(clock.nowMs() / 1000) + 30 * 24 * 60 * 60; // historical rates don't change — 30d TTL
  await putFxRate({
    PK: `FXRATE#${from}`,
    SK: `FXRATE#${resolvedDate}`,
    baseCurrency: from,
    date: resolvedDate,
    rates,
    createdAt: now,
    ttl,
  });
  return rates[to] ?? null;
}

export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return amount;
  const rate = rates[from];
  if (rate === undefined) return null;
  return amount / rate;
}
