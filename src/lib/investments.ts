import { randomUUID } from 'node:crypto';
import { putInvestment, updateInvestment, putSnapshot } from '../repositories/investment';
import { INVESTMENT_TYPES } from '../types/investment';
import type { Investment, InvestmentType } from '../types/investment';
import { parseName, parseCurrency, parseInstitution, parseNotes, parseBalance } from './accounts';
import type { Parsed } from './accounts';

// Validation and writes for Investments, shared by the web /investments handler and the
// /v1/investments API so a record written from either is identical. Name, currency, institution,
// notes and value follow the same rules as Cash & Bank (src/lib/accounts.ts).

export { parseName, parseCurrency, parseInstitution, parseNotes };
export { parseBalance as parseValue };

export interface InvestmentDetails {
  name: string;
  type: InvestmentType;
  institution?: string;
  notes?: string;
}

export function parseInvestmentType(raw: unknown): InvestmentType | null {
  return INVESTMENT_TYPES.includes(raw as InvestmentType) ? (raw as InvestmentType) : null;
}

export function parseInvestmentDetails(raw: Record<string, unknown>): Parsed<InvestmentDetails> {
  const name = parseName(raw.name);
  if (!name) return { ok: false, error: 'invalid_name' };
  const type = parseInvestmentType(raw.type);
  if (!type) return { ok: false, error: 'invalid_type' };
  return { ok: true, value: { name, type, institution: parseInstitution(raw.institution), notes: parseNotes(raw.notes) } };
}

export interface NewInvestmentInput extends InvestmentDetails {
  currency: string;
  value: number;
}

export function parseNewInvestment(raw: Record<string, unknown>): Parsed<NewInvestmentInput> {
  const details = parseInvestmentDetails(raw);
  if (!details.ok) return details;
  const currency = parseCurrency(raw.currency);
  if (!currency) return { ok: false, error: 'invalid_currency' };
  const value = parseBalance(raw.value);
  if (value === null) return { ok: false, error: 'invalid_value' };
  return { ok: true, value: { ...details.value, currency, value } };
}

export async function createInvestment(sub: string, input: NewInvestmentInput, now: string): Promise<Investment> {
  const id = randomUUID();
  const investment: Investment = {
    PK: `INVEST#${sub}`,
    SK: `INVEST#${id}`,
    GSI1PK: `USER#${sub}`,
    GSI1SK: `INVEST#${now}`,
    id,
    sub,
    name: input.name,
    type: input.type,
    currency: input.currency,
    value: input.value,
    institution: input.institution,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await putInvestment(investment);
  await putSnapshot({
    PK: `INVEST_SNAP#${id}`,
    SK: `SNAP#${now}#${randomUUID()}`,
    investId: id,
    value: input.value,
    recordedAt: now,
    createdAt: now,
  });
  return investment;
}

// The web edit form: details and value together, with a snapshot of the value. The value route
// of the API uses it too (details unchanged).
export async function saveInvestmentWithSnapshot(
  sub: string,
  id: string,
  fields: InvestmentDetails & { value: number },
  now: string,
): Promise<void> {
  await updateInvestment(sub, id, fields, now);
  await putSnapshot({
    PK: `INVEST_SNAP#${id}`,
    SK: `SNAP#${now}#${randomUUID()}`,
    investId: id,
    value: fields.value,
    recordedAt: now,
    createdAt: now,
  });
}
