import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/session', () => ({
  getSession: vi.fn(),
  renewSessionTtl: vi.fn(),
}));
vi.mock('../../src/repositories/user', () => ({
  getUser: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowMs: vi.fn(() => 1_000_000_000_000) },
}));

import { requireSessionOrBearer, getBearerToken, MOBILE_SESSION_TTL_SECONDS } from '../../src/lib/auth-middleware';
import { getSession, renewSessionTtl } from '../../src/repositories/session';
import { getUser } from '../../src/repositories/user';
import type { SessionRecord, UserRecord } from '../../src/types';

const mockGetSession = vi.mocked(getSession);
const mockRenew = vi.mocked(renewSessionTtl);
const mockGetUser = vi.mocked(getUser);

const NOW = 1_000_000_000; // seconds, matches mocked clock

const session: SessionRecord = {
  PK: 'SESSION#s1',
  SK: 'SESSION#s1',
  sessionId: 's1',
  sub: 'sub1',
  createdAt: '2024-01-01T00:00:00.000Z',
  ttl: 9999999999,
};

const mobileSession: SessionRecord = {
  ...session,
  PK: 'SESSION#tok',
  SK: 'SESSION#tok',
  sessionId: 'tok',
  platform: 'mobile',
  refreshToken: 'rt',
  ttl: NOW + MOBILE_SESSION_TTL_SECONDS,
};

const user: UserRecord = {
  PK: 'USER#sub1',
  SK: 'USER#sub1',
  GSI1PK: 'ALL_USERS',
  GSI1SK: 'USER#sub1',
  sub: 'sub1',
  email: 'user@example.com',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function makeEvent(cookieHeader?: string, rawPath = '/', headers: Record<string, string> = {}) {
  return {
    rawPath,
    cookies: cookieHeader ? [cookieHeader] : undefined,
    headers,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockGetUser.mockResolvedValue(null);
});

describe('requireSessionOrBearer — cookie (web)', () => {
  it('redirects when no sid cookie', async () => {
    const result = await requireSessionOrBearer(makeEvent());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.statusCode).toBe(302);
      expect(result.response.headers?.Location).toContain('/auth/login');
    }
  });

  it('redirects when session not found', async () => {
    const result = await requireSessionOrBearer(makeEvent('sid=bad-session'));
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.statusCode).toBe(302);
  });

  it('returns authenticated with session context', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue(user);
    const result = await requireSessionOrBearer(makeEvent('sid=s1'));
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.session.sub).toBe('sub1');
      expect(result.session.sessionId).toBe('s1');
      expect(result.session.role).toBeUndefined();
    }
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it('does not check or renew a web session ttl', async () => {
    mockGetSession.mockResolvedValue({ ...session, ttl: NOW - 10 });
    const result = await requireSessionOrBearer(makeEvent('sid=s1'));
    expect(result.authenticated).toBe(true);
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it('includes admin role from user record', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue({ ...user, role: 'admin' });
    const result = await requireSessionOrBearer(makeEvent('sid=s1'));
    expect(result.authenticated).toBe(true);
    if (result.authenticated) expect(result.session.role).toBe('admin');
  });

  it('includes return_to path in redirect', async () => {
    const result = await requireSessionOrBearer(makeEvent(undefined, '/settings'));
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.headers?.Location).toContain('return_to=%2Fsettings');
    }
  });

  it('handles cookie from headers.cookie fallback', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue(user);
    const event = { rawPath: '/', headers: { cookie: 'sid=s1' } } as never;
    const result = await requireSessionOrBearer(event);
    expect(result.authenticated).toBe(true);
  });

  it('uses / as return_to when rawPath is undefined', async () => {
    const event = { headers: {} } as never;
    const result = await requireSessionOrBearer(event);
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.headers?.Location).toContain('return_to=%2F');
    }
  });

  it('falls back to the cookie when Authorization is not a Bearer header', async () => {
    mockGetSession.mockResolvedValue(session);
    const result = await requireSessionOrBearer(makeEvent('sid=s1', '/', { authorization: 'Basic abc' }));
    expect(result.authenticated).toBe(true);
    expect(mockGetSession).toHaveBeenCalledWith('s1');
  });
});

