import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/income', () => ({ queryIncomeByUser: vi.fn() }));
vi.mock('../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-07-05T10:00:00.000Z'), today: vi.fn(() => '2026-07-05') },
}));

import { handler } from '../../src/handlers/cashFlowHub';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { queryIncomeByUser } from '../../src/repositories/income';
import { getAccountManagementUrl } from '../../src/lib/account-management';
import type { IncomeSource } from '../../src/types/income';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockQueryIncomeByUser = vi.mocked(queryIncomeByUser);
const mockGetAccountManagementUrl = vi.mocked(getAccountManagementUrl);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

const salarySource: IncomeSource = {
  PK: 'INCOME#sub1', SK: 'INCOME#id1', GSI1PK: 'USER#sub1', GSI1SK: 'INCOME#2026-01-01T00:00:00.000Z',
  id: 'id1', sub: 'sub1', type: 'salary', name: 'Main job', amount: 5000, currency: 'SGD', frequency: 'monthly',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeEvent() {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/cash-flow',
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
  mockQueryIncomeByUser.mockResolvedValue([]);
  mockGetAccountManagementUrl.mockResolvedValue('');
});

describe('GET /cash-flow', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('renders 200 with Cash Flow title', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Cash Flow');
  });

  it('renders link to /expenses/items', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/expenses/items');
  });

  it('renders Income card linking to /income', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Income');
    expect(res.body).toContain('/income');
  });

  it('shows No sources yet when no income', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('No sources yet');
  });

  it('shows income monthly estimate when sources exist', async () => {
    mockQueryIncomeByUser.mockResolvedValue([salarySource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('5,000.00');
    expect(res.body).toContain('/ mo');
  });

  it('converts foreign currency income via exchangeRate', async () => {
    const usdSource: IncomeSource = { ...salarySource, id: 'id2', SK: 'INCOME#id2', currency: 'USD', amount: 100, frequency: 'monthly', exchangeRate: 1.35 };
    mockQueryIncomeByUser.mockResolvedValue([usdSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('135.00');
  });

  it('excludes ended income sources from monthly estimate', async () => {
    const endedSource: IncomeSource = { ...salarySource, id: 'id3', SK: 'INCOME#id3', endDate: '2026-01-31' };
    mockQueryIncomeByUser.mockResolvedValue([endedSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('No sources yet');
  });

  it('shows partial mark when foreign income has no exchangeRate', async () => {
    const usdSource: IncomeSource = { ...salarySource, id: 'id2', SK: 'INCOME#id2', currency: 'USD', amount: 100, frequency: 'monthly' };
    mockQueryIncomeByUser.mockResolvedValue([usdSource]);
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('~');
  });

  it('Budget still shows Coming soon', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Budget');
    expect(res.body).toContain('Coming soon');
  });

  it('falls back gracefully when no settings', async () => {
    mockGetSettings.mockResolvedValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number };
    expect(res.statusCode).toBe(200);
  });

  it('uses displayName from settings when present', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: 'My Name' });
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('My Name');
  });
});
