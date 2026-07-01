import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}));
vi.mock('../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../src/repositories/liability', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/receivable', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/goal', () => ({ queryByUser: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'), today: vi.fn(() => '2026-06-29') },
}));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));

import { handler } from '../../src/handlers/dashboard';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings, putSettings } from '../../src/repositories/financialSettings';
import { queryByUser } from '../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../src/repositories/investment';
import { getCpf } from '../../src/repositories/cpf';
import { queryByUser as queryLiabilities } from '../../src/repositories/liability';
import { queryByUser as queryReceivables } from '../../src/repositories/receivable';
import { queryByUser as queryGoals } from '../../src/repositories/goal';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockPutSettings = vi.mocked(putSettings);
const mockQueryByUser = vi.mocked(queryByUser);
const mockQueryInvestments = vi.mocked(queryInvestments);
const mockGetCpf = vi.mocked(getCpf);
const mockQueryLiabilities = vi.mocked(queryLiabilities);
const mockQueryReceivables = vi.mocked(queryReceivables);
const mockQueryGoals = vi.mocked(queryGoals);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const authResult = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'user@example.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const sgdAccount = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#id1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'DBS', type: 'savings' as const, balance: 10000, currency: 'SGD', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const myrAccount = { ...sgdAccount, id: 'id2', SK: 'ACCOUNT#id2', name: 'Maybank', balance: 3450, currency: 'MYR' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(authResult);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockPutSettings.mockResolvedValue(undefined);
  mockQueryByUser.mockResolvedValue([]);
  mockQueryInvestments.mockResolvedValue([]);
  mockGetCpf.mockResolvedValue(null);
  mockQueryLiabilities.mockResolvedValue([]);
  mockQueryReceivables.mockResolvedValue([]);
  mockGetOrFetchRates.mockResolvedValue({ rates: { MYR: 3.45 }, date: '2026-06-28' });
  mockConvertAmount.mockImplementation((amount, from, to, rates) => {
    if (from === to) return amount;
    const rate = rates[from];
    return rate !== undefined ? amount / rate : null;
  });
});

