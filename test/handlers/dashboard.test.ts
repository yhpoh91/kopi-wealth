import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({
  requireSession: vi.fn(),
}));
vi.mock('../../src/repositories/user', () => ({
  getUser: vi.fn(),
}));
vi.mock('../../src/repositories/financialSettings', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}));

import { handler } from '../../src/handlers/dashboard';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings, putSettings } from '../../src/repositories/financialSettings';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockPutSettings = vi.mocked(putSettings);

const authResult = {
  authenticated: true as const,
  session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined },
};

const user = {
  PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1',
  sub: 'sub1', email: 'user@example.com',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

const settings = {
  PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1',
  currency: 'SGD', timezone: 'Asia/Singapore',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(authResult);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockPutSettings.mockResolvedValue(undefined);
});

describe('GET /', () => {
  it('redirects to login when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({
      authenticated: false,
      redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' },
    });
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
    mockGetUser.mockResolvedValue({ ...user, name: undefined });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('user@example.com');
  });

  it('falls back to "there" when no user and no settings displayName', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: undefined });
    mockGetUser.mockResolvedValue(null);
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('there');
  });

  it('seeds settings when none exist', async () => {
    mockGetSettings.mockResolvedValue(null);
    await handler({} as never, {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledOnce();
    expect(mockPutSettings.mock.calls[0][0]).toMatchObject({
      PK: 'SETTINGS#sub1',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
    });
  });

  it('does not seed settings when they already exist', async () => {
    await handler({} as never, {} as never, () => {});
    expect(mockPutSettings).not.toHaveBeenCalled();
  });

  it('shows currency in net worth card', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain('SGD');
  });

  it('escapes XSS in display name', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: '<script>alert(1)</script>' });
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('<script>alert(1)</script>');
    expect((res as { body: string }).body).toContain('&lt;script&gt;');
  });
});
