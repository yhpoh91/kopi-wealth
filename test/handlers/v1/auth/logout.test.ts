import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/auth', () => ({ revokeRefreshToken: vi.fn() }));
vi.mock('../../../../src/repositories/session', () => ({ getSession: vi.fn(), deleteSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../../src/lib/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../../../../src/config', () => ({
  config: { stage: 'preview', ssoIssuer: 'https://sso.example.com', ssoClientId: 'wealth-preview' },
  secretName: (k: string) => `wealth/preview/${k}`,
}));

import { handler } from '../../../../src/handlers/v1/auth/logout';
import { revokeRefreshToken } from '../../../../src/lib/auth';
import { getSession, deleteSession } from '../../../../src/repositories/session';
import { getSecret } from '../../../../src/lib/secrets';
import type { SessionRecord } from '../../../../src/types';

const mockRevoke = vi.mocked(revokeRefreshToken);
const mockGetSession = vi.mocked(getSession);
const mockDelete = vi.mocked(deleteSession);
const mockGetSecret = vi.mocked(getSecret);

const session: SessionRecord = {
  PK: 'SESSION#tok', SK: 'SESSION#tok', sessionId: 'tok', sub: 'sub1',
  createdAt: 'x', ttl: 9999999999, platform: 'mobile', refreshToken: 'rt',
};

type Res = { statusCode: number; body: string };

async function call(headers: Record<string, string>): Promise<Res> {
  return await handler({ headers } as never, {} as never, () => {}) as Res;
}

function expectOk(res: Res) {
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(session);
  mockDelete.mockResolvedValue(undefined);
  mockGetSecret.mockResolvedValue('client-secret');
  mockRevoke.mockResolvedValue(true);
});

describe('POST /v1/auth/logout', () => {
  it('soft-deletes this session only and revokes its SSO refresh token', async () => {
    expectOk(await call({ authorization: 'Bearer tok' }));
    expect(mockGetSession).toHaveBeenCalledWith('tok');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('tok', 'sub1');
    expect(mockRevoke).toHaveBeenCalledWith({
      issuer: 'https://sso.example.com',
      clientId: 'wealth-preview',
      clientSecret: 'client-secret',
      refreshToken: 'rt',
    });
  });

  it('skips revocation when the session holds no refresh token', async () => {
    mockGetSession.mockResolvedValue({ ...session, refreshToken: undefined });
    expectOk(await call({ authorization: 'Bearer tok' }));
    expect(mockDelete).toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('answers 200 for an unknown or already-ended token', async () => {
    mockGetSession.mockResolvedValue(null);
    expectOk(await call({ authorization: 'Bearer gone' }));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('answers 200 with no Authorization header', async () => {
    expectOk(await call({}));
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('answers 200 when revocation fails', async () => {
    mockRevoke.mockResolvedValue(false);
    expectOk(await call({ authorization: 'Bearer tok' }));
  });

  it('answers 200 when DynamoDB or Secrets Manager fails', async () => {
    mockGetSecret.mockRejectedValue(new Error('boom'));
    expectOk(await call({ authorization: 'Bearer tok' }));
    mockGetSession.mockRejectedValue(new Error('boom'));
    expectOk(await call({ authorization: 'Bearer tok' }));
  });
});
