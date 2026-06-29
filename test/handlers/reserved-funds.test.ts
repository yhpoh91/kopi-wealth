import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}));
vi.mock('../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z') },
}));

import { handler } from '../../src/handlers/reserved-funds';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings, putSettings } from '../../src/repositories/financialSettings';
import { queryByUser as queryAccounts } from '../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../src/repositories/investment';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockPutSettings = vi.mocked(putSettings);
const mockQueryAccounts = vi.mocked(queryAccounts);
const mockQueryInvestments = vi.mocked(queryInvestments);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const authResult = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'user@example.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const baseSettings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const sgdAccount = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#id1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'DBS', type: 'savings' as const, balance: 50000, currency: 'SGD', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const sgdInvestment = { PK: 'INVEST#sub1', SK: 'INVEST#i1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z', id: 'i1', sub: 'sub1', name: 'IWDA', type: 'etf' as const, currency: 'SGD', value: 30000, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    requestContext: { http: { method: 'GET' } },
    rawQueryString: '',
    ...overrides,
  } as never;
}

function postEvent(body: string) {
  return makeEvent({ requestContext: { http: { method: 'POST' } }, body, isBase64Encoded: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(authResult);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(baseSettings);
  mockQueryAccounts.mockResolvedValue([]);
  mockQueryInvestments.mockResolvedValue([]);
  mockGetOrFetchRates.mockResolvedValue({ rates: { MYR: 3.45 }, date: '2026-06-29' });
  mockConvertAmount.mockImplementation((amount, from, to, rates) => {
    if (from === to) return amount;
    const r = rates[from];
    return r !== undefined ? amount / r : null;
  });
  mockPutSettings.mockResolvedValue(undefined);
});

describe('GET /reserved-funds', () => {
  it('redirects to login when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML page', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('renders page title', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Reserved Funds');
  });

  it('shows savings and investments totals when no FX needed', async () => {
    mockQueryAccounts.mockResolvedValue([sgdAccount]);
    mockQueryInvestments.mockResolvedValue([sgdInvestment]);
    const res = await handler(makeEvent(), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('50,000.00');
    expect(body).toContain('30,000.00');
  });

  it('shows reserved savings based on fixed amount', async () => {
    mockQueryAccounts.mockResolvedValue([sgdAccount]);
    mockGetSettings.mockResolvedValue({ ...baseSettings, ef1SavingsFixed: 10000 });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('shows available savings (savings minus reserved)', async () => {
    mockQueryAccounts.mockResolvedValue([sgdAccount]);
    mockGetSettings.mockResolvedValue({ ...baseSettings, ef1SavingsFixed: 10000 });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('40,000.00');
  });

  it('shows EF section when efType is budget_based', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6 });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Emergency Fund');
    expect((res as { body: string }).body).toContain('18,000.00');
  });

  it('does not show EF status card when efType is none', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, efType: 'none' });
    const res = await handler(makeEvent(), {} as never, () => {});
    // EF status card with progress bar only renders for budget_based
    expect((res as { body: string }).body).not.toContain('Lean target:');
  });

  it('shows error banner on ?error=invalid', async () => {
    const res = await handler(makeEvent({ rawQueryString: 'error=invalid' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('valid non-negative values');
  });

  it('handles FX for foreign currency accounts', async () => {
    const myrAccount = { ...sgdAccount, id: 'id2', SK: 'ACCOUNT#id2', currency: 'MYR', balance: 3450 };
    mockQueryAccounts.mockResolvedValue([sgdAccount, myrAccount]);
    const res = await handler(makeEvent(), {} as never, () => {});
    // 3450 MYR / 3.45 = 1000 + 50000 = 51000
    expect((res as { body: string }).body).toContain('51,000.00');
  });

  it('shows — when FX fetch fails', async () => {
    const myrAccount = { ...sgdAccount, currency: 'MYR', balance: 3450 };
    mockQueryAccounts.mockResolvedValue([sgdAccount, myrAccount]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network'));
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('>—<');
  });

  it('shows — when investment FX rate unavailable', async () => {
    const myrInvestment = { ...sgdInvestment, currency: 'MYR', value: 3450 };
    mockQueryInvestments.mockResolvedValue([myrInvestment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {});
    // investmentsTotal is null (partial), shows — for reserved investments too
    expect((res as { body: string }).body).toContain('>—<');
  });

  it('handles no settings (null)', async () => {
    mockGetSettings.mockResolvedValue(null);
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('handles undefined rawQueryString', async () => {
    const res = await handler(makeEvent({ rawQueryString: undefined }), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('shows config form with existing values', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, ef1SavingsFixed: 5000, ef1SavingsPct: 10 });
    const res = await handler(makeEvent(), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('value="5000"');
    expect(body).toContain('value="10"');
  });
});

describe('POST /reserved-funds', () => {
  it('saves settings and redirects', async () => {
    const body = 'ef1SavingsFixed=10000&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds' } });
    expect(mockPutSettings).toHaveBeenCalledOnce();
  });

  it('saves ef1SavingsFixed into settings', async () => {
    const body = 'ef1SavingsFixed=15000&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    await handler(postEvent(body), {} as never, () => {});
    expect(mockPutSettings.mock.calls[0][0]).toMatchObject({ ef1SavingsFixed: 15000 });
  });

  it('saves budget_based EF settings', async () => {
    const body = 'ef1SavingsFixed=0&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=budget_based&ef2LeanMonthly=3000&ef2LeanMonths=6&ef2FatMonthly=5000&ef2FatMonths=12';
    await handler(postEvent(body), {} as never, () => {});
    expect(mockPutSettings.mock.calls[0][0]).toMatchObject({
      efType: 'budget_based',
      ef2LeanMonthly: 3000,
      ef2LeanMonths: 6,
      ef2FatMonthly: 5000,
      ef2FatMonths: 12,
    });
  });

  it('redirects to error on invalid number', async () => {
    const body = 'ef1SavingsFixed=abc&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds?error=invalid' } });
    expect(mockPutSettings).not.toHaveBeenCalled();
  });

  it('redirects to error on negative value', async () => {
    const body = 'ef1SavingsFixed=-1&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds?error=invalid' } });
  });

  it('redirects to error when pct > 100', async () => {
    const body = 'ef1SavingsFixed=0&ef1SavingsPct=101&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds?error=invalid' } });
  });

  it('handles base64 encoded body', async () => {
    const raw = 'ef1SavingsFixed=0&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const encoded = Buffer.from(raw).toString('base64');
    const res = await handler(makeEvent({ requestContext: { http: { method: 'POST' } }, body: encoded, isBase64Encoded: true }), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds' } });
  });

  it('seeds settings when none exist', async () => {
    mockGetSettings.mockResolvedValue(null);
    const body = 'ef1SavingsFixed=0&ef1SavingsPct=0&ef1InvestmentFixed=0&ef1InvestmentPct=0&efType=none&ef2LeanMonthly=0&ef2LeanMonths=0&ef2FatMonthly=0&ef2FatMonths=0';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutSettings).toHaveBeenCalledOnce();
  });

  it('treats empty-string param fields as 0', async () => {
    const body = 'ef1SavingsFixed=&ef1SavingsPct=&ef1InvestmentFixed=&ef1InvestmentPct=&efType=none&ef2LeanMonthly=&ef2LeanMonths=&ef2FatMonthly=&ef2FatMonths=';
    const res = await handler(postEvent(body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/reserved-funds' } });
  });
});

