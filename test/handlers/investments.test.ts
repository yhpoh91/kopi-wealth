import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/investment', () => ({
  getInvestment: vi.fn(),
  queryByUser: vi.fn(),
  putInvestment: vi.fn(),
  updateInvestment: vi.fn(),
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

import { handler } from '../../src/handlers/investments';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getInvestment, queryByUser, putInvestment, updateInvestment, softDelete, putSnapshot } from '../../src/repositories/investment';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';
import { clock } from '../../src/lib/clock';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetInvestment = vi.mocked(getInvestment);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutInvestment = vi.mocked(putInvestment);
const mockUpdateInvestment = vi.mocked(updateInvestment);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);
const mockClock = vi.mocked(clock);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const investment = {
  PK: 'INVEST#sub1', SK: 'INVEST#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INVEST#2024-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'IWDA', type: 'etf' as const, currency: 'USD', value: 10000,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

function makeEvent(method: string, path: string, body?: string, opts: { base64?: boolean; query?: string } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    rawQueryString: opts.query ?? '',
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
  mockPutInvestment.mockResolvedValue(undefined);
  mockUpdateInvestment.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /investments', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML', async () => {
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('shows empty state when no investments', async () => {
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('No investments yet');
  });

  it('renders investment card with name and value', async () => {
    const sgdInv = { ...investment, currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('IWDA');
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('shows summary bar with total when investments present', async () => {
    const sgdInv = { ...investment, currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Total Investments');
  });

  it('hides summary bar when no investments', async () => {
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('Total Investments');
  });

  it('shows type label in section header', async () => {
    const sgdInv = { ...investment, currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('ETF');
  });

  it('groups investments by type', async () => {
    const stocksInv = { ...investment, id: 'id2', SK: 'INVEST#id2', name: 'AAPL', type: 'stocks' as const, currency: 'SGD' };
    const sgdInv = { ...investment, currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv, stocksInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('ETF');
    expect((res as { body: string }).body).toContain('Stocks');
    expect((res as { body: string }).body).toContain('IWDA');
    expect((res as { body: string }).body).toContain('AAPL');
  });

  it('shows relative time on card', async () => {
    const sgdInv = { ...investment, currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Updated ');
  });

  it('shows "today" for investments updated today', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const sgdInv = { ...investment, currency: 'SGD', updatedAt: '2026-06-28T06:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('today');
  });

  it('shows "yesterday" for investments updated 1 day ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const sgdInv = { ...investment, currency: 'SGD', updatedAt: '2026-06-27T12:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('yesterday');
  });

  it('shows "days ago" for investments updated a few days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const sgdInv = { ...investment, currency: 'SGD', updatedAt: '2026-06-23T12:00:00.000Z' };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('days ago');
  });

  it('shows "months ago" for investments updated over 30 days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const old = new Date(new Date('2026-06-28T12:00:00.000Z').getTime() - 65 * 86400000).toISOString();
    const sgdInv = { ...investment, currency: 'SGD', updatedAt: old };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('months ago');
  });

  it('shows singular "month ago" for investments updated ~30 days ago', async () => {
    mockClock.nowMs.mockReturnValue(new Date('2026-06-28T12:00:00.000Z').getTime());
    const old = new Date(new Date('2026-06-28T12:00:00.000Z').getTime() - 35 * 86400000).toISOString();
    const sgdInv = { ...investment, currency: 'SGD', updatedAt: old };
    mockQueryByUser.mockResolvedValue([sgdInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('1 month ago');
  });

  it('shows converted home-currency value for foreign investments', async () => {
    mockQueryByUser.mockResolvedValue([investment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 13513.51);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('≈ SGD');
  });

  it('shows conversion rate and tooltip for foreign investments', async () => {
    mockQueryByUser.mockResolvedValue([investment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-28' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 13513.51);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('1 USD =');
    expect((res as { body: string }).body).toContain('Rate as of 2026-06-28');
  });

  it('shows "Rate unavailable" tooltip when ratesDate is empty', async () => {
    mockQueryByUser.mockResolvedValue([investment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '' });
    mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : 13513.51);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Rate unavailable');
  });

  it('shows fallback dash when FX conversion unavailable', async () => {
    mockQueryByUser.mockResolvedValue([investment]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('≈ SGD —');
  });

  it('handles FX fetch failure gracefully', async () => {
    mockQueryByUser.mockResolvedValue([investment]);
    mockGetOrFetchRates.mockRejectedValue(new Error('network error'));
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect((res as { body: string }).body).toContain('(partial)');
  });

  it('shows partial note in type breakdown when FX fails', async () => {
    const inv2 = { ...investment, id: 'id2', SK: 'INVEST#id2', currency: 'MYR' };
    mockQueryByUser.mockResolvedValue([investment, inv2]);
    mockGetOrFetchRates.mockRejectedValue(new Error('fail'));
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('partial');
  });

  it('escapes XSS in investment name', async () => {
    const xssInv = { ...investment, currency: 'SGD', name: '<script>alert(1)</script>' };
    mockQueryByUser.mockResolvedValue([xssInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('<script>alert(1)</script>');
  });

  it('shows institution when present', async () => {
    mockQueryByUser.mockResolvedValue([{ ...investment, currency: 'SGD', institution: 'IBKR' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('IBKR');
  });

  it('shows notes on card when present', async () => {
    mockQueryByUser.mockResolvedValue([{ ...investment, currency: 'SGD', notes: 'core portfolio' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('core portfolio');
  });

  it('currency input is disabled (locked after creation)', async () => {
    mockQueryByUser.mockResolvedValue([{ ...investment, currency: 'SGD' }]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('cursor:not-allowed');
  });

  it('shows error banner when error query param present', async () => {
    const res = await handler(makeEvent('GET', '/investments', undefined, { query: 'error=invalid&name=X&type=etf&currency=SGD&value=abc' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Validation failed');
  });

  it('shows error banner with empty params when only error present', async () => {
    const res = await handler(makeEvent('GET', '/investments', undefined, { query: 'error=invalid_value' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Validation failed');
  });

  it('handles undefined rawQueryString gracefully', async () => {
    const event = { requestContext: { http: { method: 'GET' } }, rawPath: '/investments', rawQueryString: undefined, body: undefined, isBase64Encoded: false, cookies: ['sid=s1'], headers: {} } as never;
    const res = await handler(event, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('shows type breakdown in summary bar', async () => {
    const sgdInv = { ...investment, currency: 'SGD' };
    const stocksInv = { ...investment, id: 'id2', SK: 'INVEST#id2', type: 'stocks' as const, name: 'AAPL', currency: 'SGD' };
    mockQueryByUser.mockResolvedValue([sgdInv, stocksInv]);
    mockConvertAmount.mockReturnValue(10000);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('ETF');
    expect((res as { body: string }).body).toContain('Stocks');
  });

  it('does not fetch FX when all investments are in base currency', async () => {
    mockQueryByUser.mockResolvedValue([{ ...investment, currency: 'SGD' }]);
    const res = await handler(makeEvent('GET', '/investments'), {} as never, () => {});
    expect(mockGetOrFetchRates).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 200 });
  });
});

describe('POST /investments (create)', () => {
  const validBody = new URLSearchParams({ name: 'IWDA', type: 'etf', currency: 'USD', value: '10000' }).toString();

  it('creates investment and redirects', async () => {
    const res = await handler(makeEvent('POST', '/investments', validBody), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/investments' } });
    expect(mockPutInvestment).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('redirects on invalid value', async () => {
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', currency: 'SGD', value: 'abc' }).toString();
    const res = await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });

  it('redirects on negative value', async () => {
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', currency: 'SGD', value: '-1' }).toString();
    await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });

  it('redirects on invalid type', async () => {
    const body = new URLSearchParams({ name: 'IWDA', type: 'invalid', currency: 'SGD', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });

  it('redirects on invalid currency', async () => {
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', currency: 'XYZ', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });

  it('redirects on missing name', async () => {
    const body = new URLSearchParams({ name: '', type: 'etf', currency: 'SGD', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });

  it('stores optional institution and notes', async () => {
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', currency: 'USD', value: '100', institution: 'IBKR', notes: 'core' }).toString();
    await handler(makeEvent('POST', '/investments', body), {} as never, () => {});
    expect(mockPutInvestment.mock.calls[0][0]).toMatchObject({ institution: 'IBKR', notes: 'core' });
  });

  it('creates investment from base64-encoded body', async () => {
    const res = await handler(makeEvent('POST', '/investments', validBody, { base64: true }), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/investments' } });
    expect(mockPutInvestment).toHaveBeenCalledOnce();
  });

  it('redirects on empty body', async () => {
    const res = await handler(makeEvent('POST', '/investments', undefined), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutInvestment).not.toHaveBeenCalled();
  });
});

describe('POST /investments/:id (update)', () => {
  it('updates investment and redirects', async () => {
    mockGetInvestment.mockResolvedValue(investment);
    const body = new URLSearchParams({ name: 'IWDA Updated', type: 'etf', value: '12000' }).toString();
    const res = await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/investments' } });
    expect(mockUpdateInvestment).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({ name: 'IWDA Updated', type: 'etf', value: 12000 }), expect.any(String));
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('redirects on invalid value', async () => {
    mockGetInvestment.mockResolvedValue(investment);
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', value: 'bad' }).toString();
    await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(mockUpdateInvestment).not.toHaveBeenCalled();
  });

  it('redirects on missing name', async () => {
    mockGetInvestment.mockResolvedValue(investment);
    const body = new URLSearchParams({ name: '', type: 'etf', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(mockUpdateInvestment).not.toHaveBeenCalled();
  });

  it('redirects on invalid type', async () => {
    mockGetInvestment.mockResolvedValue(investment);
    const body = new URLSearchParams({ name: 'IWDA', type: 'invalid', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(mockUpdateInvestment).not.toHaveBeenCalled();
  });

  it('redirects when investment not found', async () => {
    mockGetInvestment.mockResolvedValue(null);
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments/missing', body), {} as never, () => {});
    expect(mockUpdateInvestment).not.toHaveBeenCalled();
  });

  it('redirects when investment is deleted', async () => {
    mockGetInvestment.mockResolvedValue({ ...investment, deletedAt: '2024-01-02T00:00:00.000Z' });
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', value: '100' }).toString();
    await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(mockUpdateInvestment).not.toHaveBeenCalled();
  });

  it('passes institution and notes through on update', async () => {
    mockGetInvestment.mockResolvedValue(investment);
    const body = new URLSearchParams({ name: 'IWDA', type: 'etf', value: '100', institution: 'Syfe', notes: 'growth' }).toString();
    await handler(makeEvent('POST', '/investments/id1', body), {} as never, () => {});
    expect(mockUpdateInvestment).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({ institution: 'Syfe', notes: 'growth' }), expect.any(String));
  });
});

describe('POST /investments/:id/delete', () => {
  it('soft-deletes investment and redirects', async () => {
    const res = await handler(makeEvent('POST', '/investments/id1/delete', ''), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/investments' } });
    expect(mockSoftDelete).toHaveBeenCalledWith('sub1', 'id1', 'sub1', expect.any(String));
  });
});
