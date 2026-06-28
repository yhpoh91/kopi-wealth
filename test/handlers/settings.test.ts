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

import { handler } from '../../src/handlers/settings';
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

function makeEvent(method: 'GET' | 'POST', body?: string) {
  return {
    requestContext: { http: { method } },
    body,
    cookies: ['sid=s1'],
    headers: {},
    rawPath: '/settings',
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(authResult);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockPutSettings.mockResolvedValue(undefined);
});

describe('GET /settings', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({
      authenticated: false,
      redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' },
    });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML page', async () => {
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('pre-fills display name', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: 'Alice' });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('value="Alice"');
  });

  it('pre-selects currency', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'USD' });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('<option value="USD" selected>');
  });

  it('pre-selects timezone', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, timezone: 'Asia/Kuala_Lumpur' });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('<option value="Asia/Kuala_Lumpur" selected>');
  });

  it('shows user email as placeholder when no displayName in settings', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: undefined });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('user@example.com');
  });

  it('works when settings is null (shows defaults)', async () => {
    mockGetSettings.mockResolvedValue(null);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect((res as { body: string }).body).toContain('<option value="SGD" selected>');
    expect((res as { body: string }).body).toContain('<option value="Asia/Singapore" selected>');
  });
});

describe('POST /settings', () => {
  it('saves valid settings and redirects', async () => {
    const body = new URLSearchParams({ displayName: 'Alice', currency: 'SGD', timezone: 'Asia/Singapore' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/settings' } });
    expect(mockPutSettings).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Alice',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
    }));
  });

  it('falls back to SGD for invalid currency', async () => {
    const body = new URLSearchParams({ displayName: '', currency: 'INVALID', timezone: 'Asia/Singapore' }).toString();
    await handler(makeEvent('POST', body), {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledWith(expect.objectContaining({ currency: 'SGD' }));
  });

  it('falls back to Asia/Singapore for invalid timezone', async () => {
    const body = new URLSearchParams({ displayName: '', currency: 'SGD', timezone: 'Invalid/Zone' }).toString();
    await handler(makeEvent('POST', body), {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Singapore' }));
  });

  it('stores undefined displayName when blank', async () => {
    const body = new URLSearchParams({ displayName: '   ', currency: 'SGD', timezone: 'Asia/Singapore' }).toString();
    await handler(makeEvent('POST', body), {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledWith(expect.objectContaining({ displayName: undefined }));
  });

  it('preserves createdAt from existing settings', async () => {
    const body = new URLSearchParams({ currency: 'SGD', timezone: 'Asia/Singapore' }).toString();
    await handler(makeEvent('POST', body), {} as never, () => {});
    expect(mockPutSettings).toHaveBeenCalledWith(expect.objectContaining({
      createdAt: '2024-01-01T00:00:00.000Z',
    }));
  });

  it('uses now for createdAt when settings do not exist', async () => {
    mockGetSettings.mockResolvedValue(null);
    const body = new URLSearchParams({ currency: 'SGD', timezone: 'Asia/Singapore' }).toString();
    await handler(makeEvent('POST', body), {} as never, () => {});
    const call = mockPutSettings.mock.calls[0][0];
    expect(call.createdAt).toBeTruthy();
  });

  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({
      authenticated: false,
      redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' },
    });
    const res = await handler(makeEvent('POST', ''), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutSettings).not.toHaveBeenCalled();
  });
});
