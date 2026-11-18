import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../src/repositories/fxRate', () => ({ getFxRate: vi.fn(), putFxRate: vi.fn() }));
vi.mock('../../../src/lib/clock', () => ({
  clock: { nowMs: vi.fn(() => Date.parse('2026-06-29T00:00:00.000Z')), nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'), today: vi.fn(() => '2026-06-29') },
}));

import { handler } from '../../../src/handlers/v1/fxRate';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getFxRate, putFxRate } from '../../../src/repositories/fxRate';

const T = '2024-01-01T00:00:00.000Z';
type Res = { statusCode: number; body: string; headers?: Record<string, string> };
const ev = (query: string, auth: string | null = 'tok') => ({
  requestContext: { http: { method: 'GET' } }, rawPath: '/v1/fx-rate', rawQueryString: query,
  headers: auth ? { authorization: `Bearer ${auth}` } : {},
}) as never;
const call = async (query: string, auth?: string | null) => {
  const r = await handler(ev(query, auth), {} as never, () => {}) as Res;
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockImplementation(async (id: string) =>
    id === 'tok' ? { PK: 'SESSION#tok', SK: 'SESSION#tok', sessionId: 'tok', sub: 'sub1', createdAt: T, ttl: 9999999999, platform: 'mobile' as const } : null);
  vi.mocked(getUser).mockResolvedValue(null);
  vi.mocked(getFxRate).mockResolvedValue(null);
  vi.mocked(putFxRate).mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rates: { SGD: 1.35 }, date: '2026-06-29' }) })));
});

describe('GET /v1/fx-rate', () => {
  it('is refused without a valid Bearer token', async () => {
    expect((await call('from=USD&to=SGD', 'bad')).status).toBe(401);
    expect((await call('from=USD&to=SGD', null)).status).toBe(302);
  });

  it('returns rate 1 for the same currency without calling the provider', async () => {
    const { status, json } = await call('from=sgd&to=SGD');
    expect(status).toBe(200);
    expect(json).toEqual({ from: 'SGD', to: 'SGD', date: '2026-06-29', rate: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the rate for a valid pair, defaulting the date to today', async () => {
    const { status, json } = await call('from=USD&to=SGD');
    expect(status).toBe(200);
    expect(json).toEqual({ from: 'USD', to: 'SGD', date: '2026-06-29', rate: 1.35 });
  });

  it('honours an explicit date', async () => {
    expect((await call('from=USD&to=SGD&date=2026-01-02')).json.date).toBe('2026-01-02');
  });

  it.each([
    ['unknown currency', 'from=XXX&to=SGD'],
    ['missing to', 'from=USD'],
    ['bad date', 'from=USD&to=SGD&date=yesterday'],
  ])('rejects %s with 400', async (_n, q) => {
    const { status, json } = await call(q);
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'Invalid parameters' });
  });

  it('404s when the provider has no rate for the target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rates: {}, date: '2026-06-29' }) })));
    expect(await call('from=USD&to=SGD')).toEqual({ status: 404, json: { error: 'Rate not available' } });
  });

  it('502s without a stack trace when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await call('from=USD&to=SGD')).toEqual({ status: 502, json: { error: 'Failed to fetch rate' } });
  });
});
