export type MetricReason = 'no_data' | 'fx_unavailable';

// The per-figure shape every FX-converted amount in the /v1 API uses.
export interface Metric {
  value: number | null;
  partial: boolean;
  reason: MetricReason | null; // why value is null
}

// value is null (with a reason) when it cannot be computed; partial = some amounts were left out
// or unconverted because FX failed.
export function metric(value: number | null, hasData: boolean, partial: boolean): Metric {
  if (value !== null) return { value, partial, reason: null };
  return { value: null, partial, reason: hasData ? 'fx_unavailable' : 'no_data' };
}
