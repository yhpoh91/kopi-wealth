import { getOrFetchHistoricalRate } from './fx';
import { CURRENCIES } from './accounts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type FxRateLookup =
  | { status: 200; body: { from: string; to: string; date: string; rate: number } }
  | { status: 400 | 404 | 502; body: { error: string } };

// Shared by GET /fx-rate (web) and GET /v1/fx-rate (app).
export async function lookupFxRate(rawFrom: string, rawTo: string, date: string): Promise<FxRateLookup> {
  const from = rawFrom.toUpperCase();
  const to = rawTo.toUpperCase();
  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || !DATE_RE.test(date)) {
    return { status: 400, body: { error: 'Invalid parameters' } };
  }
  try {
    const rate = await getOrFetchHistoricalRate(from, to, date);
    if (rate === null) return { status: 404, body: { error: 'Rate not available' } };
    return { status: 200, body: { from, to, date, rate } };
  } catch {
    return { status: 502, body: { error: 'Failed to fetch rate' } };
  }
}
