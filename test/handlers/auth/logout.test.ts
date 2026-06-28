import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/session', () => ({
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));

import { handler } from '../../../src/handlers/auth/logout';
import { getSession, deleteSession } from '../../../src/repositories/session';

const mockGetSession = vi.mocked(getSession);
const mockDeleteSession = vi.mocked(deleteSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteSession.mockResolvedValue(undefined);
});

describe('GET/POST /auth/logout', () => {
  it('soft-deletes session and clears sid cookie', async () => {
    mockGetSession.mockResolvedValue({
      PK: 'SESSION#sess1', SK: 'SESSION#sess1',
      sessionId: 'sess1', sub: 'sub1',
      createdAt: '2024-01-01T00:00:00.000Z', ttl: 9999999999,
    });

    const res = await handler(
      { cookies: ['sid=sess1'], headers: {} } as never,
      {} as never,
      () => {},
    );

    expect(mockDeleteSession).toHaveBeenCalledWith('sess1', 'sub1');
    const cookies = (res as { multiValueHeaders: Record<string, string[]> }).multiValueHeaders['Set-Cookie'];
    expect(cookies.some((c: string) => c.includes('sid=') && c.includes('Max-Age=0'))).toBe(true);
    expect((res as { statusCode: number }).statusCode).toBe(302);
    expect((res as { headers: Record<string, string> }).headers.Location).toBe('/auth/login');
  });

  it('redirects even if no sid cookie', async () => {
    const res = await handler(
      { cookies: [], headers: {} } as never,
      {} as never,
      () => {},
    );
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });

  it('redirects gracefully if session not found', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await handler(
      { cookies: ['sid=unknown'], headers: {} } as never,
      {} as never,
      () => {},
    );
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });

  it('falls back to header cookies', async () => {
    mockGetSession.mockResolvedValue({
      PK: 'SESSION#sess2', SK: 'SESSION#sess2',
      sessionId: 'sess2', sub: 'sub2',
      createdAt: '2024-01-01T00:00:00.000Z', ttl: 9999999999,
    });

    const res = await handler(
      { cookies: undefined, headers: { cookie: 'sid=sess2' } } as never,
      {} as never,
      () => {},
    );
    expect(mockDeleteSession).toHaveBeenCalledWith('sess2', 'sub2');
    expect((res as { statusCode: number }).statusCode).toBe(302);
  });
});
