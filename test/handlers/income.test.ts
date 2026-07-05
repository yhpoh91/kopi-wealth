import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/income', () => ({
  queryIncomeByUser: vi.fn(),
  getIncome: vi.fn(),
  putIncome: vi.fn(),
  updateIncome: vi.fn(),
  softDeleteIncome: vi.fn(),
}));
vi.mock('../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-07-05T10:00:00.000Z'), today: vi.fn(() => '2026-07-05') },
}));

import { handler } from '../../src/handlers/income';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { queryIncomeByUser, getIncome, putIncome, updateIncome, softDeleteIncome } from '../../src/repositories/income';
import { getAccountManagementUrl } from '../../src/lib/account-management';
import type { IncomeSource } from '../../src/types/income';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockQueryIncomeByUser = vi.mocked(queryIncomeByUser);
const mockGetIncome = vi.mocked(getIncome);
const mockPutIncome = vi.mocked(putIncome);
const mockUpdateIncome = vi.mocked(updateIncome);
const mockSoftDeleteIncome = vi.mocked(softDeleteIncome);
const mockGetAccountManagementUrl = vi.mocked(getAccountManagementUrl);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

const salarySource: IncomeSource = {
  PK: 'INCOME#sub1', SK: 'INCOME#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INCOME#2026-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', type: 'salary', name: 'Main job', amount: 5000, currency: 'SGD', frequency: 'monthly',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const rentalSource: IncomeSource = {
  ...salarySource, id: 'id2', SK: 'INCOME#id2', type: 'rental', name: 'Condo', amount: 2200, frequency: 'monthly',
};

const endedSource: IncomeSource = {
  ...salarySource, id: 'id3', SK: 'INCOME#id3', name: 'Old rental', amount: 1800, frequency: 'monthly', endDate: '2026-03-31',
};

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/income',
    rawQueryString: '',
    cookies: ['sid=s1'],
    headers: {},
    isBase64Encoded: false,
    body: '',
    ...overrides,
  } as never;
}

