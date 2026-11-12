import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSessionOrBearer: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/expenseItem', () => ({
  getExpenseItem: vi.fn(),
  queryByUser: vi.fn(),
  putExpenseItem: vi.fn(),
  updateExpenseItem: vi.fn(),
  softDeleteExpenseItem: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: {
    nowIso: vi.fn(() => '2026-07-03T12:00:00.000Z'),
    today: vi.fn(() => '2026-07-03'),
  },
}));
vi.mock('node:crypto', () => ({ randomUUID: vi.fn(() => 'uuid-1') }));

import { handler } from '../../src/handlers/expenseItems';
import { requireSessionOrBearer } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { queryByUser, putExpenseItem, updateExpenseItem, softDeleteExpenseItem } from '../../src/repositories/expenseItem';

const mockRequireSession = vi.mocked(requireSessionOrBearer);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockQueryByUser = vi.mocked(queryByUser);
const mockPutExpenseItem = vi.mocked(putExpenseItem);
const mockUpdateExpenseItem = vi.mocked(updateExpenseItem);
const mockSoftDeleteExpenseItem = vi.mocked(softDeleteExpenseItem);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

const expenseItem = {
  PK: 'EXPENSE_ITEM#sub1', SK: 'ITEM#2026-07-03#id1',
  id: 'id1', sub: 'sub1', amount: 12.5, currency: 'SGD',
  name: 'Lunch', date: '2026-07-03',
  createdAt: '2026-07-03T12:00:00.000Z', updatedAt: '2026-07-03T12:00:00.000Z',
};
const usdItem = {
  ...expenseItem, id: 'id2', SK: 'ITEM#2026-07-03#id2', currency: 'USD', exchangeRate: 1.35,
};

function makeEvent(method: string, path: string, body?: string, opts: { base64?: boolean; query?: string } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    rawQueryString: opts.query ?? '',
    body: opts.base64 ? Buffer.from(body ?? '').toString('base64') : body,
    isBase64Encoded: opts.base64 ?? false,
    cookies: ['sid=s1'],
    headers: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(auth);
  mockGetUser.mockResolvedValue(user);
  mockGetSettings.mockResolvedValue(settings);
  mockQueryByUser.mockResolvedValue({ items: [], lastSK: undefined });
  mockPutExpenseItem.mockResolvedValue(undefined);
  mockUpdateExpenseItem.mockResolvedValue(undefined);
  mockSoftDeleteExpenseItem.mockResolvedValue(undefined);
});

describe('GET /expenses/items', () => {
  it('returns 200 with expense list page', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 200 });
    expect((res as { body: string }).body).toContain('Expenses');
    expect((res as { body: string }).body).toContain('Lunch');
  });

  it('shows empty state when no items', async () => {
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('No expenses yet');
  });

  it('shows date group headers', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('Today');
  });

  it('shows Load more button when lastSK is set', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: 'ITEM#2026-07-02#id0' });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('exp-more-wrap');
  });

  it('does not show Load more button when no lastSK', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect((res as { body: string }).body).not.toMatch(/onclick="loadNextPage\(/);
  });

  it('returns JSON fragment for partial=1 with more items', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: 'ITEM#2026-07-02#id0' });
    const res = await handler(makeEvent('GET', '/expenses/items', undefined, { query: 'partial=1&before=ITEM%232026-07-02%23id0' }), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'application/json' } });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.itemsHtml).toContain('Lunch');
    expect(body.nextCursor).toBe('ITEM#2026-07-02#id0');
  });

  it('returns JSON fragment for partial=1 with no more items', async () => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items', undefined, { query: 'partial=1' }), {} as never, {} as never);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.nextCursor).toBeNull();
  });

  it('shows error banner when ?error=invalid present', async () => {
    const res = await handler(makeEvent('GET', '/expenses/items', undefined, { query: 'error=invalid' }), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('check the amount');
  });

  it('shows generic error message for non-invalid error', async () => {
    const res = await handler(makeEvent('GET', '/expenses/items', undefined, { query: 'error=not_found' }), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('Something went wrong');
  });

  it('renders notes when item has notes', async () => {
    const itemWithNotes = { ...expenseItem, notes: 'With colleague' };
    mockQueryByUser.mockResolvedValue({ items: [itemWithNotes], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect((res as { body: string }).body).toContain('With colleague');
  });

  it('shows FX rate field and base equivalent for non-base-currency item', async () => {
    mockQueryByUser.mockResolvedValue({ items: [usdItem], lastSK: undefined });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    const body = (res as { body: string }).body;
    expect(body).toContain('exchangeRate');
    expect(body).toContain('≈ SGD');
  });

  it('passes before cursor to queryByUser', async () => {
    mockQueryByUser.mockResolvedValue({ items: [], lastSK: undefined });
    await handler(makeEvent('GET', '/expenses/items', undefined, { query: 'before=ITEM%232026-07-02%23id0' }), {} as never, {} as never);
    expect(mockQueryByUser).toHaveBeenCalledWith('sub1', expect.objectContaining({ before: 'ITEM#2026-07-02#id0' }));
  });

  it('handles undefined rawQueryString', async () => {
    const event = { requestContext: { http: { method: 'GET' } }, rawPath: '/expenses/items', rawQueryString: undefined, body: undefined, isBase64Encoded: false, cookies: ['sid=s1'], headers: {} } as never;
    const res = await handler(event, {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('redirects to login when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, response: { statusCode: 302, headers: { Location: '/auth/login' }, body: '' } });
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('falls back to session sub when user not found', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await handler(makeEvent('GET', '/expenses/items'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 200 });
  });
});

describe('POST /expenses/items (create)', () => {
  it('creates item and redirects', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items', 'amount=12.50&date=2026-07-03&currency=SGD'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items' } });
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({
      amount: 12.5,
      currency: 'SGD',
      date: '2026-07-03',
    }));
  });

  it('falls back to user currency when invalid currency submitted', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03&currency=INVALID'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ currency: 'SGD' }));
  });

  it('auto-generates name when blank', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Expense at 12:00',
    }));
  });

  it('uses submitted name when provided', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03&name=Dinner'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dinner' }));
  });

  it('defaults date to today when not provided', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-03' }));
  });

  it('rejects future date', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2099-01-01'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items?error=invalid' } });
    expect(mockPutExpenseItem).not.toHaveBeenCalled();
  });

  it('rejects negative amount', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items', 'amount=-5&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items?error=invalid' } });
    expect(mockPutExpenseItem).not.toHaveBeenCalled();
  });

  it('rejects zero amount', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items', 'amount=0&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockPutExpenseItem).not.toHaveBeenCalled();
  });

  it('stores exchangeRate when provided', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03&currency=USD&exchangeRate=1.35'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ exchangeRate: 1.35 }));
  });

  it('omits exchangeRate when not provided', async () => {
    await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03'), {} as never, {} as never);
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ exchangeRate: undefined }));
  });

  it('handles base64-encoded body', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items', 'amount=10&date=2026-07-03', { base64: true }), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items' } });
    expect(mockPutExpenseItem).toHaveBeenCalled();
  });
});

