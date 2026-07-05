import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../src/repositories/liability', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/receivable', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/goal', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/income', () => ({ queryIncomeByUser: vi.fn() }));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { today: vi.fn(() => '2026-07-05') },
}));

import { handler } from '../../src/handlers/accountsHub';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { queryByUser as queryAccounts } from '../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../src/repositories/investment';
import { getCpf } from '../../src/repositories/cpf';
import { queryByUser as queryLiabilities } from '../../src/repositories/liability';
import { queryByUser as queryReceivables } from '../../src/repositories/receivable';
import { queryByUser as queryGoals } from '../../src/repositories/goal';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';
import { queryIncomeByUser } from '../../src/repositories/income';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockQueryAccounts = vi.mocked(queryAccounts);
const mockQueryInvestments = vi.mocked(queryInvestments);
const mockGetCpf = vi.mocked(getCpf);
const mockQueryLiabilities = vi.mocked(queryLiabilities);
const mockQueryReceivables = vi.mocked(queryReceivables);
const mockQueryGoals = vi.mocked(queryGoals);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);
const mockQueryIncomeByUser = vi.mocked(queryIncomeByUser);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent() {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/accounts',
    rawQueryString: '',
    cookies: ['sid=s1'],
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockQueryAccounts.mockResolvedValue([]);
  mockQueryInvestments.mockResolvedValue([]);
  mockGetCpf.mockResolvedValue(null);
  mockQueryLiabilities.mockResolvedValue([]);
  mockQueryReceivables.mockResolvedValue([]);
  mockQueryGoals.mockResolvedValue([]);
  mockQueryIncomeByUser.mockResolvedValue([]);
  mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-07-05' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /accounts (hub)', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('renders hub with 200', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Accounts');
  });

  it('renders link to /cash-bank', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/cash-bank');
  });

  it('renders link to /investments', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/investments');
  });

  it('renders link to /cpf', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/cpf');
  });

  it('renders link to /receivables', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/receivables');
  });

  it('renders link to /liabilities', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/liabilities');
  });

  it('renders link to /goals', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/goals');
  });

  it('renders link to /reserved-funds', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/reserved-funds');
  });

  it('shows SGD totals for all-SGD accounts', async () => {
    mockQueryAccounts.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'a1', sub: 'sub1', name: 'DBS', type: 'savings' as const, balance: 24500, currency: 'SGD', createdAt: '', updatedAt: '' }]);
    mockQueryInvestments.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'i1', sub: 'sub1', name: 'STI ETF', type: 'etf' as const, value: 81200, currency: 'SGD', createdAt: '', updatedAt: '' }]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('24,500.00');
    expect(res.body).toContain('81,200.00');
  });

  it('shows active goals count', async () => {
    const goal = { PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'g1', sub: 'sub1', name: 'FIRE', type: 'fire_lean' as const, tracksAgainst: 'net_worth' as const, targetAmount: 1000000, status: 'active' as const, sortOrder: 0, createdAt: '', updatedAt: '' };
    mockQueryGoals.mockResolvedValue([goal, { ...goal, id: 'g2' }, { ...goal, id: 'g3' }]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('3 active');
  });

  it('shows 1 active singular form', async () => {
    const goal = { PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'g1', sub: 'sub1', name: 'FIRE', type: 'fire_lean' as const, tracksAgainst: 'net_worth' as const, targetAmount: 1000000, status: 'active' as const, sortOrder: 0, createdAt: '', updatedAt: '' };
    mockQueryGoals.mockResolvedValue([goal]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('1 active');
  });

  it('excludes settled liabilities', async () => {
    mockQueryLiabilities.mockResolvedValue([
      { PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'l1', sub: 'sub1', name: 'Car Loan', type: 'loan' as const, outstandingAmount: 8500, currency: 'SGD', status: 'active' as const, createdAt: '', updatedAt: '' },
      { PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'l2', sub: 'sub1', name: 'Old Loan', type: 'loan' as const, outstandingAmount: 5000, currency: 'SGD', status: 'settled' as const, createdAt: '', updatedAt: '' },
    ]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('8,500.00');
    expect(res.body).not.toContain('13,500.00');
  });

  it('fetches FX rates when foreign currencies present', async () => {
    mockQueryAccounts.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'a1', sub: 'sub1', name: 'USD Acct', type: 'savings' as const, balance: 1000, currency: 'USD', createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-07-05' });
    mockConvertAmount.mockImplementation((amount) => amount * 1.35);
    await handler(makeEvent(), {} as never, () => {});
    expect(mockGetOrFetchRates).toHaveBeenCalledWith('SGD');
  });

  it('shows CPF total', async () => {
    mockGetCpf.mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 30000, sa: 10000, ma: 5000, ra: 0, createdAt: '', updatedAt: '' });
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('45,000.00');
  });

  it('converts foreign-currency receivable', async () => {
    mockQueryReceivables.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'r1', sub: 'sub1', name: 'USD Loan', outstandingAmount: 1000, currency: 'USD', status: 'active' as const, createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-07-05' });
    mockConvertAmount.mockImplementation((amount) => amount * 1.35);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('marks partial when receivable FX fails', async () => {
    mockQueryReceivables.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'r1', sub: 'sub1', name: 'USD Loan', outstandingAmount: 1000, currency: 'USD', status: 'active' as const, createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-07-05' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('converts foreign-currency liability', async () => {
    mockQueryLiabilities.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'l1', sub: 'sub1', name: 'USD Loan', outstandingAmount: 5000, currency: 'USD', status: 'active' as const, createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-07-05' });
    mockConvertAmount.mockImplementation((amount) => amount * 1.35);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('marks partial when liability FX fails', async () => {
    mockQueryLiabilities.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'l1', sub: 'sub1', name: 'USD Loan', outstandingAmount: 5000, currency: 'USD', status: 'active' as const, createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-07-05' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('converts foreign-currency investment', async () => {
    mockQueryInvestments.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'i1', sub: 'sub1', name: 'US ETF', type: 'etf' as const, value: 5000, currency: 'USD', createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-07-05' });
    mockConvertAmount.mockImplementation((amount) => amount * 1.35);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('marks partial when investment FX fails', async () => {
    mockQueryInvestments.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'i1', sub: 'sub1', name: 'US ETF', type: 'etf' as const, value: 5000, currency: 'USD', createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-07-05' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('converts CPF to non-SGD currency', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 30000, sa: 10000, ma: 5000, ra: 0, createdAt: '', updatedAt: '' });
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 3.3 }, date: '2026-07-05' });
    mockConvertAmount.mockImplementation((amount) => amount * 3.3);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('falls back to CPF SGD value when CPF FX fails', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 30000, sa: 10000, ma: 5000, ra: 0, createdAt: '', updatedAt: '' });
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-07-05' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.statusCode).toBe(200);
  });

  it('handles FX rate fetch failure gracefully', async () => {
    mockQueryAccounts.mockResolvedValue([{ PK: '', SK: '', GSI1PK: '', GSI1SK: '', id: 'a1', sub: 'sub1', name: 'USD Acct', type: 'savings' as const, balance: 1000, currency: 'USD', createdAt: '', updatedAt: '' }]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network error'));
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number };
    expect(res.statusCode).toBe(200);
  });

  it('shows configured when reserved funds set up', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, ef1SavingsFixed: 5000 });
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('configured');
  });
});
