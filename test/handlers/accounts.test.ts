import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/account', () => ({
  getAccount: vi.fn(),
  queryByUser: vi.fn(),
  putAccount: vi.fn(),
  updateBalance: vi.fn(),
  softDelete: vi.fn(),
  putSnapshot: vi.fn(),
}));

import { handler } from '../../src/handlers/accounts';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getAccount, queryByUser, putAccount, updateBalance, softDelete, putSnapshot } from '../../src/repositories/account';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetAccount = vi.mocked(getAccount);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutAccount = vi.mocked(putAccount);
const mockUpdateBalance = vi.mocked(updateBalance);
const mockSoftDelete = vi.mocked(softDelete);
const mockPutSnapshot = vi.mocked(putSnapshot);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const account = { PK: 'ACCOUNT#sub1', SK: 'ACCOUNT#id1', GSI1PK: 'USER#sub1', GSI1SK: 'ACCOUNT#2024-01-01T00:00:00.000Z', id: 'id1', sub: 'sub1', name: 'DBS Savings', type: 'savings' as const, balance: 10000, currency: 'SGD', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent(method: string, path: string, body?: string) {
  const parts = path.split('/').filter(Boolean);
  return {
    requestContext: { http: { method } },
    rawPath: path,
    pathParameters: parts[1] ? { id: parts[1] } : undefined,
    body,
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
  mockUpdateBalance.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockPutSnapshot.mockResolvedValue(undefined);
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
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS Savings');
    expect((res as { body: string }).body).toContain('10,000.00');
  });

  it('escapes XSS in account name', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, name: '<script>alert(1)</script>' }]);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('<script>alert(1)</script>');
  });

  it('shows institution when present', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, institution: 'DBS' }]);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS');
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
    const res = await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on invalid type', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'invalid', currency: 'SGD', balance: '100' }).toString();
    const res = await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on invalid currency', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'XYZ', balance: '100' }).toString();
    const res = await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('redirects on missing name', async () => {
    const body = new URLSearchParams({ name: '', type: 'savings', currency: 'SGD', balance: '100' }).toString();
    const res = await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount).not.toHaveBeenCalled();
  });

  it('stores optional institution and notes', async () => {
    const body = new URLSearchParams({ name: 'X', type: 'savings', currency: 'SGD', balance: '100', institution: 'DBS', notes: 'primary' }).toString();
    await handler(makeEvent('POST', '/accounts', body), {} as never, () => {});
    expect(mockPutAccount.mock.calls[0][0]).toMatchObject({ institution: 'DBS', notes: 'primary' });
  });
});

describe('POST /accounts/:id (update balance)', () => {
  it('updates balance and redirects', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ balance: '20000' }).toString();
    const res = await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/accounts' } });
    expect(mockUpdateBalance).toHaveBeenCalledWith('sub1', 'id1', 20000, expect.any(String));
    expect(mockPutSnapshot).toHaveBeenCalledOnce();
  });

  it('redirects on invalid balance', async () => {
    mockGetAccount.mockResolvedValue(account);
    const body = new URLSearchParams({ balance: 'bad' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateBalance).not.toHaveBeenCalled();
  });

  it('redirects when account not found', async () => {
    mockGetAccount.mockResolvedValue(null);
    const body = new URLSearchParams({ balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/missing', body), {} as never, () => {});
    expect(mockUpdateBalance).not.toHaveBeenCalled();
  });

  it('redirects when account is deleted', async () => {
    mockGetAccount.mockResolvedValue({ ...account, deletedAt: '2024-01-02T00:00:00.000Z' });
    const body = new URLSearchParams({ balance: '100' }).toString();
    await handler(makeEvent('POST', '/accounts/id1', body), {} as never, () => {});
    expect(mockUpdateBalance).not.toHaveBeenCalled();
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

describe('GET /accounts account card variants', () => {
  it('renders card without institution', async () => {
    mockQueryByUser.mockResolvedValue([{ ...account, institution: undefined }]);
    const res = await handler(makeEvent('GET', '/accounts'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('DBS Savings');
  });
});
