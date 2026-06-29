import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/session', () => ({ parseCookies: vi.fn() }));
vi.mock('../../src/repositories/session', () => ({ getSession: vi.fn() }));

import { handler } from '../../src/handlers/landing';
import { parseCookies } from '../../src/lib/session';
import { getSession } from '../../src/repositories/session';

const mockParseCookies = vi.mocked(parseCookies);
const mockGetSession = vi.mocked(getSession);

function makeEvent(cookieHeader?: string) {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/',
    rawQueryString: '',
    cookies: cookieHeader ? [cookieHeader] : [],
    headers: {},
    body: undefined,
    isBase64Encoded: false,
  } as never;
}

const session = { PK: 'SESSION#s1', SK: 'SESSION#s1', sessionId: 's1', sub: 'sub1', createdAt: '2024-01-01T00:00:00.000Z', ttl: 9999999999 };

beforeEach(() => {
  vi.clearAllMocks();
  mockParseCookies.mockReturnValue({});
  mockGetSession.mockResolvedValue(null);
});

describe('GET / (landing)', () => {
  it('renders landing page when unauthenticated', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
    expect((res as { body: string }).body).toContain('Sign in');
    expect((res as { body: string }).body).toContain('kopi-wealth');
  });

  it('contains sign-in link to /auth/login', async () => {
    const res = await handler(makeEvent(), {} as never, () => {});
    expect((res as { body: string }).body).toContain('/auth/login');
  });

  it('redirects authenticated user to /dashboard', async () => {
    mockParseCookies.mockReturnValue({ sid: 's1' });
    mockGetSession.mockResolvedValue(session);
    const res = await handler(makeEvent('sid=s1'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/dashboard' } });
  });

  it('shows landing page when sid cookie present but session not found', async () => {
    mockParseCookies.mockReturnValue({ sid: 's1' });
    mockGetSession.mockResolvedValue(null);
    const res = await handler(makeEvent('sid=s1'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('shows landing page when no cookies at all', async () => {
    mockParseCookies.mockReturnValue({});
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('falls back to headers.cookie when event.cookies is undefined', async () => {
    const event = { requestContext: { http: { method: 'GET' } }, rawPath: '/', rawQueryString: '', cookies: undefined, headers: { cookie: 'sid=s1' }, body: undefined, isBase64Encoded: false } as never;
    mockParseCookies.mockReturnValue({ sid: 's1' });
    mockGetSession.mockResolvedValue(session);
    const res = await handler(event, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockParseCookies).toHaveBeenCalledWith('sid=s1');
  });
});
