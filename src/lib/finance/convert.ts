import { convertAmount } from '../fx';

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
