import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/liability', () => ({
  getLiability: vi.fn(),
  queryByUser: vi.fn(),
  putLiability: vi.fn(),
  updateLiability: vi.fn(),
  softDelete: vi.fn(),
  putSnapshot: vi.fn(),
}));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-06-29T10:00:00.000Z') },
}));
vi.mock('node:crypto', () => ({ randomUUID: vi.fn(() => 'uuid-1') }));

import { handler } from '../../src/handlers/liabilities';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getLiability, queryByUser, putLiability, updateLiability, softDelete, putSnapshot } from '../../src/repositories/liability';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetLiability = vi.mocked(getLiability);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutLiability = vi.mocked(putLiability);
const mockUpdateLiability = vi.mocked(updateLiability);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

const liab = {
  PK: 'LIAB#sub1', SK: 'LIAB#id1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#2026-06-29T10:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'Home Loan', type: 'mortgage' as const, currency: 'SGD',
  originalAmount: 500000, outstandingAmount: 450000, status: 'partially_returned' as const,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z',
};

const settledLiab = { ...liab, id: 'id2', SK: 'LIAB#id2', outstandingAmount: 0, status: 'settled' as const };

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
  mockGetLiability.mockResolvedValue(null);
  mockPutLiability.mockResolvedValue(undefined);
  mockUpdateLiability.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.75 }, date: '2026-06-29' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /liabilities', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
  });

  it('renders empty state when no liabilities', async () => {
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No liabilities yet');
    expect(res.body).toContain('—');
  });

  it('renders liabilities with total', async () => {
    mockQueryByUser.mockResolvedValue([liab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Home Loan');
    expect(res.body).toContain('SGD 450,000.00');
  });

  it('shows settled liability with reduced opacity', async () => {
    mockQueryByUser.mockResolvedValue([settledLiab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.body).toContain('opacity:0.6');
    expect(res.body).toContain('Settled');
  });

  it('active liabilities appear before settled', async () => {
    mockQueryByUser.mockResolvedValue([settledLiab, liab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    const activeIdx = res.body.indexOf('partially_returned');
    const settledIdx = res.body.indexOf('opacity:0.6');
    expect(activeIdx).toBeLessThan(settledIdx);
  });

  it('shows error banner for invalid error param', async () => {
    const res = await handler(makeEvent('GET', '/liabilities', undefined, { query: 'error=invalid' }), {} as never, () => {}) as never;
    expect(res.body).toContain('Please enter valid values.');
  });

  it('shows not_found error banner', async () => {
    const res = await handler(makeEvent('GET', '/liabilities', undefined, { query: 'error=not_found' }), {} as never, () => {}) as never;
    expect(res.body).toContain('Liability not found.');
  });

  it('fetches FX rates when foreign currency liabilities exist', async () => {
    const usdLiab = { ...liab, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdLiab]);
    mockConvertAmount.mockReturnValue(600000);
    await handler(makeEvent('GET', '/liabilities'), {} as never, () => {});
    expect(mockGetOrFetchRates).toHaveBeenCalledWith('SGD');
  });

  it('shows partial note when FX conversion unavailable', async () => {
    const usdLiab = { ...liab, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdLiab]);
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.body).toContain('partial');
  });

  it('shows partial note when FX fetch throws', async () => {
    const usdLiab = { ...liab, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdLiab]);
    mockGetOrFetchRates.mockRejectedValue(new Error('FX down'));
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.body).toContain('partial');
  });

  it('settled liabilities excluded from total', async () => {
    mockQueryByUser.mockResolvedValue([liab, settledLiab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    // Only liab outstanding (450000) included, not settledLiab (0)
    expect(res.body).toContain('SGD 450,000.00');
  });

  it('falls back to SGD when settings is null', async () => {
    mockGetSettings.mockResolvedValue(null);
    mockQueryByUser.mockResolvedValue([liab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SGD');
  });

  it('renders progress bar for active liability', async () => {
    mockQueryByUser.mockResolvedValue([liab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    // Progress bar = (500000 - 450000) / 500000 * 100 = 10%
    expect(res.body).toContain('10.0%');
  });

  it('caps progress bar at 100% when outstanding > original (interest case)', async () => {
    const interestLiab = { ...liab, outstandingAmount: 600000, status: 'outstanding' as const };
    mockQueryByUser.mockResolvedValue([interestLiab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.body).toContain('0.0%');
  });

  it('handles undefined rawQueryString', async () => {
    const event = { ...makeEvent('GET', '/liabilities'), rawQueryString: undefined };
    const res = await handler(event as never, {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
  });

  it('renders card with pct=0 when originalAmount is 0', async () => {
    const zeroOrigLiab = { ...liab, originalAmount: 0, outstandingAmount: 0, status: 'settled' as const };
    mockQueryByUser.mockResolvedValue([zeroOrigLiab]);
    const res = await handler(makeEvent('GET', '/liabilities'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Home Loan');
  });
});

describe('POST /liabilities — create', () => {
  it('creates a liability and redirects', async () => {
    const body = 'name=Home+Loan&type=mortgage&currency=SGD&originalAmount=500000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/liabilities');
    expect(mockPutLiability).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('defaults outstanding to original when blank', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=100000&outstandingAmount=';
    await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {});
    const call = mockPutLiability.mock.calls[0][0];
    expect(call.outstandingAmount).toBe(100000);
    expect(call.status).toBe('outstanding');
  });

  it('accepts base64 encoded body', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=5000';
    const res = await handler(makeEvent('POST', '/liabilities', body, { base64: true }), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/liabilities');
  });

  it('sets status partially_returned when outstanding < original', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=500000&outstandingAmount=200000';
    await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {});
    expect(mockPutLiability.mock.calls[0][0].status).toBe('partially_returned');
  });

  it('sets status settled when outstanding is 0', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=500000&outstandingAmount=0';
    await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {});
    expect(mockPutLiability.mock.calls[0][0].status).toBe('settled');
  });

  it('sets status outstanding when outstanding exceeds original (interest)', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=100000&outstandingAmount=110000';
    await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {});
    expect(mockPutLiability.mock.calls[0][0].status).toBe('outstanding');
  });

  it('redirects invalid when name is missing', async () => {
    const body = 'name=&type=mortgage&currency=SGD&originalAmount=500000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects invalid when type is not in enum', async () => {
    const body = 'name=Loan&type=bad_type&currency=SGD&originalAmount=500000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects invalid when currency is missing', async () => {
    const body = 'name=Loan&type=mortgage&currency=&originalAmount=500000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects invalid when originalAmount is 0', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=0&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects invalid when outstandingAmount is negative', async () => {
    const body = 'name=Loan&type=mortgage&currency=SGD&originalAmount=500000&outstandingAmount=-1';
    const res = await handler(makeEvent('POST', '/liabilities', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });
});

describe('POST /liabilities/:id — update', () => {
  beforeEach(() => {
    mockGetLiability.mockResolvedValue(liab);
  });

  it('updates outstanding and redirects', async () => {
    const body = 'outstandingAmount=400000';
    const res = await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/liabilities');
    expect(mockUpdateLiability).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('updates status to settled when outstanding is 0', async () => {
    const body = 'outstandingAmount=0';
    await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {});
    expect(mockUpdateLiability.mock.calls[0][2].status).toBe('settled');
  });

  it('redirects invalid when outstandingAmount is NaN', async () => {
    const body = 'outstandingAmount=abc';
    const res = await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects invalid when outstandingAmount is negative', async () => {
    const body = 'outstandingAmount=-1';
    const res = await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=invalid');
  });

  it('redirects not_found when liability does not exist', async () => {
    mockGetLiability.mockResolvedValue(null);
    const body = 'outstandingAmount=400000';
    const res = await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=not_found');
  });

  it('redirects not_found when liability is soft-deleted', async () => {
    mockGetLiability.mockResolvedValue({ ...liab, deletedAt: '2026-06-01T00:00:00.000Z', deletedBy: 'sub1' });
    const body = 'outstandingAmount=400000';
    const res = await handler(makeEvent('POST', '/liabilities/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/liabilities?error=not_found');
  });
});

describe('POST /liabilities/:id/delete', () => {
  it('soft deletes and redirects', async () => {
    const res = await handler(makeEvent('POST', '/liabilities/id1/delete', ''), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/liabilities');
    expect(mockSoftDelete).toHaveBeenCalledWith('sub1', 'id1', 'sub1', '2026-06-29T10:00:00.000Z');
  });
});
