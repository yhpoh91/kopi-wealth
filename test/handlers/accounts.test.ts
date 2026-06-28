import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/account', () => ({
  getAccount: vi.fn(),
  queryByUser: vi.fn(),
  putAccount: vi.fn(),
  updateAccount: vi.fn(),
  softDelete: vi.fn(),
  putSnapshot: vi.fn(),
}));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowMs: vi.fn(() => new Date('2026-06-28T12:00:00.000Z').getTime()), nowIso: vi.fn(() => '2026-06-28T12:00:00.000Z'), today: vi.fn(() => '2026-06-28') },
}));

import { handler } from '../../src/handlers/accounts';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getAccount, queryByUser, putAccount, updateAccount, softDelete, putSnapshot } from '../../src/repositories/account';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';
import { clock } from '../../src/lib/clock';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetAccount = vi.mocked(getAccount);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutAccount = vi.mocked(putAccount);
const mockUpdateAccount = vi.mocked(updateAccount);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);
const mockClock = vi.mocked(clock);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const account = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#id1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'DBS Savings', type: 'savings' as const, balance: 10000, currency: 'SGD', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent(method: string, path: string, body?: string, opts: { base64?: boolean; query?: string } = {}) {
  const parts = path.split('/').filter(Boolean);
  return {
    requestContext: { http: { method } },
    rawPath: path,
    rawQueryString: opts.query ?? '',
    pathParameters: parts[1] ? { id: parts[1] } : undefined,
    body: opts.base64 ? Buffer.from(body ?? '').toString('base64') : body,
    isBase64Encoded: opts.base64 ?? false,
    cookies: ['sid=s1'],
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockQueryByUser.mockResolvedValue([]);
  mockPutAccount.mockResolvedValue(undefined);
  mockUpdateAccount.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /accounts', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML', async () => {
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('shows empty state when no accounts', async () => {
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('No accounts yet');
  });

  it('renders account cards', async () => {
    mockQueryByUser.mockResolvedValue([account]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS Savings');
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('shows summary bar with total when accounts present', async () => {
    mockQueryByUser.mockResolvedValue([account]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Total Balance');
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('hides summary bar when no accounts', async () => {
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('Total Balance');
  });

  it('shows section header for account type', async () => {
    mockQueryByUser.mockResolvedValue([account]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Savings');
  });

  it('shows updated relative time on card', async () => {
    mockQueryByUser.mockResolvedValue([account]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Updated ');
  });

  it('shows converted home-currency value for foreign accounts', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 1351.35);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('≈ SGD');
  });

  it('shows conversion rate and tooltip for foreign accounts', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 1351.35);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('1 USD =');
    expect((res as { body: string }).body).toContain('Rate as of 2026-06-28');
  });

  it('shows "Rate unavailable" tooltip when ratesDate is empty string', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 1351.35);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Rate unavailable');
  });

  it('shows no rate info when rate is not in rates map', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    // USD not in rates map → rate undefined → rateLabel empty → no tooltip
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 1351.35);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('Rate as of');
  });

  it('shows fallback dash when FX conversion unavailable', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('≈ SGD —');
  });

  it('handles FX fetch failure gracefully', async () => {
    const usdAccount = { ...account, currency: 'USD', balance: 1000 };
    mockQueryByUser.mockResolvedValue([usdAccount]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network error'));
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect((res as { body: string }).body).toContain('(partial)');
  });

  it('escapes XSS in account name', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, name: '<script>alert(1)</script>' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('<script>alert(1)</script>');
  });

  it('shows institution when present', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, institution: 'DBS' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS');
  });

  it('shows notes on card when present', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, notes: 'joint account' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('joint account');
  });

  it('renders card without institution', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, institution: undefined }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS Savings');
  });

  it('shows error banner when error query param present', async () => {
    const res = await handler(makeEvent('GET', '/accounts', undefined, { query: 'error=invalid&name=X&type=savings&currency=SGD&balance=abc' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Validation failed');
  });

  it('shows error banner with empty params when only error present', async () => {
    const res = await handler(makeEvent('GET', '/accounts', undefined, { query: 'error=invalid_balance' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Validation failed');
  });

  it('shows "yesterday" for accounts updated 1 day ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    mockQueryByUser.mockResolvedValue([{ ...account, updatedAt: '2026-06-27T12:00:00.000Z' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('yesterday');
  });

  it('shows "days ago" for accounts updated a few days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    mockQueryByUser.mockResolvedValue([{ ...account, updatedAt: '2026-06-23T12:00:00.000Z' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('days ago');
  });

  it('shows "today" for accounts updated today', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    mockQueryByUser.mockResolvedValue([{ ...account, updatedAt: '2026-06-28T06:00:00.000Z' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('today');
  });

  it('shows "months ago" for accounts updated over 30 days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const twoMonthsAgo = new Date(new Date('2026-06-28T12:00:00.000Z').getTime() - 65 * 86400000).toISOString();
    mockQueryByUser.mockResolvedValue([{ ...account, updatedAt: twoMonthsAgo }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('months ago');
  });

  it('shows singular "month ago" for accounts updated ~30 days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const oneMonthAgo = new Date(new Date('2026-06-28T12:00:00.000Z').getTime() - 35 * 86400000).toISOString();
    mockQueryByUser.mockResolvedValue([{ ...account, updatedAt: oneMonthAgo }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('1 month ago');
  });

  it('shows partial note in type breakdown when FX fails', async () => {
    const usdAccount = { ...account, id: 'id2', currency: 'USD', balance: 500 };
    mockQueryByUser.mockResolvedValue([account, usdAccount]);
    mockGetOrFetchRates.mockRejectedValue(new Error('fail'));
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('groups accounts by type with section headers', async () => {
    const checkingAccount = { ...account, id: 'id2', type: 'checking' as const, name: 'OCBC 360' };
    mockQueryByUser.mockResolvedValue([account, checkingAccount]);
    mockConvertAmount.mockReturnValue(10000);
    const body = (await handler(makeEvent('GET', '/accounts'), {} as never, () => {})) as { body: string };
    expect(body.body).toContain('Savings');
    expect(body.body).toContain('Checking');
    expect(body.body).toContain('DBS Savings');
    expect(body.body).toContain('OCBC 360');
  });

  it('shows currency and balance paired in edit panel', async () => {
    mockQueryByUser.mockResolvedValue([account]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('cursor:not-allowed');
  });
});

describe('POST /accounts (create)', () => {
  const validBody = new URLSearchParams({ name: 'DBS Savings', type: 'savings', currency: 'SGD', balance: '10000' }).toString();

  it('creates account and redirects', async () => {
    const res = await handler(makeEvent('POST', '/accounts', validBody), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/accounts' } });
    expect(mockPutAccount).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('redirects on invalid balance', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'SGD', balance: 'abc' }).toString();
    const res = await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on negative balance', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'SGD', balance: '-1' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on invalid type', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'invalid', currency: 'SGD', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on invalid currency', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'XYZ', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on missing name', async () => {
    const body = new URLSearchParams({ name: '', type: 'savings', currency: 'SGD', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('stores optional institution and notes', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'SGD', balance: '100', institution: 'DBS', notes: 'primary' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount.mock.calls[0][0]).toMatchObject({ institution: 'DBS', notes: 'primary' });
  });

  it('creates account from base64-encoded body', async () => {
    const body = new URLSearchParams({ name: 'DBS Savings', type: 'savings', currency: 'SGD', balance: '10000' }).toString();
    const res = await handler(makeEvent('POST', '/accounts', body, { base64: true }), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/accounts' } });
    expect(mockPutAccount).toHaveBeenCalledOnce();
  });
});

describe('POST /accounts/:id (update account)', () => {
  it('updates account and redirects', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ name: 'DBS Updated', type: 'checking', balance: '20000' }).toString();
    const res = await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/accounts' } });
    expect(mockUpdateAccount).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({ name: 'DBS Updated', type: 'checking', balance: 20000 }), expect.any(String));
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('redirects on invalid balance', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ name: 'DBS', type: 'savings', balance: 'bad' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });

  it('redirects on missing name', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ name: '', type: 'savings', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });

  it('redirects on invalid type', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ name: 'DBS', type: 'invalid', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });

  it('redirects when account not found', async () => {
    mockGetAccount.mockResolvedValue(null);
    const body = new URLSearchParams({ name: 'X', type: 'savings', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/missing', body), {} as never, () => {});
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });

  it('redirects when account is deleted', async () => {
    mockGetAccount.mockResolvedValue({ ...account, deletedAt: '2024-01-02T00:00:00.000Z' });
    const body = new URLSearchParams({ name: 'X', type: 'savings', balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateAccount).not.toHaveBeenCalled();
  });

  it('passes institution and notes through', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ name: 'DBS', type: 'savings', balance: '100', institution: 'DBS Bank', notes: 'joint' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateAccount).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({ institution: 'DBS Bank', notes: 'joint' }), expect.any(String));
  });
});

describe('POST /accounts/:id/delete', () => {
  it('soft-deletes account and redirects', async () => {
    const res = await handler(makeEvent('POST', '/accounts/id1/delete', ''), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/accounts' } });
    expect(mockSoftDelete).toHaveBeenCalledWith('sub1', 'id1', 'sub1', expect.any(String));
  });
});

describe('POST /accounts with empty body', () => {
  it('redirects on empty body', async () => {
    const res = await handler(makeEvent('POST', '/accounts', undefined), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutAccount).not.toHaveBeenCalled();
  });
});