describe('GET /reserved-funds — EF card branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(authResult);
    mockGetUser.mockResolvedValue(user);
    mockQueryAccounts.mockResolvedValue([sgdAccount]);
    mockQueryInvestments.mockResolvedValue([sgdInvestment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    mockPutSettings.mockResolvedValue(undefined);
  });

  it('shows EF card with fat met when actual >= fatTarget', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, efType: 'budget_based', ef2LeanMonthly: 3000, ef2LeanMonths: 6, ef2FatMonthly: 5000, ef2FatMonths: 6 });
    mockQueryAccounts.mockResolvedValue([{ ...sgdAccount, balance: 100000 }]);
    mockQueryInvestments.mockResolvedValue([]);
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('✓ Met');
  });

  it('shows EF card with percent when fat not met', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, efType: 'budget_based', ef2LeanMonthly: 1000, ef2LeanMonths: 3, ef2FatMonthly: 5000, ef2FatMonths: 24 });
    mockQueryAccounts.mockResolvedValue([{ ...sgdAccount, balance: 5000 }]);
    mockQueryInvestments.mockResolvedValue([]);
    const res = await handler(makeEvent(), {} as never, () => {});
    // fat target = 5000 * 24 = 120000, not met
    expect((res as { body: string }).body).toContain('%');
  });

  it('EF card handles zero lean/fat targets (pct = 100)', async () => {
    mockGetSettings.mockResolvedValue({ ...baseSettings, efType: 'budget_based' });
    mockQueryAccounts.mockResolvedValue([{ ...sgdAccount, balance: 1000 }]);
    mockQueryInvestments.mockResolvedValue([]);
    const res = await handler(makeEvent(), {} as never, () => {});
    // leanTarget = 0, fatTarget = 0, pct = 100 → both met
    expect((res as { body: string }).body).toContain('Emergency Fund');
  });

  it('shows — when savings FX rate unavailable', async () => {
    const usdAccount = { ...sgdAccount, currency: 'USD', balance: 5000 };
    mockQueryAccounts.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('>—<');
  });

  it('shows — for total usable when both savings and investments are null', async () => {
    const usdAccount = { ...sgdAccount, currency: 'USD', balance: 5000 };
    const usdInvestment = { ...sgdInvestment, currency: 'USD', value: 3000 };
    mockQueryAccounts.mockResolvedValue([usdAccount]);
    mockQueryInvestments.mockResolvedValue([usdInvestment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('>—<');
  });
});
