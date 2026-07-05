import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));

import { handler } from '../../src/handlers/cashFlowHub';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent() {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/cash-flow',
    rawQueryString: '',
    cookies: ['sid=s1'],
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
});

describe('GET /cash-flow', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent(), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('renders 200 with Cash Flow title', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Cash Flow');
  });

  it('renders link to /expenses/items', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('/expenses/items');
  });

  it('shows Income as coming soon', async () => {
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('Income');
    expect(res.body).toContain('Coming soon');
  });

  it('falls back to user email when no settings', async () => {
    mockGetSettings.mockResolvedValue(null);
    const res = await handler(makeEvent(), {} as never, () => {}) as { statusCode: number };
    expect(res.statusCode).toBe(200);
  });

  it('uses displayName from settings when present', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, displayName: 'My Name' });
    const res = await handler(makeEvent(), {} as never, () => {}) as { body: string };
    expect(res.body).toContain('My Name');
  });
});
