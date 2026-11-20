import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
const cfg = vi.hoisted(() => ({ stage: 'preview' }));
vi.mock('../../../src/config', () => ({ config: cfg }));
vi.mock('../../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));

import { handler } from '../../../src/handlers/v1/me';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getAccountManagementUrl } from '../../../src/lib/account-management';

const T = '2024-01-01T00:00:00.000Z';
const userFor = (sub: string, over: Record<string, unknown> = {}) => ({
  PK: `USER#${sub}`, SK: `USER#${sub}`, GSI1PK: 'ALL_USERS', GSI1SK: `USER#${sub}`, sub,
  email: `${sub}@example.com`, name: `Name ${sub}`, picture: 'https://p/x.png', role: 'admin' as const,
  createdAt: T, updatedAt: T, ...over,
});

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
const bearerEvent = { headers: { authorization: 'Bearer tok' }, rawPath: '/v1/me' } as never;
const cookieEvent = { headers: {}, cookies: ['sid=web1'], rawPath: '/v1/me' } as never;
const call = async (event: never = bearerEvent) => await handler(event, {} as never, () => {}) as Res;

beforeEach(() => {
  vi.clearAllMocks();
  cfg.stage = 'preview';
  vi.mocked(getSession).mockImplementation(async (id: string) => ({
    PK: `SESSION#${id}`, SK: `SESSION#${id}`, sessionId: id, sub: id === 'tok' ? 'mobileSub' : 'webSub',
    createdAt: T, ttl: 9999999999, ...(id === 'tok' ? { platform: 'mobile' as const } : {}),
  }));
  vi.mocked(getUser).mockImplementation(async (sub: string) => userFor(sub));
  vi.mocked(getAccountManagementUrl).mockResolvedValue('https://sso.example.com/account?client_id=c&return_url=x');
});

describe('GET /v1/me', () => {
  it('asks for the preview app link for a mobile caller on preview', async () => {
    await call(bearerEvent);
    expect(getAccountManagementUrl).toHaveBeenCalledWith('kopiwealthpreview://account');
  });

  it('asks for the prod app link for a mobile caller on prod', async () => {
    cfg.stage = 'prod';
    await call(bearerEvent);
    expect(getAccountManagementUrl).toHaveBeenCalledWith('kopiwealth://account');
  });

  it('keeps the default web return URL for a cookie caller', async () => {
    await call(cookieEvent);
    expect(getAccountManagementUrl).toHaveBeenCalledWith(undefined);
  });

  it('gives a Bearer caller their own profile and the account link, without picture or role', async () => {
    const res = await call(bearerEvent);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      user: { sub: 'mobileSub', email: 'mobileSub@example.com', name: 'Name mobileSub' },
      accountManagementUrl: 'https://sso.example.com/account?client_id=c&return_url=x',
    });
    expect(getUser).toHaveBeenCalledTimes(2); // once for the session, once for the profile
    expect(vi.mocked(getUser).mock.calls.every(([s]) => s === 'mobileSub')).toBe(true);
  });

  it('gives a cookie caller their own profile, never another user\'s', async () => {
    const body = JSON.parse((await call(cookieEvent)).body);
    expect(body.user.sub).toBe('webSub');
    expect(vi.mocked(getUser).mock.calls.every(([s]) => s === 'webSub')).toBe(true);
  });

  it('omits name when absent', async () => {
    vi.mocked(getUser).mockImplementation(async (sub: string) => userFor(sub, { name: undefined }));
    const body = JSON.parse((await call()).body);
    expect(body.user).toEqual({ sub: 'mobileSub', email: 'mobileSub@example.com' });
    expect('name' in body.user).toBe(false);
  });

  it('returns an empty accountManagementUrl when discovery has none', async () => {
    vi.mocked(getAccountManagementUrl).mockResolvedValue('');
    expect(JSON.parse((await call()).body).accountManagementUrl).toBe('');
  });

  it('is 404 when the user record is missing', async () => {
    vi.mocked(getUser).mockResolvedValueOnce(userFor('mobileSub')).mockResolvedValueOnce(null);
    const res = await call();
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
  });

  it('is a JSON 500 with no stack or profile data on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAccountManagementUrl).mockRejectedValue(new Error('boom'));
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'internal_error' });
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toMatch(/example\.com|Name /);
  });

  it('logs a non-Error failure as-is', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAccountManagementUrl).mockRejectedValue('weird');
    expect((await call()).statusCode).toBe(500);
  });

  it('refuses an unknown Bearer token with a JSON 401 and WWW-Authenticate', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await call();
    expect(res.statusCode).toBe(401);
    expect(res.headers?.['WWW-Authenticate'] ?? res.headers?.['www-authenticate']).toMatch(/Bearer/);
  });

  it('redirects a cookie caller without a session to login', async () => {
    const res = await call({ headers: {}, rawPath: '/v1/me' } as never);
    expect(res.statusCode).toBe(302);
  });
});