describe('requireSessionOrBearer — Bearer (mobile)', () => {
  it('authenticates a mobile Bearer token', async () => {
    mockGetSession.mockResolvedValue(mobileSession);
    mockGetUser.mockResolvedValue(user);
    const result = await requireSessionOrBearer(makeEvent(undefined, '/', { authorization: 'Bearer tok' }));
    expect(result).toEqual({ authenticated: true, session: { sessionId: 'tok', sub: 'sub1', role: undefined } });
    expect(mockGetSession).toHaveBeenCalledWith('tok');
  });

  it('reads Bearer before the sid cookie', async () => {
    mockGetSession.mockResolvedValue(mobileSession);
    await requireSessionOrBearer(makeEvent('sid=s1', '/', { authorization: 'Bearer tok' }));
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockGetSession).toHaveBeenCalledWith('tok');
  });

  it('accepts a capitalised Authorization header', async () => {
    mockGetSession.mockResolvedValue(mobileSession);
    const result = await requireSessionOrBearer(makeEvent(undefined, '/', { Authorization: 'bearer tok' }));
    expect(result.authenticated).toBe(true);
  });

  it('returns a JSON 401 (not a redirect) for an unknown token, even with a valid cookie', async () => {
    mockGetSession.mockImplementation(async (id) => (id === 's1' ? session : null));
    const result = await requireSessionOrBearer(makeEvent('sid=s1', '/', { authorization: 'Bearer nope' }));
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.response.statusCode).toBe(401);
      expect(result.response.headers).toMatchObject({ 'WWW-Authenticate': 'Bearer' });
      expect(JSON.parse(result.response.body as string)).toEqual({ error: 'unauthorized' });
    }
  });

  it('rejects an expired mobile session', async () => {
    mockGetSession.mockResolvedValue({ ...mobileSession, ttl: NOW });
    const result = await requireSessionOrBearer(makeEvent(undefined, '/', { authorization: 'Bearer tok' }));
    expect(result.authenticated).toBe(false);
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it('rejects an expired mobile session sent as a cookie too', async () => {
    mockGetSession.mockResolvedValue({ ...mobileSession, ttl: NOW - 1 });
    const result = await requireSessionOrBearer(makeEvent('sid=tok'));
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.statusCode).toBe(302);
  });

  it('does not renew a session renewed within the last day', async () => {
    mockGetSession.mockResolvedValue({ ...mobileSession, ttl: NOW + MOBILE_SESSION_TTL_SECONDS - 3600 });
    await requireSessionOrBearer(makeEvent(undefined, '/', { authorization: 'Bearer tok' }));
    expect(mockRenew).not.toHaveBeenCalled();
  });

  it('slides the session to a fresh 60 days once more than a day has passed', async () => {
    mockGetSession.mockResolvedValue({ ...mobileSession, ttl: NOW + 86400 * 10 });
    const result = await requireSessionOrBearer(makeEvent(undefined, '/', { authorization: 'Bearer tok' }));
    expect(result.authenticated).toBe(true);
    expect(mockRenew).toHaveBeenCalledWith('tok', NOW + MOBILE_SESSION_TTL_SECONDS);
  });
});

describe('getBearerToken', () => {
  it.each([
    [{ authorization: 'Bearer abc' }, 'abc'],
    [{ Authorization: 'Bearer abc  ' }, 'abc'],
    [{ authorization: 'Bearer' }, undefined],
    [{ authorization: 'Bearer a b' }, undefined],
    [{ authorization: 'Token abc' }, undefined],
    [{}, undefined],
  ])('%j → %s', (headers, expected) => {
    expect(getBearerToken({ headers } as never)).toBe(expected);
  });

  it('handles a missing headers object', () => {
    expect(getBearerToken({} as never)).toBeUndefined();
  });
});
