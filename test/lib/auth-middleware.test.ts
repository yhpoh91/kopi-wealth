import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/session', () => ({
  getSession: vi.fn(),
}));
vi.mock('../../src/repositories/user', () => ({
  getUser: vi.fn(),
}));

import { requireSession } from '../../src/lib/auth-middleware';
import { getSession } from '../../src/repositories/session';
import { getUser } from '../../src/repositories/user';
import type { SessionRecord, UserRecord } from '../../src/types';

const mockGetSession = vi.mocked(getSession);
const mockGetUser = vi.mocked(getUser);

const session: SessionRecord = {
  PK: 'SESSION#s1',
  SK: 'SESSION#s1',
  sessionId: 's1',
  sub: 'sub1',
  createdAt: '2024-01-01T00:00:00.000Z',
  ttl: 9999999999,
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

function makeEvent(cookieHeader?: string, rawPath = '/') {
  return {
    rawPath,
    cookies: cookieHeader ? [cookieHeader] : undefined,
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockGetUser.mockResolvedValue(null);
});

describe('requireSession', () => {
  it('redirects when no sid cookie', async () => {
    const result = await requireSession(makeEvent());
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.redirect.statusCode).toBe(302);
      expect(result.redirect.headers.Location).toContain('/auth/login');
    }
  });

  it('redirects when session not found', async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await requireSession(makeEvent('sid=bad-session'));
    expect(result.authenticated).toBe(false);
  });

  it('returns authenticated with session context', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue(user);
    const result = await requireSession(makeEvent('sid=s1'));
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.session.sub).toBe('sub1');
      expect(result.session.sessionId).toBe('s1');
      expect(result.session.role).toBeUndefined();
    }
  });

  it('includes admin role from user record', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue({ ...user, role: 'admin' });
    const result = await requireSession(makeEvent('sid=s1'));
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.session.role).toBe('admin');
    }
  });

  it('includes return_to path in redirect', async () => {
    const result = await requireSession(makeEvent(undefined, '/settings'));
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.redirect.headers.Location).toContain('return_to=%2Fsettings');
    }
  });

  it('handles cookie from headers.cookie fallback', async () => {
    mockGetSession.mockResolvedValue(session);
    mockGetUser.mockResolvedValue(user);
    const event = { rawPath: '/', headers: { cookie: 'sid=s1' } } as never;
    const result = await requireSession(event);
    expect(result.authenticated).toBe(true);
  });

  it('uses / as return_to when rawPath is undefined', async () => {
    const event = { headers: {} } as never;
    const result = await requireSession(event);
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.redirect.headers.Location).toContain('return_to=%2F');
    }
  });
});
