import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../../src/repositories/liability', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/receivable', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/goal', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/lib/clock', () => ({
  clock: { nowMs: vi.fn(() => Date.parse('2026-06-29T00:00:00.000Z')), nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'), today: vi.fn(() => '2026-06-29') },
}));
vi.mock('../../../src/lib/fx', async (orig) => ({ ...(await orig<typeof import('../../../src/lib/fx')>()), getOrFetchRates: vi.fn() }));

import { handler } from '../../../src/handlers/v1/assets';
import { handler as overview } from '../../../src/handlers/v1/overview';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getSettings } from '../../../src/repositories/financialSettings';
import { queryByUser as queryAccounts } from '../../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../../src/repositories/investment';
import { getCpf } from '../../../src/repositories/cpf';
import { queryByUser as queryLiabilities } from '../../../src/repositories/liability';
import { queryByUser as queryReceivables } from '../../../src/repositories/receivable';
import { queryByUser as queryGoals } from '../../../src/repositories/goal';
import { getOrFetchRates } from '../../../src/lib/fx';

const T = '2024-01-01T00:00:00.000Z';
const base = { GSI1PK: 'USER#sub1', GSI1SK: 'x', sub: 'sub1', createdAt: T, updatedAt: T };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: T, updatedAt: T };
const acct = (balance: number, currency = 'SGD') => ({ ...base, PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a', id: 'a', name: 'A', type: 'savings' as const, balance, currency });
const invest = (value: number, currency = 'SGD') => ({ ...base, PK: 'INVEST#sub1', SK: 'INVEST#i', id: 'i', name: 'I', value, currency }) as never;
const recv = (outstandingAmount: number) => ({ ...base, PK: 'RECV#sub1', SK: 'RECV#r', id: 'r', name: 'F', currency: 'SGD', originalAmount: outstandingAmount, outstandingAmount, status: 'outstanding' as const });

type Res = { statusCode: number; body: string };
const ev = (auth: string | null = 'tok') => ({ headers: auth ? { authorization: `Bearer ${auth}` } : {}, rawPath: '/v1/assets' }) as never;
const get = async (auth?: string | null) => {
  const r = await handler(ev(auth), {} as never, () => {}) as Res;
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockImplementation(async (id: string) =>
    id === 'tok' ? { PK: 'SESSION#tok', SK: 'SESSION#tok', sessionId: 'tok', sub: 'sub1', createdAt: T, ttl: 9999999999, platform: 'mobile' as const } : null);
  vi.mocked(getUser).mockResolvedValue(null);
  vi.mocked(getSettings).mockResolvedValue(settings);
  vi.mocked(queryAccounts).mockResolvedValue([]);
  vi.mocked(queryInvestments).mockResolvedValue([]);
  vi.mocked(getCpf).mockResolvedValue(null);
  vi.mocked(queryLiabilities).mockResolvedValue([]);
  vi.mocked(queryReceivables).mockResolvedValue([]);
  vi.mocked(queryGoals).mockResolvedValue([]);
  vi.mocked(getOrFetchRates).mockResolvedValue({ rates: { USD: 0.75 }, date: '2026-06-29' });
});

const noData = { total: { value: null, partial: false, reason: 'no_data' }, share: null, dueCount: 0 };

describe('GET /v1/assets', () => {
  it('is refused when signed out', async () => {
    expect((await get('bad')).status).toBe(401);
    expect((await get(null)).status).toBe(302);
  });

  it('shows no_data everywhere for a user with nothing', async () => {
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json).toEqual({
      currency: 'SGD', asOf: '2026-06-29',
      have: { value: null, partial: false, reason: 'no_data' },
      groups: { cashBank: noData, investments: noData, cpf: noData, owedToYou: noData },
      available: { value: null, partial: false, reason: 'no_data' },
    });
  });

  it('returns each group total, its share of assets, dueCount 0 and available funds', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(600)]);
    vi.mocked(queryInvestments).mockResolvedValue([invest(300)]);
    vi.mocked(getCpf).mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 50, sa: 25, ma: 15, ra: 10, createdAt: T, updatedAt: T } as never);
    vi.mocked(queryReceivables).mockResolvedValue([recv(100)]);
    const { json } = await get();
    expect(json.have).toEqual({ value: 1100, partial: false, reason: null });
    expect(json.groups.cashBank).toEqual({ total: { value: 600, partial: false, reason: null }, share: 54.5, dueCount: 0 });
    expect(json.groups.investments.share).toBe(27.3);
    expect(json.groups.cpf).toEqual({ total: { value: 100, partial: false, reason: null }, share: 9.1, dueCount: 0 });
    expect(json.groups.owedToYou.total.value).toBe(100);
    expect(json.available).toMatchObject({ reason: null, partial: false });
    expect(json.available.value).not.toBeNull();
  });

  it('agrees with /v1/overview on have and available', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(600), acct(75, 'USD')]);
    vi.mocked(queryInvestments).mockResolvedValue([invest(300)]);
    const a = (await get()).json;
    const o = JSON.parse(((await overview(ev(), {} as never, () => {})) as Res).body);
    expect(a.have).toEqual(o.have);
    expect(a.available).toEqual(o.available);
    expect(a.groups.cashBank.total.value).toBe(700);
  });

  it('converts foreign-currency amounts into the base currency', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(75, 'USD')]);
    expect((await get()).json.groups.cashBank.total.value).toBe(100);
  });

  it('marks only the affected group unavailable when FX fails', async () => {
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    vi.mocked(queryAccounts).mockResolvedValue([acct(75, 'USD')]);
    vi.mocked(queryInvestments).mockResolvedValue([invest(300)]);
    const { json } = await get();
    expect(json.groups.cashBank).toEqual({ total: { value: null, partial: true, reason: 'fx_unavailable' }, share: null, dueCount: 0 });
    expect(json.groups.investments.total).toEqual({ value: 300, partial: false, reason: null });
    expect(json.groups.investments.share).toBeNull(); // have is unknown, so no share
    expect(json.have).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
  });

  it('leaves share null when total assets are zero', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(0)]);
    const { json } = await get();
    expect(json.groups.cashBank.total.value).toBe(0);
    expect(json.groups.cashBank.share).toBeNull();
  });

  it('treats CPF that cannot be converted as unavailable', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, currency: 'USD' });
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    vi.mocked(getCpf).mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 50, sa: 0, ma: 0, ra: 0, createdAt: T, updatedAt: T } as never);
    expect((await get()).json.groups.cpf.total).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
  });

  it('500s without a stack trace on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(queryAccounts).mockRejectedValue(new Error('boom'));
    const r = await handler(ev(), {} as never, () => {}) as Res;
    expect(r.statusCode).toBe(500);
    expect(r.body).toBe('{"error":"internal_error"}');
    vi.mocked(queryAccounts).mockRejectedValue('weird');
    expect(((await handler(ev(), {} as never, () => {})) as Res).statusCode).toBe(500);
    spy.mockRestore();
  });
});
