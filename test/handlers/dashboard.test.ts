import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}));
vi.mock('../../src/repositories/account', () => ({ queryByUser: vi.fn() }));
vi.mock('../../src/repositories/cpf', () => ({ getCpf: vi.fn() }));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));

import { handler } from '../../src/handlers/dashboard';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings, putSettings } from '../../src/repositories/financialSettings';
import { queryByUser } from '../../src/repositories/account';
import { getCpf } from '../../src/repositories/cpf';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockPutSettings = vi.mocked(putSettings);
const mockQueryByUser = vi.mocked(queryByUser);
const mockGetCpf = vi.mocked(getCpf);
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
  mockGetCpf.mockResolvedValue(null);
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

  it('shows — for savings when no accounts', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('>—<');
  });

  it('shows savings total for same-currency accounts', async () => {
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

  it('shows CPF total in SGD when base currency is SGD', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('35,000.00');
  });

  it('shows — for CPF when no CPF data', async () => {
    const res = await handler({} as never, {} as never, () => {});
    const body = (res as { body: string }).body;
    // CPF card shows — when no data
    expect(body).toContain('CPF');
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

  it('shows SGD note on CPF when FX fails and base is not SGD', async () => {
    const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockRejectedValue(new Error('fail'));
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('(SGD)');
  });
});