describe('GET /', () => {
  it('redirects to login when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML page', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('renders greeting with display name', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: 'Alice' });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Alice');
  });

  it('falls back to user name when no displayName', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: undefined });
    mockGetUser.mockResolvedValue({ ...user, name: 'Bob' });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Bob');
  });

  it('falls back to email when no name', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: undefined });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('user@example.com');
  });

  it('falls back to "there" when no user and no displayName', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: undefined });
    mockGetUser.mockResolvedValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('there');
  });

  it('seeds settings when none exist', async () => {
    mockGetSettings.mockResolvedValue(null);
    await handler({} as never, {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledOnce();
    expect(mockPutSettings.mock.calls[0][0]).toMatchObject({ PK: 'SETTINGS#sub1', currency: 'SGD' });
  });

  it('does not seed settings when they already exist', async () => {
    await handler({} as never, {} as never, () => {});
    expect(mockPutSettings).not.toHaveBeenCalled();
  });

  it('shows — when no data', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('>—<');
  });

  it('shows savings total within Total Funds for same-currency accounts', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('converts foreign currency accounts to settings currency', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount, myrAccount]);
    // 3450 MYR / 3.45 = 1000 SGD + 10000 SGD = 11000
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('11,000.00');
    expect(mockGetOrFetchRates).toHaveBeenCalledWith('SGD');
  });

  it('shows partial when FX fetch fails', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount, myrAccount]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network error'));
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('shows partial when rate not available for a currency', async () => {
    const jpyAccount = { ...sgdAccount, id: 'id3', currency: 'JPY', balance: 10000 };
    mockQueryByUser.mockResolvedValue([sgdAccount, jpyAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('does not call FX when all accounts are in settings currency', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount]);
    await handler({} as never, {} as never, () => {});
    expect(mockGetOrFetchRates).not.toHaveBeenCalled();
  });

  it('shows add-account CTA when no accounts', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Add your first account');
  });

  it('hides add-account CTA when accounts exist', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('Add your first account');
  });

  it('escapes XSS in display name', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: '<script>alert(1)</script>' });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('<script>alert(1)</script>');
    expect((res as { body: string }).body).toContain('&lt;script&gt;');
  });

  it('shows CPF total in Total Assets when base currency is SGD', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('35,000.00');
  });

  it('shows Total Assets label when no CPF data', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Total Assets');
  });

  it('converts CPF total to base currency when not SGD', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: { MYR: 3.45, SGD: 3.45 }, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from) => from === 'SGD' ? amount * 3.45 : null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('120,750.00');
  });

  it('shows (SGD) note on CPF when FX fails and base is not SGD', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockRejectedValue(new Error('fail'));
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('shows Total Funds label', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Total Funds');
  });

  it('shows investments total within Total Funds', async () => {
    const inv = { PK: 'INVEST#sub1', SK: 'INVEST#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'IWDA', type: 'etf' as const, currency: 'SGD', value: 15000, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockQueryInvestments.mockResolvedValue([inv]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('15,000.00');
  });

  it('converts foreign currency investments to settings currency', async () => {
    const inv = { PK: 'INVEST#sub1', SK: 'INVEST#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'IWDA', type: 'etf' as const, currency: 'MYR', value: 3450, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockQueryInvestments.mockResolvedValue([inv]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('1,000.00');
  });

  it('shows partial for investments when FX fails', async () => {
    const inv = { PK: 'INVEST#sub1', SK: 'INVEST#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'IWDA', type: 'etf' as const, currency: 'MYR', value: 3450, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockQueryInvestments.mockResolvedValue([inv]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network error'));
    mockConvertAmount.mockReturnValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('shows Total Liabilities label', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Total Liabilities');
  });

  it('shows total outstanding liabilities (active only)', async () => {
    const liab = { PK: 'LIAB#sub1', SK: 'LIAB#id1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Home Loan', type: 'mortgage' as const, currency: 'SGD', originalAmount: 500000, outstandingAmount: 450000, status: 'partially_returned' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    const settledLiab = { ...liab, id: 'id2', outstandingAmount: 0, status: 'settled' as const };
    mockQueryLiabilities.mockResolvedValue([liab, settledLiab]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('450,000.00');
  });

  it('computes net worth: savings + investments − liabilities', async () => {
    const liab = { PK: 'LIAB#sub1', SK: 'LIAB#id1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Home Loan', type: 'mortgage' as const, currency: 'SGD', originalAmount: 500000, outstandingAmount: 400000, status: 'partially_returned' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdAccount]); // 10000
    mockQueryLiabilities.mockResolvedValue([liab]); // -400000
    // net worth = 10000 - 400000 = -390000
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('-390,000.00');
  });

  it('shows Net Worth label', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Net Worth');
  });

  it('shows partial note on liabilities when FX unavailable', async () => {
    const usdLiab = { PK: 'LIAB#sub1', SK: 'LIAB#id1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency: 'USD', originalAmount: 10000, outstandingAmount: 8000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryLiabilities.mockResolvedValue([usdLiab]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('shows Available Funds label', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Available Funds');
  });

  it('shows total outstanding receivables in Current Assets', async () => {
    const recv = { PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan to Bob', type: 'personal_loan' as const, currency: 'SGD', originalAmount: 10000, outstandingAmount: 8000, status: 'partially_received' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    const settledRecv = { ...recv, id: 'id2', outstandingAmount: 0, status: 'settled' as const };
    mockQueryReceivables.mockResolvedValue([recv, settledRecv]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('8,000.00');
  });

  it('includes receivables in net worth calculation', async () => {
    const recv = { PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan to Bob', type: 'personal_loan' as const, currency: 'SGD', originalAmount: 10000, outstandingAmount: 8000, status: 'partially_received' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdAccount]); // 10000
    mockQueryReceivables.mockResolvedValue([recv]); // +8000
    // net worth = 10000 + 8000 = 18000
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('18,000.00');
  });

  it('shows partial note on receivables when FX unavailable', async () => {
    const usdRecv = { PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan to Bob', type: 'personal_loan' as const, currency: 'USD', originalAmount: 10000, outstandingAmount: 8000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryReceivables.mockResolvedValue([usdRecv]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('converts foreign currency liabilities when FX available', async () => {
    const usdLiab = { PK: 'LIAB#sub1', SK: 'LIAB#id1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency: 'USD', originalAmount: 10000, outstandingAmount: 5000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryLiabilities.mockResolvedValue([usdLiab]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(6757);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('6,757.00');
  });

  it('converts foreign currency receivables when FX available', async () => {
    const usdRecv = { PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Loan to Bob', type: 'personal_loan' as const, currency: 'USD', originalAmount: 10000, outstandingAmount: 4000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryReceivables.mockResolvedValue([usdRecv]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-29' });
    mockConvertAmount.mockReturnValue(5405);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('5,405.00');
  });

  it('computes available funds when savings and investments both exist', async () => {
    const invest = { PK: 'INVEST#sub1', SK: 'INVEST#i1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#', id: 'i1', sub: 'sub1', name: 'Stocks', type: 'stocks' as const, currency: 'SGD', value: 50000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdAccount]);
    mockQueryInvestments.mockResolvedValue([invest]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('60,000.00');
  });

  it('shows Total Assets summing savings + investments + CPF + receivables', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 5000, sa: 0, ma: 0, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    const recv = { PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'Bob', type: 'personal_loan' as const, currency: 'SGD', originalAmount: 2000, outstandingAmount: 2000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdAccount]); // 10000
    mockGetCpf.mockResolvedValue(cpfRecord); // 5000
    mockQueryReceivables.mockResolvedValue([recv]); // 2000
    // Total Assets = 10000 + 0 + 5000 + 2000 = 17000
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('17,000.00');
  });

  it('shows Current Assets excluding CPF', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 5000, sa: 0, ma: 0, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdAccount]); // 10000
    mockGetCpf.mockResolvedValue(cpfRecord); // 5000 (excluded from current assets)
    // Current Assets = 10000 (no investments, no receivables)
    // Total Assets = 10000 + 5000 = 15000
    const res = await handler({} as never, {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('15,000.00'); // Total Assets
    expect(body).toContain('10,000.00'); // Current Assets (and Total Funds)
  });

  it('shows — for Available Funds when no accounts or investments', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Available Funds');
    // With no accounts/investments, value shows —
    expect((res as { body: string }).body).toContain('>—<');
  });
});

