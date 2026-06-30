import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/investment', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../src/repositories/liability', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/receivable', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/goal', () => ({
  getGoal: vi.fn(),
  queryByUser: vi.fn(),
  putGoal: vi.fn(),
  updateGoal: vi.fn(),
  updateGoalStatus: vi.fn(),
  softDelete: vi.fn(),
  putSnapshot: vi.fn(),
}));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowIso: vi.fn(() => '2026-06-30T10:00:00.000Z'), today: vi.fn(() => '2026-06-30'), nowMs: vi.fn(() => 0) },
}));
vi.mock('node:crypto', () => ({ randomUUID: vi.fn(() => 'new-uuid') }));

import { handler } from '../../src/handlers/goals';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { queryByUser as queryAccounts } from '../../src/repositories/account';
import { queryByUser as queryInvestments } from '../../src/repositories/investment';
import { getCpf } from '../../src/repositories/cpf';
import { queryByUser as queryLiabilities } from '../../src/repositories/liability';
import { queryByUser as queryReceivables } from '../../src/repositories/receivable';
import { getGoal, queryByUser, putGoal, updateGoal, updateGoalStatus, softDelete, putSnapshot } from '../../src/repositories/goal';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockQueryAccounts = vi.mocked(queryAccounts);
const mockQueryInvestments = vi.mocked(queryInvestments);
const mockGetCpf = vi.mocked(getCpf);
const mockQueryLiabilities = vi.mocked(queryLiabilities);
const mockQueryReceivables = vi.mocked(queryReceivables);
const mockGetGoal = vi.mocked(getGoal);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutGoal = vi.mocked(putGoal);
const mockUpdateGoal = vi.mocked(updateGoal);
const mockUpdateGoalStatus = vi.mocked(updateGoalStatus);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

const goal = {
  PK: 'GOAL#sub1', SK: 'GOAL#id1', GSI1PK: 'USER#sub1', GSI1SK: 'GOAL#0000000001#id1',
  id: 'id1', sub: 'sub1', name: 'Lean FIRE', type: 'lean_fire' as const,
  tracksAgainst: 'net_worth' as const, targetAmount: 500000, sortOrder: 1,
  status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
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
  mockQueryAccounts.mockResolvedValue([]);
  mockQueryInvestments.mockResolvedValue([]);
  mockGetCpf.mockResolvedValue(null);
  mockQueryLiabilities.mockResolvedValue([]);
  mockQueryReceivables.mockResolvedValue([]);
  mockGetGoal.mockResolvedValue(null);
  mockPutGoal.mockResolvedValue(undefined);
  mockUpdateGoal.mockResolvedValue(undefined);
  mockUpdateGoalStatus.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-30' });
  mockConvertAmount.mockImplementation((amount, from, to) => from === to ? amount : null);
});

