import { randomUUID } from 'node:crypto';
import { putAccount, updateAccount, putSnapshot } from '../repositories/account';
import type { Account, AccountType } from '../types/account';

// Validation and writes for Cash & Bank accounts, shared by the web /cash-bank handler and the
// /v1/accounts API so a record written from either is identical.

export const ACCOUNT_TYPES: AccountType[] = ['savings', 'checking', 'fixed_deposit', 'cash'];
export const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AccountDetails {
  name: string;
  type: AccountType;
  institution?: string;
  notes?: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseName(raw: unknown): string | null {
  return text(raw).trim().slice(0, 100) || null;
}

export function parseType(raw: unknown): AccountType | null {
  return ACCOUNT_TYPES.includes(raw as AccountType) ? (raw as AccountType) : null;
}

export function parseCurrency(raw: unknown): string | null {
  return typeof raw === 'string' && CURRENCIES.includes(raw) ? raw : null;
}

export function parseInstitution(raw: unknown): string | undefined {
  return text(raw).trim().slice(0, 100) || undefined;
}

export function parseNotes(raw: unknown): string | undefined {
  return text(raw).trim().slice(0, 500) || undefined;
}

// Form values arrive as strings (parseFloat, as the web always did); JSON numbers pass through.
// Must be a finite number >= 0.
export function parseBalance(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(text(raw));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseAccountDetails(raw: Record<string, unknown>): Parsed<AccountDetails> {
  const name = parseName(raw.name);
  if (!name) return { ok: false, error: 'invalid_name' };
  const type = parseType(raw.type);
  if (!type) return { ok: false, error: 'invalid_type' };
  return { ok: true, value: { name, type, institution: parseInstitution(raw.institution), notes: parseNotes(raw.notes) } };
}

export interface NewAccountInput extends AccountDetails {
  currency: string;
  balance: number;
}

export function parseNewAccount(raw: Record<string, unknown>): Parsed<NewAccountInput> {
  const details = parseAccountDetails(raw);
  if (!details.ok) return details;
  const currency = parseCurrency(raw.currency);
  if (!currency) return { ok: false, error: 'invalid_currency' };
  const balance = parseBalance(raw.balance);
  if (balance === null) return { ok: false, error: 'invalid_balance' };
  return { ok: true, value: { ...details.value, currency, balance } };
}

export async function createAccount(sub: string, input: NewAccountInput, now: string): Promise<Account> {
  const id = randomUUID();
  const account: Account = {
    PK: `ACCOUNT#${sub}`,
    SK: `ACCOUNT#${id}`,
    GSI1PK: `USER#${sub}`,
    GSI1SK: `ACCOUNT#${now}`,
    id,
    sub,
    name: input.name,
    type: input.type,
    balance: input.balance,
    currency: input.currency,
    institution: input.institution,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await putAccount(account);
  await putSnapshot({
    PK: `ACCT_SNAP#${id}`,
    SK: `SNAP#${now}#${randomUUID()}`,
    accountId: id,
    balance: input.balance,
    recordedAt: now,
    createdAt: now,
  });
  return account;
}

// The web edit form: details and balance together, with a snapshot of the balance.
export async function saveAccountWithSnapshot(
  sub: string,
  id: string,
  fields: AccountDetails & { balance: number },
  now: string,
): Promise<void> {
  await updateAccount(sub, id, fields, now);
  await putSnapshot({
    PK: `ACCT_SNAP#${id}`,
    SK: `SNAP#${now}#${randomUUID()}`,
    accountId: id,
    balance: fields.balance,
    recordedAt: now,
    createdAt: now,
  });
}