function postEvent(path: string, body: string) {
  return makeEvent({ requestContext: { http: { method: 'POST' } }, rawPath: path, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockQueryIncomeByUser.mockResolvedValue([]);
  mockGetIncome.mockResolvedValue(salarySource);
  mockPutIncome.mockResolvedValue(undefined);
  mockUpdateIncome.mockResolvedValue(undefined);
  mockSoftDeleteIncome.mockResolvedValue(undefined);
  mockGetAccountManagementUrl.mockResolvedValue('');
});

describe('GET /income', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 with Income title', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Income');
  });

  it('shows empty state when no sources', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('No income sources yet');
  });

  it('shows sources grouped by type', async () => {
    mockQueryIncomeByUser.mockResolvedValue([salarySource, rentalSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Salary');
    expect(res.body).toContain('Rental');
    expect(res.body).toContain('Main job');
    expect(res.body).toContain('Condo');
  });

  it('shows monthly estimate', async () => {
    mockQueryIncomeByUser.mockResolvedValue([salarySource, rentalSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Est. monthly income');
    expect(res.body).toContain('7,200.00'); // 5000 + 2200
  });

  it('shows Ended group for ended sources', async () => {
    mockQueryIncomeByUser.mockResolvedValue([salarySource, endedSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Ended');
    expect(res.body).toContain('Old rental');
  });

  it('excludes ended sources from monthly estimate', async () => {
    mockQueryIncomeByUser.mockResolvedValue([endedSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    // No "Est. monthly income" shown when no active sources
    expect(res.body).not.toContain('Est. monthly income');
  });

  it('shows base equivalent for non-base-currency source with exchangeRate', async () => {
    const usdSource: IncomeSource = { ...salarySource, id: 'id4', SK: 'INCOME#id4', currency: 'USD', amount: 100, frequency: 'monthly', exchangeRate: 1.35 };
    mockQueryIncomeByUser.mockResolvedValue([usdSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('≈ SGD');
    expect(res.body).toContain('135.00');
  });

  it('marks partial when source has no exchangeRate for foreign currency', async () => {
    const usdSource: IncomeSource = { ...salarySource, id: 'id5', SK: 'INCOME#id5', currency: 'USD', amount: 100, frequency: 'monthly' };
    mockQueryIncomeByUser.mockResolvedValue([usdSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    // partial mark shown when some sources can't be converted
    expect(res.body).toContain('partial');
  });

  it('shows error banner when ?error param present', async () => {
    const res = await handler(makeEvent({ rawQueryString: 'error=invalid' }), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Invalid input');
  });

  it('renders type label when source has no name', async () => {
    const noNameSource: IncomeSource = { ...salarySource, name: undefined };
    mockQueryIncomeByUser.mockResolvedValue([noNameSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Salary income');
  });
});

describe('POST /income (create)', () => {
  it('creates source and redirects', async () => {
    const res = await handler(postEvent('/income', 'type=salary&currency=SGD&amount=5000&frequency=monthly'), {} as never, () => {});
    expect(mockPutIncome).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income' } });
  });

  it('stores valid startDate when provided', async () => {
    await handler(postEvent('/income', 'type=salary&currency=SGD&amount=5000&frequency=monthly&startDate=2026-01-01'), {} as never, () => {});
    const item = mockPutIncome.mock.calls[0][0];
    expect(item.startDate).toBe('2026-01-01');
  });

  it('handles base64-encoded body', async () => {
    const b64 = Buffer.from('type=salary&currency=SGD&amount=5000&frequency=monthly').toString('base64');
    const res = await handler(makeEvent({ requestContext: { http: { method: 'POST' } }, rawPath: '/income', body: b64, isBase64Encoded: true }), {} as never, () => {});
    expect(mockPutIncome).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('auto-generates name when blank', async () => {
    await handler(postEvent('/income', 'type=rental&currency=SGD&amount=2000&frequency=monthly&name='), {} as never, () => {});
    expect(mockPutIncome).toHaveBeenCalledOnce();
    const item = mockPutIncome.mock.calls[0][0];
    expect(item.name).toBe('Rental income');
  });

  it('stores exchangeRate when provided', async () => {
    await handler(postEvent('/income', 'type=other&currency=USD&amount=100&frequency=monthly&exchangeRate=1.35'), {} as never, () => {});
    const item = mockPutIncome.mock.calls[0][0];
    expect(item.exchangeRate).toBe(1.35);
  });

  it('omits exchangeRate when not provided', async () => {
    await handler(postEvent('/income', 'type=salary&currency=SGD&amount=5000&frequency=monthly'), {} as never, () => {});
    const item = mockPutIncome.mock.calls[0][0];
    expect(item.exchangeRate).toBeUndefined();
  });

  it('rejects negative amount', async () => {
    const res = await handler(postEvent('/income', 'type=salary&currency=SGD&amount=-100&frequency=monthly'), {} as never, () => {});
    expect(mockPutIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income?error=invalid' } });
  });

  it('rejects zero amount', async () => {
    const res = await handler(postEvent('/income', 'type=salary&currency=SGD&amount=0&frequency=monthly'), {} as never, () => {});
    expect(mockPutIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('rejects invalid frequency', async () => {
    const res = await handler(postEvent('/income', 'type=salary&currency=SGD&amount=5000&frequency=weekly'), {} as never, () => {});
    expect(mockPutIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income?error=invalid' } });
  });

  it('rejects invalid currency', async () => {
    const res = await handler(postEvent('/income', 'type=salary&currency=XYZ&amount=5000&frequency=monthly'), {} as never, () => {});
    expect(mockPutIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income?error=invalid' } });
  });

  it('rejects invalid type', async () => {
    const res = await handler(postEvent('/income', 'type=bonus&currency=SGD&amount=5000&frequency=monthly'), {} as never, () => {});
    expect(mockPutIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302 });
  });
});

describe('POST /income/{id} (update)', () => {
  it('updates source and redirects', async () => {
    const res = await handler(postEvent('/income/id1', 'type=salary&amount=6000&frequency=monthly'), {} as never, () => {});
    expect(mockUpdateIncome).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income' } });
  });

  it('sets endDate when provided', async () => {
    await handler(postEvent('/income/id1', 'type=salary&amount=5000&frequency=monthly&endDate=2026-06-30'), {} as never, () => {});
    const fields = mockUpdateIncome.mock.calls[0][2];
    expect(fields.endDate).toBe('2026-06-30');
  });

  it('sets startDate when provided', async () => {
    await handler(postEvent('/income/id1', 'type=salary&amount=5000&frequency=monthly&startDate=2026-01-01'), {} as never, () => {});
    const fields = mockUpdateIncome.mock.calls[0][2];
    expect(fields.startDate).toBe('2026-01-01');
  });

  it('stores exchangeRate when provided in update', async () => {
    await handler(postEvent('/income/id1', 'type=salary&amount=5000&frequency=monthly&exchangeRate=1.35'), {} as never, () => {});
    const fields = mockUpdateIncome.mock.calls[0][2];
    expect(fields.exchangeRate).toBe(1.35);
  });

  it('clears endDate when blank', async () => {
    await handler(postEvent('/income/id1', 'type=salary&amount=5000&frequency=monthly&endDate='), {} as never, () => {});
    const fields = mockUpdateIncome.mock.calls[0][2];
    expect(fields.endDate).toBeUndefined();
  });

  it('redirects with error when source not found', async () => {
    mockGetIncome.mockResolvedValue(null);
    const res = await handler(postEvent('/income/missing', 'type=salary&amount=5000&frequency=monthly'), {} as never, () => {});
    expect(mockUpdateIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income?error=not_found' } });
  });

  it('redirects with error on invalid update fields', async () => {
    const res = await handler(postEvent('/income/id1', 'type=bonus&amount=5000&frequency=monthly'), {} as never, () => {});
    expect(mockUpdateIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income?error=invalid' } });
  });

  it('redirects with error on invalid amount in update', async () => {
    const res = await handler(postEvent('/income/id1', 'type=salary&amount=-1&frequency=monthly'), {} as never, () => {});
    expect(mockUpdateIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302 });
  });
});

describe('POST /income/{id}/delete', () => {
  it('soft-deletes and redirects', async () => {
    const res = await handler(postEvent('/income/id1/delete', ''), {} as never, () => {});
    expect(mockSoftDeleteIncome).toHaveBeenCalledWith('sub1', 'id1', 'sub1');
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income' } });
  });

  it('redirects silently when source not found', async () => {
    mockGetIncome.mockResolvedValue(null);
    const res = await handler(postEvent('/income/missing/delete', ''), {} as never, () => {});
    expect(mockSoftDeleteIncome).not.toHaveBeenCalled();
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/income' } });
  });
});