describe('POST /expenses/items/:id (update)', () => {
  beforeEach(() => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
  });

  it('updates item and redirects', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items/id1', 'name=Dinner&amount=25&date=2026-07-03'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items' } });
    expect(mockUpdateExpenseItem).toHaveBeenCalledWith('sub1', '2026-07-03', 'id1', expect.objectContaining({ name: 'Dinner', amount: 25 }), '2026-07-03T12:00:00.000Z');
  });

  it('ignores currency change attempt', async () => {
    await handler(makeEvent('POST', '/expenses/items/id1', 'name=Dinner&amount=25&date=2026-07-03&currency=USD'), {} as never, {} as never);
    // currency is not passed to updateExpenseItem
    expect(mockUpdateExpenseItem).toHaveBeenCalledWith('sub1', '2026-07-03', 'id1', expect.not.objectContaining({ currency: expect.anything() }), expect.any(String));
  });

  it('rejects invalid amount on update', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items/id1', 'name=Dinner&amount=-5'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302 });
    expect(mockUpdateExpenseItem).not.toHaveBeenCalled();
  });

  it('redirects not_found when item missing', async () => {
    mockQueryByUser.mockResolvedValue({ items: [], lastSK: undefined });
    const res = await handler(makeEvent('POST', '/expenses/items/id99', 'name=X&amount=10'), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items?error=not_found' } });
  });

  it('stores exchangeRate on update when provided', async () => {
    await handler(makeEvent('POST', '/expenses/items/id1', 'name=Lunch&amount=12.5&date=2026-07-03&exchangeRate=1.35'), {} as never, {} as never);
    expect(mockUpdateExpenseItem).toHaveBeenCalledWith('sub1', '2026-07-03', 'id1', expect.objectContaining({ exchangeRate: 1.35 }), expect.any(String));
  });

  it('omits exchangeRate on update when invalid', async () => {
    await handler(makeEvent('POST', '/expenses/items/id1', 'name=Lunch&amount=12.5&date=2026-07-03&exchangeRate=abc'), {} as never, {} as never);
    expect(mockUpdateExpenseItem).toHaveBeenCalledWith('sub1', '2026-07-03', 'id1', expect.objectContaining({ exchangeRate: undefined }), expect.any(String));
  });

  it('recreates item when date changes', async () => {
    await handler(makeEvent('POST', '/expenses/items/id1', 'name=Lunch&amount=12.5&date=2026-07-03&editDate=2026-07-02'), {} as never, {} as never);
    expect(mockSoftDeleteExpenseItem).toHaveBeenCalled();
    expect(mockPutExpenseItem).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-02' }));
  });
});

describe('POST /expenses/items/:id/delete', () => {
  beforeEach(() => {
    mockQueryByUser.mockResolvedValue({ items: [expenseItem], lastSK: undefined });
  });

  it('soft-deletes item and redirects', async () => {
    const res = await handler(makeEvent('POST', '/expenses/items/id1/delete', ''), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items' } });
    expect(mockSoftDeleteExpenseItem).toHaveBeenCalledWith('sub1', '2026-07-03', 'id1', 'sub1', '2026-07-03T12:00:00.000Z');
  });

  it('redirects cleanly when item not found', async () => {
    mockQueryByUser.mockResolvedValue({ items: [], lastSK: undefined });
    const res = await handler(makeEvent('POST', '/expenses/items/id99/delete', ''), {} as never, {} as never);
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/expenses/items' } });
    expect(mockSoftDeleteExpenseItem).not.toHaveBeenCalled();
  });
});
