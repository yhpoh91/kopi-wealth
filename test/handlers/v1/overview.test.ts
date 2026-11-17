import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../src/repositories/financialSettings', () => ({ getSettings: vi.fn(), putSettings: vi.fn() }));
vi.mock('../../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../../src/repositories/liability', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/receivable', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/goal', () => ({ queryByUser: vi.fn() }));
vi.mock('../../../src/repositories/expenseItem', () => ({ queryByPeriod: vi.fn() }));
vi.mock('../../../src/repositories/featureFlag', () => ({ getFeatureFlag: vi.fn() }));
vi.mock('../../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));
vi.mock('../../../src/lib/clock', () => ({
  clock: {
    nowMs: vi.fn(() => Date.parse('2026-06-29T00:00:00.000Z')),
    nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'),
    today: vi.fn(() => '2026-06-29'),
  },
}));
vi.mock('../../../src/lib/fx', () => ({ getOrFetchRates: vi.fn(), convertAmount: vi.fn() }));

import { handler } from '../../../src/handlers/v1/overview';
import { handler as dashboard } from '../../../src/handlers/dashboard';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getSettings } from '../../../src/repositories/financialSettings';
import { queryByUser as queryAccounts } from '../../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../../src/repositories/investment';
import { getCpf } from '../../../src/repositories/cpf';
import { queryByUser as queryLiabilities } from '../../../src/repositories/liability';
import { queryByUser as queryReceivables } from '../../../src/repositories/receivable';
import { queryByUser as queryGoals } from '../../../src/repositories/goal';
import { queryByPeriod } from '../../../src/repositories/expenseItem';
import { getFeatureFlag } from '../../../src/repositories/featureFlag';
import { getAccountManagementUrl } from '../../../src/lib/account-management';
import { getOrFetchRates, convertAmount } from '../../../src/lib/fx';

