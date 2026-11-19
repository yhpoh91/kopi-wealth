import { describe, it, expect } from 'vitest';
import { daysSince, isDue, buildDueItems, DUE_AFTER_DAYS } from '../../../src/lib/finance/due';

const NOW = Date.parse('2026-06-29T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const T = 'Asia/Singapore';

describe('daysSince / isDue boundaries', () => {
  it('29 days is not due', () => {
    expect(daysSince(ago(29), NOW, T)).toBe(29);
    expect(isDue(29)).toBe(false);
  });
  it('30 days is NOT due', () => {
    expect(daysSince(ago(30), NOW, T)).toBe(30);
    expect(isDue(30)).toBe(false);
    expect(DUE_AFTER_DAYS).toBe(30);
  });
  it('31 days is due', () => {
    expect(daysSince(ago(31), NOW, T)).toBe(31);
    expect(isDue(31)).toBe(true);
  });
  it('counts calendar days in the user timezone, not 24h blocks', () => {
    // 16:30Z on 29 May is 00:30 on 30 May in Singapore but still 29 May in UTC / Los Angeles.
    const updated = '2026-05-29T16:30:00.000Z';
    const now = Date.parse('2026-06-29T10:00:00.000Z'); // 29 Jun in every zone below
    expect(daysSince(updated, now, 'Asia/Singapore')).toBe(30); // 30 May -> 29 Jun
    expect(daysSince(updated, now, 'UTC')).toBe(31);            // 29 May -> 29 Jun
    expect(daysSince(updated, now, 'America/Los_Angeles')).toBe(31);
  });
  it('falls back to UTC for an unknown timezone', () => {
    expect(daysSince(ago(31), NOW, 'Not/AZone')).toBe(31);
  });
  it('never returns a negative number', () => {
    expect(daysSince(ago(-5), NOW, T)).toBe(0);
  });
});

const base = { GSI1PK: '', GSI1SK: '', PK: '', SK: '', sub: 's', createdAt: ago(100) };
const old = ago(41);
const input = (over: Record<string, unknown> = {}) => ({
  accounts: [], investments: [], cpf: null, liabilities: [], receivables: [], ...over,
}) as Parameters<typeof buildDueItems>[0];

describe('buildDueItems', () => {
  it('nothing at all gives []', () => {
    expect(buildDueItems(input(), NOW, T)).toEqual([]);
  });

  it('lists each kind when due, with its lastValue', () => {
    const items = buildDueItems(input({
      accounts: [{ ...base, id: 'a1', name: 'DBS', type: 'savings', balance: 10, currency: 'SGD', updatedAt: old }],
      investments: [{ ...base, id: 'i1', name: 'ETF', type: 'etf', value: 20, currency: 'USD', updatedAt: old }],
      cpf: { ...base, oa: 1, sa: 2, ma: 3, ra: 4, updatedAt: old },
      liabilities: [{ ...base, id: 'l1', name: 'Loan', type: 'other', currency: 'SGD', originalAmount: 9, outstandingAmount: 5, status: 'outstanding', updatedAt: old }],
      receivables: [{ ...base, id: 'r1', name: 'Ann', type: 'other', currency: 'MYR', originalAmount: 9, outstandingAmount: 7, status: 'partially_received', updatedAt: old }],
    }), NOW, T);
    expect(items).toEqual([
      { kind: 'account', id: 'a1', name: 'DBS', daysSince: 41, lastValue: { amount: 10, currency: 'SGD' } },
      { kind: 'investment', id: 'i1', name: 'ETF', daysSince: 41, lastValue: { amount: 20, currency: 'USD' } },
      { kind: 'cpf', id: 'cpf', name: 'CPF', daysSince: 41, lastValue: { oa: 1, sa: 2, ma: 3, ra: 4, currency: 'SGD' } },
      { kind: 'liability', id: 'l1', name: 'Loan', daysSince: 41, lastValue: { amount: 5, currency: 'SGD' } },
      { kind: 'receivable', id: 'r1', name: 'Ann', daysSince: 41, lastValue: { amount: 7, currency: 'MYR' } },
    ]);
  });

  it('leaves out items updated 30 days ago or less, for every kind', () => {
    const u = ago(30);
    expect(buildDueItems(input({
      accounts: [{ ...base, id: 'a', name: 'A', balance: 1, currency: 'SGD', updatedAt: u }],
      investments: [{ ...base, id: 'i', name: 'I', value: 1, currency: 'SGD', updatedAt: u }],
      cpf: { ...base, oa: 1, sa: 1, ma: 1, ra: 0, updatedAt: u },
      liabilities: [{ ...base, id: 'l', name: 'L', currency: 'SGD', outstandingAmount: 1, status: 'outstanding', updatedAt: u }],
      receivables: [{ ...base, id: 'r', name: 'R', currency: 'SGD', outstandingAmount: 1, status: 'outstanding', updatedAt: u }],
    }), NOW, T)).toEqual([]);
  });

  it('never lists settled liabilities or receivables', () => {
    expect(buildDueItems(input({
      liabilities: [{ ...base, id: 'l', name: 'L', currency: 'SGD', outstandingAmount: 0, status: 'settled', updatedAt: old }],
      receivables: [{ ...base, id: 'r', name: 'R', currency: 'SGD', outstandingAmount: 0, status: 'settled', updatedAt: old }],
    }), NOW, T)).toEqual([]);
  });

  it('orders oldest first, ties by kind then id', () => {
    const acc = (id: string, d: number) => ({ ...base, id, name: id, balance: 1, currency: 'SGD', updatedAt: ago(d) });
    const items = buildDueItems(input({
      accounts: [acc('b', 40), acc('a', 40), acc('z', 90)],
      cpf: { ...base, oa: 0, sa: 0, ma: 0, ra: 0, updatedAt: ago(40) },
    }), NOW, T);
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['account:z', 'account:a', 'account:b', 'cpf:cpf']);
  });
});
