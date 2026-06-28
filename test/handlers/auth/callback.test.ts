import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/auth', () => ({
  exchangeCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('../../../src/repositories/user', () => ({
  getUser: vi.fn(),
  putUser: vi.fn(),
}));

vi.mock('../../../src/repositories/session', () => ({
  putSession: vi.fn(),
}));

vi.mock('../../../src/lib/secrets', () => ({
  getSecret: vi.fn().mockResolvedValue('client-secret'),
}));

vi.mock('../../../src/config', () => ({
  config: {
    stage: 'preview',
    appUrl: 'https://wealth-preview.kopi.life',
    ssoIssuer: 'https://sso.example.com',
    ssoClientId: 'wealth-preview',
  },
  secretName: (k: string) => `wealth/preview/${k}`,
}));

import { handler } from '../../../src/handlers/auth/callback';
import { exchangeCode, verifyIdToken } from '../../../src/lib/auth';
import { getUser, putUser } from '../../../src/repositories/user';
import { putSession } from '../../../src/repositories/session';

const mockExchange = vi.mocked(exchangeCode);
const mockVerify = vi.mocked(verifyIdToken);
const mockGetUser = vi.mocked(getUser);
const mockPutUser = vi.mocked(putUser);
const mockPutSession = vi.mocked(putSession);

const baseCookies = ['oauth_state=valid-state', 'pkce_verifier=verifier123', 'return_to=%2F'];

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    queryStringParameters: { code: 'auth-code', state: 'valid-state' },
    cookies: baseCookies,
    headers: {},
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExchange.mockResolvedValue({ id_token: 'id-tok', access_token: 'acc-tok' });
  mockVerify.mockResolvedValue({ sub: 'sub1', email: 'user@example.com', name: 'Test User' });
  mockGetUser.mockResolvedValue(null);
  mockPutUser.mockResolvedValue(undefined);
  mockPutSession.mockResolvedValue(undefined);
});

describe('GET /auth/callback', () => {
  it('returns 400 when code missing', async () => {
    const res = await handler(
      { queryStringParameters: { state: 'x' }, cookies: baseCookies, headers: {} } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when state missing', async () => {
    const res = await handler(
      { queryStringParameters: { code: 'x' }, cookies: baseCookies, headers: {} } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 on state mismatch', async () => {
    const res = await handler(
      {
        queryStringParameters: { code: 'auth-code', state: 'wrong-state' },
        cookies: baseCookies,
        headers: {},
      } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when pkce_verifier cookie missing', async () => {
    const res = await handler(
      {
        queryStringParameters: { code: 'auth-code', state: 'valid-state' },
        cookies: ['oauth_state=valid-state'],
        headers: {},
      } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when token exchange fails', async () => {
    mockExchange.mockRejectedValue(new Error('exchange failed'));
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when ID token invalid', async () => {
    mockVerify.mockRejectedValue(new Error('invalid token'));
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('JIT-provisions new user and creates session', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(mockPutUser).toHaveBeenCalledOnce();
    expect(mockPutSession).toHaveBeenCalledOnce();
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });

  it('updates existing user lastSeenAt and preserves role', async () => {
    mockGetUser.mockResolvedValue({
      PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1',
      sub: 'sub1', email: '', role: 'admin' as const,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(mockPutUser).toHaveBeenCalledOnce();
    const savedUser = mockPutUser.mock.calls[0][0];
    expect(savedUser.lastSeenAt).toBeDefined();
    expect(savedUser.role).toBe('admin');
    expect(savedUser.email).toBe('user@example.com');
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });

  it('sets sid cookie and clears pkce/state cookies', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    const cookies = (res as { cookies: string[] }).cookies;
    expect(cookies.some((c: string) => c.startsWith('sid='))).toBe(true);
    expect(cookies.some((c: string) => c.includes('pkce_verifier=') && c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c: string) => c.includes('oauth_state=') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('redirects to return_to path', async () => {
    const cookies = ['oauth_state=valid-state', 'pkce_verifier=v', 'return_to=%2Fdashboard'];
    const res = await handler(
      { queryStringParameters: { code: 'auth-code', state: 'valid-state' }, cookies, headers: {} } as never,
      {} as never,
      () => {},
    );
    expect((res as { headers: Record<string, string> }).headers.Location).toBe('/dashboard');
  });

  it('falls back to / when return_to missing', async () => {
    const cookies = ['oauth_state=valid-state', 'pkce_verifier=v'];
    const res = await handler(
      { queryStringParameters: { code: 'auth-code', state: 'valid-state' }, cookies, headers: {} } as never,
      {} as never,
      () => {},
    );
    expect((res as { headers: Record<string, string> }).headers.Location).toBe('/');
  });

  it('reads cookies from header when cookies array absent', async () => {
    const res = await handler(
      {
        queryStringParameters: { code: 'auth-code', state: 'valid-state' },
        cookies: undefined,
        headers: { cookie: 'oauth_state=valid-state; pkce_verifier=v; return_to=%2F' },
      } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });
});