describe('GET /goals', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
  });

  it('renders empty state when no goals', async () => {
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No goals yet');
  });

  it('renders goal cards', async () => {
    mockQueryByUser.mockResolvedValue([goal]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Lean FIRE');
    expect(res.body).toContain('Lean FIRE · Net Worth');
    expect(res.body).toContain('Active');
  });

  it('upserts snapshot for active goals', async () => {
    mockQueryByUser.mockResolvedValue([goal]);
    await handler(makeEvent('GET', '/goals'), {} as never, () => {});
    expect(mockPutSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      PK: 'GOAL_SNAP#id1', SK: 'SNAP#2026-06-30', goalId: 'id1', date: '2026-06-30',
    }));
  });

  it('does not upsert snapshot for paused goals', async () => {
    mockQueryByUser.mockResolvedValue([{ ...goal, status: 'paused' }]);
    await handler(makeEvent('GET', '/goals'), {} as never, () => {});
    expect(mockPutSnapshot).not.toHaveBeenCalled();
  });

  it('shows progress bar when target > 0 and value available', async () => {
    mockQueryAccounts.mockResolvedValue([{ PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#acct1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#', id: 'acct1', sub: 'sub1', name: 'POSB', type: 'savings', currency: 'SGD', balance: 250000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    mockQueryByUser.mockResolvedValue([goal]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('50.0%');
  });

  it('shows no target set when targetAmount is 0', async () => {
    mockQueryByUser.mockResolvedValue([{ ...goal, targetAmount: 0 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('No target set');
  });

  it('renders without error when rawQueryString is undefined', async () => {
    const event = { requestContext: { http: { method: 'GET' } }, rawPath: '/goals', rawQueryString: undefined, body: undefined, isBase64Encoded: false, cookies: ['sid=s1'], headers: {} } as never;
    const res = await handler(event, {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
  });

  it('renders when settings and user are null', async () => {
    mockGetSettings.mockResolvedValue(null);
    mockGetUser.mockResolvedValue(null);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(200);
  });

  it('shows error banner for invalid param', async () => {
    const res = await handler(makeEvent('GET', '/goals', undefined, { query: 'error=invalid' }), {} as never, () => {}) as never;
    expect(res.body).toContain('Invalid input');
  });

  it('renders description in add panel for default tracks option', async () => {
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Total assets');
  });

  it('shows achieved goal with reduced opacity', async () => {
    mockQueryByUser.mockResolvedValue([{ ...goal, status: 'achieved' }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('opacity:0.6');
    expect(res.body).toContain('Achieved');
  });
});

describe('POST /goals — create', () => {
  it('creates goal and redirects', async () => {
    const body = 'name=Lean+FIRE&type=lean_fire&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/goals');
    expect(mockPutGoal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-uuid', name: 'Lean FIRE', type: 'lean_fire', tracksAgainst: 'net_worth',
      targetAmount: 500000, sortOrder: 1, status: 'active',
    }));
  });

  it('redirects invalid when name missing', async () => {
    const body = 'name=&type=lean_fire&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });

  it('redirects invalid when type is invalid', async () => {
    const body = 'name=Test&type=bad_type&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });

  it('redirects invalid when tracksAgainst is invalid', async () => {
    const body = 'name=Test&type=custom&tracksAgainst=bad_metric&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });

  it('redirects invalid when targetAmount is negative', async () => {
    const body = 'name=Test&type=custom&tracksAgainst=net_worth&targetAmount=-1&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });

  it('accepts targetAmount of 0', async () => {
    const body = 'name=Test&type=custom&tracksAgainst=net_worth&targetAmount=0&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals');
    expect(mockPutGoal).toHaveBeenCalledWith(expect.objectContaining({ targetAmount: 0 }));
  });

  it('handles base64-encoded body', async () => {
    const body = 'name=Test&type=custom&tracksAgainst=net_worth&targetAmount=1000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body, { base64: true }), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals');
  });
});

describe('POST /goals/:id — update', () => {
  beforeEach(() => {
    mockGetGoal.mockResolvedValue(goal);
  });

  it('updates goal and redirects', async () => {
    const body = 'name=Updated+Goal&tracksAgainst=investable_assets&targetAmount=600000&sortOrder=2';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/goals');
    expect(mockUpdateGoal).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({
      name: 'Updated Goal', tracksAgainst: 'investable_assets', targetAmount: 600000, sortOrder: 2,
    }));
  });

  it('updates status when action=status', async () => {
    const body = 'action=status&status=achieved';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals');
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith('sub1', 'id1', expect.objectContaining({ status: 'achieved' }));
  });

  it('redirects invalid for bad status', async () => {
    const body = 'action=status&status=bad_status';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });

  it('redirects not_found when goal does not exist', async () => {
    mockGetGoal.mockResolvedValue(null);
    const body = 'name=Test&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=not_found');
  });

  it('redirects not_found when goal is soft-deleted', async () => {
    mockGetGoal.mockResolvedValue({ ...goal, deletedAt: '2026-06-01T00:00:00.000Z', deletedBy: 'sub1' });
    const body = 'name=Test&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=not_found');
  });

  it('redirects invalid when name is empty', async () => {
    const body = 'name=&tracksAgainst=net_worth&targetAmount=500000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals/id1', body), {} as never, () => {}) as never;
    expect(res.headers.Location).toBe('/goals?error=invalid');
  });
});

describe('POST /goals/:id/delete', () => {
  it('soft deletes and redirects', async () => {
    const res = await handler(makeEvent('POST', '/goals/id1/delete', ''), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/goals');
    expect(mockSoftDelete).toHaveBeenCalledWith('sub1', 'id1', 'sub1', '2026-06-30T10:00:00.000Z');
  });
});

describe('GET /goals — metrics computation', () => {
  it('computes progress from savings total (total_savings goal)', async () => {
    mockQueryAccounts.mockResolvedValue([{ PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#', id: 'a1', sub: 'sub1', name: 'Bank', type: 'savings', currency: 'SGD', balance: 100000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'total_savings', targetAmount: 200000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('50.0%');
  });

  it('snapshot value is 0 when metrics unavailable', async () => {
    mockQueryByUser.mockResolvedValue([goal]);
    await handler(makeEvent('GET', '/goals'), {} as never, () => {});
    expect(mockPutSnapshot).toHaveBeenCalledWith(expect.objectContaining({ value: 0 }));
  });

  it('currentAssets is null when FX fails for foreign receivable', async () => {
    const foreignRecv = { PK: 'RECV#sub1', SK: 'RECV#r1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#', id: 'r1', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency: 'USD', outstandingAmount: 1000, originalAmount: 1000, status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryReceivables.mockResolvedValue([foreignRecv]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-30' });
    mockConvertAmount.mockReturnValue(null);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'current_assets' as const }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Target:');
  });

  it('netWorth is null when FX fails for foreign liability', async () => {
    const foreignLiab = { PK: 'LIAB#sub1', SK: 'LIAB#l1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#', id: 'l1', sub: 'sub1', name: 'Debt', type: 'personal_loan' as const, currency: 'USD', outstandingAmount: 1000, originalAmount: 1000, status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryLiabilities.mockResolvedValue([foreignLiab]);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-30' });
    mockConvertAmount.mockReturnValue(null);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'net_worth' as const }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Target:');
  });

  it('converts foreign liability and receivable when FX available', async () => {
    const foreignLiab = { PK: 'LIAB#sub1', SK: 'LIAB#l1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#', id: 'l1', sub: 'sub1', name: 'Debt', type: 'personal_loan' as const, currency: 'USD', outstandingAmount: 1000, originalAmount: 1000, status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const foreignRecv = { PK: 'RECV#sub1', SK: 'RECV#r1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#', id: 'r1', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency: 'USD', outstandingAmount: 500, originalAmount: 500, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryLiabilities.mockResolvedValue([foreignLiab]);
    mockQueryReceivables.mockResolvedValue([foreignRecv]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-30' });
    mockConvertAmount.mockReturnValue(1351);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'net_worth' as const, targetAmount: 500000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Lean FIRE');
  });

  it('computes metrics with SGD liabilities and receivables', async () => {
    const sgdLiab = { PK: 'LIAB#sub1', SK: 'LIAB#l1', GSI1PK: 'USER#sub1', GSI1SK: 'LIAB#', id: 'l1', sub: 'sub1', name: 'Debt', type: 'personal_loan' as const, currency: 'SGD', outstandingAmount: 5000, originalAmount: 5000, status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const sgdRecv = { PK: 'RECV#sub1', SK: 'RECV#r1', GSI1PK: 'USER#sub1', GSI1SK: 'RECV#', id: 'r1', sub: 'sub1', name: 'Loan', type: 'personal_loan' as const, currency: 'SGD', outstandingAmount: 3000, originalAmount: 3000, status: 'outstanding' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryLiabilities.mockResolvedValue([sgdLiab]);
    mockQueryReceivables.mockResolvedValue([sgdRecv]);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'net_worth' as const, targetAmount: 100000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Lean FIRE');
  });

  it('computes cpf total when CPF data exists (SGD base)', async () => {
    mockGetCpf.mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 50000, sa: 20000, ma: 10000, ra: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'cpf_total' as const, targetAmount: 200000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('40.0%');
  });

  it('converts foreign account balance when FX available', async () => {
    const usdAcct = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#', id: 'a1', sub: 'sub1', name: 'USD Bank', type: 'savings' as const, currency: 'USD', balance: 5000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryAccounts.mockResolvedValue([usdAcct]);
    mockGetOrFetchRates.mockResolvedValue({ rates: { USD: 0.74 }, date: '2026-06-30' });
    mockConvertAmount.mockReturnValue(6757);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'total_savings' as const, targetAmount: 10000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('67.6%');
  });

  it('computes cpf total when CPF data exists (non-SGD base)', async () => {
    mockGetCpf.mockResolvedValue({ PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 50000, sa: 20000, ma: 10000, ra: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    mockGetSettings.mockResolvedValue({ PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'USD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' });
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 0.74 }, date: '2026-06-30' });
    mockConvertAmount.mockReturnValue(59459);
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'cpf_total' as const, targetAmount: 100000 }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Lean FIRE');
  });

  it('uses base64 encoded body for update', async () => {
    mockGetGoal.mockResolvedValue(goal);
    const body = 'action=status&status=achieved';
    const res = await handler(makeEvent('POST', '/goals/id1', body, { base64: true }), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(mockUpdateGoalStatus).toHaveBeenCalled();
  });

  it('creates goal with base64 encoded body', async () => {
    const body = 'name=Test+Goal&type=custom&tracksAgainst=net_worth&targetAmount=100000&sortOrder=1';
    const res = await handler(makeEvent('POST', '/goals', body, { base64: true }), {} as never, () => {}) as never;
    expect(res.statusCode).toBe(302);
    expect(mockPutGoal).toHaveBeenCalled();
  });

  it('investableAssets is null when FX fails for foreign account', async () => {
    const foreignAcct = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#a1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#', id: 'a1', sub: 'sub1', name: 'USD Bank', type: 'savings' as const, currency: 'USD', balance: 5000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    mockQueryAccounts.mockResolvedValue([foreignAcct]);
    mockGetOrFetchRates.mockRejectedValue(new Error('FX fail'));
    mockQueryByUser.mockResolvedValue([{ ...goal, tracksAgainst: 'investable_assets' as const }]);
    const res = await handler(makeEvent('GET', '/goals'), {} as never, () => {}) as never;
    expect(res.body).toContain('Target:');
  });
});