describe('GET /dashboard — goals section', () => {
  const sgdAccount = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2026-01-01T00:00:00.000Z', id: 'a1', sub: 'sub1', name: 'POSB', type: 'savings' as const, currency: 'SGD', balance: 100000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const activeGoal = { PK: 'GOAL#sub1', SK: 'GOAL#g1', GSI1PK: 'USER#sub1', GSI1SK: 'GOAL#0000000001#g1', id: 'g1', sub: 'sub1', name: 'Lean FIRE', type: 'lean_fire' as const, tracksAgainst: 'total_savings' as const, targetAmount: 500000, sortOrder: 1, status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

  it('shows active goals with progress bar', async () => {
    mockQueryByUser.mockResolvedValue([sgdAccount]);
    mockQueryGoals.mockResolvedValue([activeGoal]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Lean FIRE');
    expect((res as { body: string }).body).toContain('View all');
    expect((res as { body: string }).body).toContain('20.0%');
  });

  it('shows no target set when goal targetAmount is 0', async () => {
    mockQueryGoals.mockResolvedValue([{ ...activeGoal, targetAmount: 0 }]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('No target set');
  });

  it('shows target when currentValue is null', async () => {
    mockQueryGoals.mockResolvedValue([{ ...activeGoal, tracksAgainst: 'net_worth' as const, targetAmount: 500000 }]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('Target:');
  });

  it('does not show goals section when no active goals', async () => {
    mockQueryGoals.mockResolvedValue([{ ...activeGoal, status: 'achieved' as const }]);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('View all');
  });
});
