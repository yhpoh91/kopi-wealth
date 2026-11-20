import { convertAmount } from '../fx';
import { metric } from './metric';
import type { Metric } from './metric';

// Sum amounts in `base`. An amount that cannot be converted (no rate, or FX failed) is left out
// and `partial` is set. Shared by buildOverview and the accounts list so they cannot drift.
export function sumConverted(
  items: { amount: number; currency: string }[],
  base: string,
  rates: Record<string, number>,
  fxFailed: boolean,
): { total: number; partial: boolean } {
  let total = 0;
  let partial = false;
  for (const { amount, currency } of items) {
    if (currency === base) {
      total += amount;
    } else {
      const c = convertAmount(amount, currency, base, rates);
      if (c !== null && !fxFailed) { total += c; } else { partial = true; }
    }
  }
  return { total, partial };
}

// One amount in `base` as a {value, partial, reason}. Equal to the amount in the base currency
// (no FX); a foreign amount with no rate, or with FX down, is null + partial + fx_unavailable.
export function convertedMetric(
  amount: number,
  currency: string,
  base: string,
  rates: Record<string, number>,
  fxFailed: boolean,
): Metric {
  if (currency === base) return metric(amount, true, false);
  const c = fxFailed ? null : convertAmount(amount, currency, base, rates);
  return c === null ? metric(null, true, true) : metric(c, true, false);
}
