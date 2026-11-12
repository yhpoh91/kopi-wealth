import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSessionOrBearer: vi.fn() }));
vi.mock('../../src/lib/fx', () => ({ getOrFetchHistoricalRate: vi.fn() }));

import { handler } from '../../src/handlers/fxRate';
import { requireSessionOrBearer } from '../../src/lib/auth-middleware';
import { getOrFetchHistoricalRate } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSessionOrBearer);
const mockGetOrFetch = vi.mocked(getOrFetchHistoricalRate);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };

function makeEvent(query: string) {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/fx-rate',
    rawQueryString: query,
    body: undefined,
    isBase64Encoded: false,
    cookies: ['sid=s1'],
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetOrFetch.mockResolvedValue(1.35);
});

describe('GET /fx-rate', () => {
  it('returns rate for valid params', async () => {
    const res = await handler(makeEvent('from=USD&to=SGD&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body).toEqual({ from: 'USD', to: 'SGD', date: '2026-07-03', rate: 1.35 });
    expect(mockGetOrFetch).toHaveBeenCalledWith('USD', 'SGD', '2026-07-03');
  });

  it('returns 401 when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, response: { statusCode: 302, headers: { Location: '/auth/login' }, body: '' } });
    const res = await handler(makeEvent('from=USD&to=SGD&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 401 });
  });

  it('returns 400 for invalid currency', async () => {
    const res = await handler(makeEvent('from=XYZ&to=SGD&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 400 });
    expect(mockGetOrFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid date format', async () => {
    const res = await handler(makeEvent('from=USD&to=SGD&date=07-03-2026'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 for missing params', async () => {
    const res = await handler(makeEvent(''), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 404 when rate not available', async () => {
    mockGetOrFetch.mockResolvedValue(null);
    const res = await handler(makeEvent('from=USD&to=SGD&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 404 });
  });

  it('returns 502 when fetch throws', async () => {
    mockGetOrFetch.mockRejectedValue(new Error('Network error'));
    const res = await handler(makeEvent('from=USD&to=SGD&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 502 });
  });

  it('handles undefined rawQueryString', async () => {
    const event = { requestContext: { http: { method: 'GET' } }, rawPath: '/fx-rate', rawQueryString: undefined, body: undefined, isBase64Encoded: false, cookies: ['sid=s1'], headers: {} } as never;
    const res = await handler(event, {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 400 });
  });
});