const T = '2024-01-01T00:00:00.000Z';
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: T, updatedAt: T };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@example.com', createdAt: T, updatedAt: T };
const acct = (balance: number, currency = 'SGD') => ({ PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#x', id: 'a', sub: 'sub1', name: 'A', type: 'savings' as const, balance, currency, createdAt: T, updatedAt: T });
const liab = (outstandingAmount: number, status: 'outstanding' | 'settled' = 'outstanding', currency = 'SGD') => ({ PK: 'LIAB#sub1', SK: 'LIAB#l', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#x', id: 'l', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency, originalAmount: outstandingAmount, outstandingAmount, status, createdAt: T, updatedAt: T });
const recv = (outstandingAmount: number, status: 'outstanding' | 'settled' = 'outstanding') => ({ PK: 'RECV#sub1', SK: 'RECV#r', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#x', id: 'r', sub: 'sub1', name: 'Friend', currency: 'SGD', originalAmount: outstandingAmount, outstandingAmount, status, createdAt: T, updatedAt: T });
const goal = (over: Record<string, unknown> = {}) => ({ PK: 'GOAL#sub1', SK: 'GOAL#g', GSI1PK: 'USER#sub1', GSI1SK: 'GOAL#1#g', id: 'g', sub: 'sub1', name: 'Lean FIRE', type: 'lean_fire' as const, tracksAgainst: 'net_worth' as const, targetAmount: 20000, sortOrder: 1, status: 'active' as const, createdAt: T, updatedAt: T, ...over });

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
const bearerEvent = { headers: { authorization: 'Bearer tok' }, rawPath: '/v1/overview' } as never;
const cookieEvent = { headers: {}, cookies: ['sid=web1'], rawPath: '/v1/overview' } as never;
const call = async (event: never = bearerEvent) => await handler(event, {} as never, () => {}) as Res;
const body = async (event: never = bearerEvent) => JSON.parse((await call(event)).body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockImplementation(async (id: string) => ({
    PK: `SESSION#${id}`, SK: `SESSION#${id}`, sessionId: id, sub: 'sub1', createdAt: T, ttl: 9999999999,
    ...(id === 'tok' ? { platform: 'mobile' as const } : {}),
  }));
  vi.mocked(getUser).mockResolvedValue(user);
  vi.mocked(getSettings).mockResolvedValue(settings);
  vi.mocked(queryAccounts).mockResolvedValue([]);
  vi.mocked(queryInvestments).mockResolvedValue([]);
  vi.mocked(getCpf).mockResolvedValue(null);
  vi.mocked(queryLiabilities).mockResolvedValue([]);
  vi.mocked(queryReceivables).mockResolvedValue([]);
  vi.mocked(queryGoals).mockResolvedValue([]);
  vi.mocked(queryByPeriod).mockResolvedValue([]);
  vi.mocked(getFeatureFlag).mockResolvedValue(null);
  vi.mocked(getAccountManagementUrl).mockResolvedValue('');
  vi.mocked(getOrFetchRates).mockResolvedValue({ rates: { MYR: 3.5 }, date: '2026-06-28' });
  vi.mocked(convertAmount).mockImplementation((amount, from, to, rates) => {
    if (from === to) return amount;
    const rate = rates[from];
    return rate !== undefined ? amount / rate : null;
  });
});

describe('GET /v1/overview — auth', () => {
  it('accepts a Bearer token', async () => {
    expect((await call()).statusCode).toBe(200);
  });

  it('accepts a web cookie session', async () => {
    expect((await call(cookieEvent)).statusCode).toBe(200);
  });

  it('refuses a signed-out request (cookie path redirects to login)', async () => {
    const res = await call({ headers: {}, rawPath: '/v1/overview' } as never);
    expect(res.statusCode).toBe(302);
    expect(vi.mocked(queryAccounts)).not.toHaveBeenCalled();
  });

  it('refuses an unknown Bearer token with a JSON 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'unauthorized' });
  });
});

describe('GET /v1/overview — figures', () => {
  it('a user with no data gets nulls with a no_data reason, not zeros', async () => {
    const b = await body();
    expect(b.netWorth).toEqual({ value: null, partial: false, reason: 'no_data' });
    expect(b.have.value).toBeNull();
    expect(b.owe.reason).toBe('no_data');
    expect(b.available.reason).toBe('no_data');
    expect(b).toMatchObject({ currency: 'SGD', asOf: '2026-06-29', topGoal: null, due: [], flags: {} });
  });

  it('computes net worth, have, owe and available', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(10000)]);
    vi.mocked(queryReceivables).mockResolvedValue([recv(500)]);
    vi.mocked(queryLiabilities).mockResolvedValue([liab(2000)]);
    vi.mocked(getSettings).mockResolvedValue({ ...settings, ef1SavingsFixed: 1000 });
    const b = await body();
    expect(b.have.value).toBe(10500);
    expect(b.owe.value).toBe(2000);
    expect(b.netWorth).toEqual({ value: 8500, partial: false, reason: null });
    expect(b.available.value).toBe(9000);
  });

  it('reports a negative net worth as a negative number', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000)]);
    vi.mocked(queryLiabilities).mockResolvedValue([liab(5000)]);
    expect((await body()).netWorth.value).toBe(-4000);
  });

  it('excludes settled liabilities and receivables', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000)]);
    vi.mocked(queryLiabilities).mockResolvedValue([liab(9999, 'settled')]);
    vi.mocked(queryReceivables).mockResolvedValue([recv(9999, 'settled')]);
    const b = await body();
    expect(b.owe.value).toBeNull();
    expect(b.have.value).toBe(1000);
    expect(b.netWorth.value).toBe(1000);
  });

  it('converts a foreign currency when FX works', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000), acct(3500, 'MYR')]);
    const b = await body();
    expect(b.have).toEqual({ value: 2000, partial: false, reason: null });
  });

  it('flags partial and returns null with fx_unavailable when FX fails', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000), acct(3500, 'MYR')]);
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    const b = await body();
    expect(b.netWorth).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(b.have).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(b.available).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
  });

  it('keeps a partial liabilities total and marks it partial', async () => {
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000)]);
    vi.mocked(queryLiabilities).mockResolvedValue([liab(100), liab(500, 'outstanding', 'MYR')]);
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    const b = await body();
    expect(b.owe).toEqual({ value: 100, partial: true, reason: null });
  });

  it('flags a net worth that includes unconverted CPF as partial', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, currency: 'MYR' });
    vi.mocked(getCpf).mockResolvedValue({ oa: 100, sa: 0, ma: 0, ra: 0 } as never);
    vi.mocked(convertAmount).mockReturnValue(null);
    const b = await body();
    expect(b.netWorth).toEqual({ value: 100, partial: true, reason: null });
    expect(b.have).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
  });

  it('available is null without settings', async () => {
    vi.mocked(getSettings).mockResolvedValue(null);
    vi.mocked(queryAccounts).mockResolvedValue([acct(1000)]);
    const b = await body();
    expect(b.available.value).toBeNull();
    expect(b.currency).toBe('SGD');
  });
});

describe('GET /v1/overview — top goal', () => {
  beforeEach(() => vi.mocked(queryAccounts).mockResolvedValue([acct(5000)]));

  it('returns the first active goal with percent, amountToGo and what it tracks', async () => {
    vi.mocked(queryGoals).mockResolvedValue([goal({ sortOrder: 2, name: 'Second' }), goal({ id: 'g2', name: 'First', sortOrder: 1 }), goal({ id: 'g3', status: 'paused', sortOrder: 0 })]);
    expect((await body()).topGoal).toEqual({ name: 'First', tracks: 'net_worth', percent: 25, amountToGo: 15000 });
  });

  it('caps amountToGo at zero once the target is met', async () => {
    vi.mocked(queryGoals).mockResolvedValue([goal({ targetAmount: 1000 })]);
    expect((await body()).topGoal).toMatchObject({ percent: 100, amountToGo: 0 });
  });

  it('gives null percent and amountToGo when the tracked value is unknown', async () => {
    vi.mocked(queryGoals).mockResolvedValue([goal({ tracksAgainst: 'cpf_total' })]);
    expect((await body()).topGoal).toEqual({ name: 'Lean FIRE', tracks: 'cpf_total', percent: null, amountToGo: null });
  });

  it('gives null percent and amountToGo when there is no target', async () => {
    vi.mocked(queryGoals).mockResolvedValue([goal({ targetAmount: 0 })]);
    expect((await body()).topGoal).toMatchObject({ percent: null, amountToGo: null });
  });
});

