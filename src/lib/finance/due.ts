import type { Account } from '../../types/account';
import type { Investment } from '../../types/investment';
import type { CPFAccount } from '../../types/cpf';
import type { Liability } from '../../types/liability';
import type { Receivable } from '../../types/receivable';

// An item is due when its latest update (`updatedAt`) is MORE than this many calendar days
// ago in the user's timezone. 30 days is not due; 31 is. Same for every kind (#26).
export const DUE_AFTER_DAYS = 30;

export type DueKind = 'account' | 'investment' | 'cpf' | 'liability' | 'receivable';

export type DueLastValue =
  | { amount: number; currency: string }                                  // account, investment, liability, receivable
  | { oa: number; sa: number; ma: number; ra: number; currency: 'SGD' };  // cpf

export interface DueItem {
  kind: DueKind;
  id: string;
  name: string;
  daysSince: number;
  lastValue: DueLastValue;
}

const KIND_ORDER: DueKind[] = ['account', 'investment', 'cpf', 'liability', 'receivable'];

// Calendar date (YYYY-MM-DD) of an instant in a timezone. An unknown timezone falls back to UTC.
function localDate(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

// Whole calendar days from the day of `updatedAt` to the day of `nowMs`, both read in `timeZone`.
// Never negative (an update stamped in the future counts as 0).
export function daysSince(updatedAt: string, nowMs: number, timeZone: string): number {
  const then = Date.parse(localDate(Date.parse(updatedAt), timeZone));
  const now = Date.parse(localDate(nowMs, timeZone));
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

export function isDue(days: number): boolean {
  return days > DUE_AFTER_DAYS;
}

export interface DueInput {
  accounts: Account[];
  investments: Investment[];
  cpf: CPFAccount | null;
  liabilities: Liability[];
  receivables: Receivable[];
}

// Everything that is due, oldest first (ties: kind order, then id). Callers pass the user's own,
// non-deleted records; settled liabilities and receivables are skipped here.
export function buildDueItems(input: DueInput, nowMs: number, timeZone: string): DueItem[] {
  const items: DueItem[] = [];
  const add = (kind: DueKind, id: string, name: string, updatedAt: string, lastValue: DueLastValue) => {
    const days = daysSince(updatedAt, nowMs, timeZone);
    if (isDue(days)) items.push({ kind, id, name, daysSince: days, lastValue });
  };
  for (const a of input.accounts) add('account', a.id, a.name, a.updatedAt, { amount: a.balance, currency: a.currency });
  for (const i of input.investments) add('investment', i.id, i.name, i.updatedAt, { amount: i.value, currency: i.currency });
  if (input.cpf) {
    const { oa, sa, ma, ra } = input.cpf;
    add('cpf', 'cpf', 'CPF', input.cpf.updatedAt, { oa, sa, ma, ra, currency: 'SGD' });
  }
  for (const l of input.liabilities) {
    if (l.status !== 'settled') add('liability', l.id, l.name, l.updatedAt, { amount: l.outstandingAmount, currency: l.currency });
  }
  for (const r of input.receivables) {
    if (r.status !== 'settled') add('receivable', r.id, r.name, r.updatedAt, { amount: r.outstandingAmount, currency: r.currency });
  }
  return items.sort((a, b) =>
    b.daysSince - a.daysSince
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.id.localeCompare(b.id));
}
