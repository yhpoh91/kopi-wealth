import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/auth', async (orig) => ({
  ...(await orig<typeof import('../../../../src/lib/auth')>()),
  exchangeCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));
vi.mock('../../../../src/lib/provision-user', () => ({ provisionUser: vi.fn() }));
vi.mock('../../../../src/repositories/session', () => ({ putSession: vi.fn() }));
vi.mock('../../../../src/lib/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../../../../src/lib/clock', () => ({
  clock: { nowMs: () => 1_000_000_000_000, nowIso: () => '2001-09-09T01:46:40.000Z' },
}));
vi.mock('../../../../src/config', () => ({
  config: { stage: 'preview', ssoIssuer: 'https://sso.example.com', ssoClientId: 'wealth-preview' },
  secretName: (k: string) => `wealth/preview/${k}`,
}));

import { handler } from '../../../../src/handlers/v1/auth/token';
import { exchangeCode, verifyIdToken } from '../../../../src/lib/auth';
import { provisionUser } from '../../../../src/lib/provision-user';
import { putSession } from '../../../../src/repositories/session';
import { getSecret } from '../../../../src/lib/secrets';
import type { UserRecord } from '../../../../src/types';

const mockExchange = vi.mocked(exchangeCode);
const mockVerify = vi.mocked(verifyIdToken);
const mockProvision = vi.mocked(provisionUser);
const mockPutSession = vi.mocked(putSession);
const mockGetSecret = vi.mocked(getSecret);

type Res = { statusCode: number; body: string };

const validBody = { code: 'c', codeVerifier: 'v', redirectUri: 'kopiwealth://callback' };

const user: UserRecord = {
  PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1',
  sub: 'sub1', email: 'u@example.com', name: 'U', picture: 'https://p/x.png',
  createdAt: 'x', updatedAt: 'x',
};

async function call(body: string | undefined, isBase64Encoded = false): Promise<Res> {
  return await handler({ body, isBase64Encoded, headers: {} } as never, {} as never, () => {}) as Res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSecret.mockResolvedValue('client-secret');
  mockExchange.mockResolvedValue({ id_token: 'id', access_token: 'at', refresh_token: 'rt' });
  mockVerify.mockResolvedValue({ sub: 'sub1', email: 'u@example.com', name: 'U' });
  mockProvision.mockResolvedValue(user);
  mockPutSession.mockResolvedValue(undefined);
});

describe('POST /v1/auth/token', () => {
  it('exchanges the code and returns an opaque 60-day mobile session token', async () => {
    const res = await call(JSON.stringify(validBody));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt).toBe(new Date((1_000_000_000 + 60 * 86400) * 1000).toISOString());
    expect(body.user).toEqual({ sub: 'sub1', email: 'u@example.com', name: 'U', picture: 'https://p/x.png' });

    expect(mockGetSecret).toHaveBeenCalledWith('wealth/preview/sso-client-secret');
    expect(mockExchange).toHaveBeenCalledWith({
      issuer: 'https://sso.example.com',
      clientId: 'wealth-preview',
      clientSecret: 'client-secret',
      redirectUri: 'kopiwealth://callback',
      code: 'c',
      verifier: 'v',
    });
    expect(mockProvision).toHaveBeenCalledWith({ sub: 'sub1', email: 'u@example.com', name: 'U' }, '2001-09-09T01:46:40.000Z');
    expect(mockPutSession).toHaveBeenCalledWith({
      PK: `SESSION#${body.token}`,
      SK: `SESSION#${body.token}`,
      sessionId: body.token,
      sub: 'sub1',
      createdAt: '2001-09-09T01:46:40.000Z',
      ttl: 1_000_000_000 + 60 * 86400,
      platform: 'mobile',
      refreshToken: 'rt',
    });
  });

  it('never returns SSO tokens, issuer, client id or secret to the app', async () => {
    const res = await call(JSON.stringify(validBody));
    for (const leaked of ['rt', 'at', 'id', 'client-secret', 'wealth-preview', 'sso.example.com']) {
      expect(Object.values(JSON.parse(res.body))).not.toContain(leaked);
    }
    expect(res.body).not.toMatch(/client-secret|wealth-preview|sso\.example\.com|"rt"|"at"/);
  });

  it('returns the role for an admin', async () => {
    mockProvision.mockResolvedValue({ ...user, role: 'admin' });
    const res = await call(JSON.stringify(validBody));
    expect(JSON.parse(res.body).user.role).toBe('admin');
  });

  it('stores no refresh token when kopi-sso returns none', async () => {
    mockExchange.mockResolvedValue({ id_token: 'id', access_token: 'at' });
    await call(JSON.stringify(validBody));
    expect(mockPutSession.mock.calls[0][0]).not.toHaveProperty('refreshToken');
  });

  it('accepts a base64-encoded body', async () => {
    const res = await call(Buffer.from(JSON.stringify({ ...validBody, redirectUri: 'kopiwealthpreview://callback' })).toString('base64'), true);
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['missing body', undefined],
    ['empty body', ''],
    ['invalid JSON', '{nope'],
    ['JSON null', 'null'],
    ['JSON string', '"x"'],
    ['missing code', JSON.stringify({ ...validBody, code: undefined })],
    ['missing codeVerifier', JSON.stringify({ ...validBody, codeVerifier: '' })],
    ['non-string redirectUri', JSON.stringify({ ...validBody, redirectUri: 5 })],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await call(body);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'code, codeVerifier and redirectUri are required' });
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('returns 400 for a redirect URI outside the allowlist', async () => {
    const res = await call(JSON.stringify({ ...validBody, redirectUri: 'https://evil.example.com/cb' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'redirectUri is not allowed' });
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('returns 502 without detail when the exchange fails', async () => {
    mockExchange.mockRejectedValue(new Error('Token exchange failed: 400 secret stuff'));
    const res = await call(JSON.stringify(validBody));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'Token exchange failed' });
    expect(mockPutSession).not.toHaveBeenCalled();
  });

  it('returns 502 when the client secret cannot be read', async () => {
    mockGetSecret.mockRejectedValue(new Error('AccessDenied'));
    const res = await call(JSON.stringify(validBody));
    expect(res.statusCode).toBe(502);
  });

  it('returns 401 when the ID token does not verify', async () => {
    mockVerify.mockRejectedValue(new Error('bad sig'));
    const res = await call(JSON.stringify(validBody));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid ID token' });
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockPutSession).not.toHaveBeenCalled();
  });
});
