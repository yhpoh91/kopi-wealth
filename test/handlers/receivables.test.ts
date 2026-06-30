import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/receivable', () => ({
  getReceivable: vi.fn(),
  queryByUser: vi.fn(),
  putReceivable: vi.fn(),
  updateReceivable: vi.fn(),
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

import { handler } from '../../src/handlers/receivables';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getReceivable, queryByUser, putReceivable, updateReceivable, softDelete, putSnapshot } from '../../src/repositories/receivable';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetReceivable = vi.mocked(getReceivable);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutReceivable = vi.mocked(putReceivable);
const mockUpdateReceivable = vi.mocked(updateReceivable);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

const recv = {
  PK: 'RECV#sub1', SK: 'RECV#id1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#2026-06-29T10:00:00.000Z',
  id: 'id1', sub: 'sub1', name: 'Loan to Bob', type: 'personal_loan' as const, currency: 'SGD',
  originalAmount: 10000, outstandingAmount: 8000, status: 'partially_received' as const,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z',
};

const settledRecv = { ...recv, id: 'id2', SK: 'RECV#id2', outstandingAmount: 0, status: 'settled' as const };

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
  mockGetReceivable.mockResolvedValue(null);
  mockPutReceivable.mockResolvedValue(undefined);
  mockUpdateReceivable.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.75 }, date: '2026-06-29' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /receivables', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
  });

  it('renders empty state when no receivables', async () => {
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No receivables yet');
    expect(res.body).toContain('—');
  });

  it('renders receivables with total', async () => {
    mockQueryByUser.mockResolvedValue([recv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Loan to Bob');
    expect(res.body).toContain('SGD 8,000.00');
  });

  it('shows settled receivable with reduced opacity', async () => {
    mockQueryByUser.mockResolvedValue([settledRecv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).toContain('opacity:0.6');
    expect(res.body).toContain('Settled');
  });

  it('active receivables appear before settled', async () => {
    mockQueryByUser.mockResolvedValue([settledRecv, recv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    const activeIdx = res.body.indexOf('partially_received');
    const settledIdx = res.body.indexOf('opacity:0.6');
    expect(activeIdx).toBeLessThan(settledIdx);
  });

  it('shows error banner for invalid error param', async () => {
    const res = await handler(makeEvent('GET', '/receivables', undefined, { query: 'error=invalid' }), {} as never, () => {}) as never;
    expect(res.body).toContain('Please enter valid values.');
  });

  it('shows not_found error banner', async () => {
    const res = await handler(makeEvent('GET', '/receivables', undefined, { query: 'error=not_found' }), {} as never, () => {}) as never;
    expect(res.body).toContain('Receivable not found.');
  });

  it('fetches FX rates when foreign currency receivables exist', async () => {
    const usdRecv = { ...recv, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdRecv]);
    mockConvertAmount.mockReturnValue(12000);
    await handler(makeEvent('GET', '/receivables'), {} as never, () => {});
    expect(mockGetOrFetchRates).toHaveBeenCalledWith('SGD');
  });

  it('shows — when all active receivables are foreign and FX unavailable', async () => {
    const usdRecv = { ...recv, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdRecv]);
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).not.toContain('SGD 0.00');
    expect(res.body).toContain('partial');
  });

  it('shows partial total when some same-currency and some unconverted', async () => {
    const usdRecv = { ...recv, id: 'id3', SK: 'RECV#id3', currency: 'USD' };
    const sgdRecv = { ...recv, outstandingAmount: 5000 };
    mockQueryByUser.mockResolvedValue([sgdRecv, usdRecv]);
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).toContain('SGD 5,000.00');
    expect(res.body).toContain('partial');
  });

  it('shows partial note when FX fetch throws', async () => {
    const usdRecv = { ...recv, currency: 'USD' };
    mockQueryByUser.mockResolvedValue([usdRecv]);
    mockGetOrFetchRates.mockRejectedValue(new Error('FX down'));
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).toContain('partial');
  });

  it('settled receivables excluded from total', async () => {
    mockQueryByUser.mockResolvedValue([recv, settledRecv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).toContain('SGD 8,000.00');
  });

  it('falls back to SGD when settings is null', async () => {
    mockGetSettings.mockResolvedValue(null);
    mockQueryByUser.mockResolvedValue([recv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SGD');
  });

  it('renders progress bar for active receivable', async () => {
    mockQueryByUser.mockResolvedValue([recv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    // (10000 - 8000) / 10000 * 100 = 20%
    expect(res.body).toContain('20.0%');
  });

  it('renders card with pct=0 when originalAmount is 0', async () => {
    const zeroRecv = { ...recv, originalAmount: 0, outstandingAmount: 0, status: 'settled' as const };
    mockQueryByUser.mockResolvedValue([zeroRecv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Loan to Bob');
  });

  it('handles undefined rawQueryString', async () => {
    const event = { ...makeEvent('GET', '/receivables'), rawQueryString: undefined };
    const res = await handler(event as never, {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /receivables — create', () => {
  it('creates a receivable and redirects', async () => {
    const body = 'name=Loan+to+Bob&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/receivables');
    expect(mockPutReceivable).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('defaults outstanding to original when blank', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=';
    await handler(makeEvent('POST', '/receivables', body), {} as never, () => {});
    const call = mockPutReceivable.mock.calls[0][0];
    expect(call.outstandingAmount).toBe(10000);
    expect(call.status).toBe('outstanding');
  });

  it('accepts base64 encoded body', async () => {
    const body = 'name=Loan&type=rental_deposit&currency=SGD&originalAmount=5000&outstandingAmount=5000';
    const res = await handler(makeEvent('POST', '/receivables', body, { base64: true }), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/receivables');
  });

  it('sets status partially_received when outstanding < original', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=5000';
    await handler(makeEvent('POST', '/receivables', body), {} as never, () => {});
    expect(mockPutReceivable.mock.calls[0][0].status).toBe('partially_received');
  });

  it('sets status settled when outstanding is 0', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=0';
    await handler(makeEvent('POST', '/receivables', body), {} as never, () => {});
    expect(mockPutReceivable.mock.calls[0][0].status).toBe('settled');
  });

  it('sets status outstanding when outstanding exceeds original', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=11000';
    await handler(makeEvent('POST', '/receivables', body), {} as never, () => {});
    expect(mockPutReceivable.mock.calls[0][0].status).toBe('outstanding');
  });

  it('redirects invalid when name is missing', async () => {
    const body = 'name=&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects invalid when type is not in enum', async () => {
    const body = 'name=Loan&type=bad_type&currency=SGD&originalAmount=10000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects invalid when currency is missing', async () => {
    const body = 'name=Loan&type=personal_loan&currency=&originalAmount=10000&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects invalid when originalAmount is 0', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=0&outstandingAmount=';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects invalid when outstandingAmount is negative', async () => {
    const body = 'name=Loan&type=personal_loan&currency=SGD&originalAmount=10000&outstandingAmount=-1';
    const res = await handler(makeEvent('POST', '/receivables', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });
});

describe('POST /receivables/:id — update', () => {
  beforeEach(() => {
    mockGetReceivable.mockResolvedValue(recv);
  });

  it('updates outstanding and redirects', async () => {
    const body = 'outstandingAmount=4000';
    const res = await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/receivables');
    expect(mockUpdateReceivable).toHaveBeenCalledOnce();
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('updates status to settled when outstanding is 0', async () => {
    const body = 'outstandingAmount=0';
    await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {});
    expect(mockUpdateReceivable.mock.calls[0][2].status).toBe('settled');
  });

  it('redirects invalid when outstandingAmount is NaN', async () => {
    const body = 'outstandingAmount=abc';
    const res = await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects invalid when outstandingAmount is negative', async () => {
    const body = 'outstandingAmount=-1';
    const res = await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=invalid');
  });

  it('redirects not_found when receivable does not exist', async () => {
    mockGetReceivable.mockResolvedValue(null);
    const body = 'outstandingAmount=4000';
    const res = await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=not_found');
  });

  it('redirects not_found when receivable is soft-deleted', async () => {
    mockGetReceivable.mockResolvedValue({ ...recv, deletedAt: '2026-06-01T00:00:00.000Z', deletedBy: 'sub1' });
    const body = 'outstandingAmount=4000';
    const res = await handler(makeEvent('POST', '/receivables/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/receivables?error=not_found');
  });
});

describe('POST /receivables/:id/delete', () => {
  it('soft deletes and redirects', async () => {
    const res = await handler(makeEvent('POST', '/receivables/id1/delete', ''), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/receivables');
    expect(mockSoftDelete).toHaveBeenCalledWith('sub1', 'id1', 'sub1', '2026-06-29T10:00:00.000Z');
  });
});

describe('GET /receivables — per-card converted amount', () => {
  it('shows ≈ base currency amount when receivable is foreign currency and rate available', async () => {
    const foreignRecv = { ...recv, currency: 'USD', outstandingAmount: 1000 };
    mockQueryByUser.mockResolvedValue([foreignRecv]);
    mockConvertAmount.mockImplementation((amount, from) => from === 'USD' ? amount * 1.35 : null);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).toContain('≈ SGD');
    expect(res.body).toContain('1,350.00');
  });

  it('does not show ≈ line when receivable is base currency', async () => {
    mockQueryByUser.mockResolvedValue([recv]);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).not.toContain('≈ SGD');
  });

  it('does not show ≈ line when foreign rate is unavailable', async () => {
    const foreignRecv = { ...recv, currency: 'USD', outstandingAmount: 1000 };
    mockQueryByUser.mockResolvedValue([foreignRecv]);
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET', '/receivables'), {} as never, () => {}) as never;
    expect(res.body).not.toContain('≈ SGD');
  });
});