describe('GET /v1/overview — flags', () => {
  it('isAdmin is a live read of the user record, not the session role', async () => {
    vi.mocked(getUser).mockResolvedValue({ ...user, role: 'admin' });
    expect((await body()).flags).toEqual({ isAdmin: true });
    vi.mocked(getUser).mockResolvedValue({ ...user, role: undefined });
    expect((await body()).flags).toEqual({});
  });

  it('includes feature flags that are on for this user and omits the rest', async () => {
    vi.mocked(getFeatureFlag).mockImplementation(async (name) =>
      name === 'debugPanel' ? { PK: 'FEATURE#debugPanel', SK: 'FEATURE#debugPanel', name, enabled: true, createdAt: T, updatedAt: T } : null);
    expect((await body()).flags).toEqual({ debugPanel: true });
  });

  it('treats an unreadable flag as off', async () => {
    vi.mocked(getFeatureFlag).mockRejectedValue(new Error('ddb'));
    expect((await body()).flags).toEqual({});
  });

  it('turns on accountSelfService', async () => {
    vi.mocked(getFeatureFlag).mockImplementation(async (name) =>
      name === 'accountSelfService' ? { PK: 'x', SK: 'x', name, enabled: true, createdAt: T, updatedAt: T } : null);
    expect((await body()).flags).toEqual({ accountSelfService: true });
  });
});

describe('GET /v1/overview — errors', () => {
  it('returns a JSON 500 with no stack trace when something throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(queryAccounts).mockRejectedValue(new Error('boom at /secret/path'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'internal_error' });
    expect(res.body).not.toContain('boom');
    expect(res.body).not.toContain('at ');
  });

  it('logs a non-Error throw', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(queryAccounts).mockRejectedValue('weird');
    expect((await call()).statusCode).toBe(500);
    expect(spy).toHaveBeenCalledWith('overview failed', 'weird');
  });
});

describe('web dashboard and /v1/overview agree', () => {
  const dash = async () => (await dashboard(cookieEvent, {} as never, () => {}) as Res).body;
  const shown = (html: string, label: string) => {
    const m = new RegExp(`${label}</div>\\s*<div[^>]*>([^<]*)`).exec(html);
    return m![1].trim();
  };
  const fmt = (n: number | null) => n === null ? 'SGD —' : `SGD ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const scenarios: Record<string, () => void> = {
    'no data': () => {},
    'mixed assets and debts': () => {
      vi.mocked(queryAccounts).mockResolvedValue([acct(10000), acct(3500, 'MYR')]);
      vi.mocked(getCpf).mockResolvedValue({ oa: 1000, sa: 500, ma: 200, ra: 0 } as never);
      vi.mocked(queryLiabilities).mockResolvedValue([liab(2000), liab(777, 'settled')]);
      vi.mocked(queryReceivables).mockResolvedValue([recv(300), recv(50, 'settled')]);
      vi.mocked(getSettings).mockResolvedValue({ ...settings, ef1SavingsFixed: 1500, ef1SavingsPct: 10 });
    },
    'negative net worth': () => {
      vi.mocked(queryAccounts).mockResolvedValue([acct(100)]);
      vi.mocked(queryLiabilities).mockResolvedValue([liab(9000)]);
    },
    'FX failure': () => {
      vi.mocked(queryAccounts).mockResolvedValue([acct(100), acct(500, 'MYR')]);
      vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    },
  };

  for (const [name, setup] of Object.entries(scenarios)) {
    it(`same numbers for: ${name}`, async () => {
      setup();
      const html = await dash();
      const api = await body(cookieEvent);
      expect(shown(html, 'Net Worth')).toBe(fmt(api.netWorth.value));
      expect(shown(html, 'Total Assets')).toBe(api.have.value === null && !api.have.partial && api.have.reason === 'no_data' ? '—' : fmt(api.have.value));
      expect(shown(html, 'Total Liabilities')).toBe(api.owe.reason === 'no_data' ? '—' : fmt(api.owe.value));
      expect(shown(html, 'Available Funds')).toBe(api.available.reason === 'no_data' ? '—' : fmt(api.available.value));
    });
  }
});
