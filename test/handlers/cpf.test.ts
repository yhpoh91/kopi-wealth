import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth-middleware', () => ({ requireSession: vi.fn() }));
vi.mock('../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/repositories/cpf', () => ({
  getCpf: vi.fn(),
  upsertCpf: vi.fn(),
  putCpfSnapshot: vi.fn(),
}));
vi.mock('../../src/lib/fx', () => ({
  getOrFetchRates: vi.fn(),
  convertAmount: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowMs: vi.fn(() => 0), nowIso: vi.fn(() => '2026-06-28T12:00:00.000Z'), today: vi.fn(() => '2026-06-28') },
}));

import { handler } from '../../src/handlers/cpf';
import { requireSession } from '../../src/lib/auth-middleware';
import { getUser } from '../../src/repositories/user';
import { getSettings } from '../../src/repositories/financialSettings';
import { getCpf, upsertCpf, putCpfSnapshot } from '../../src/repositories/cpf';
import { getOrFetchRates, convertAmount } from '../../src/lib/fx';

const mockRequireSession = vi.mocked(requireSession);
const mockGetUser = vi.mocked(getUser);
const mockGetSettings = vi.mocked(getSettings);
const mockGetCpf = vi.mocked(getCpf);
const mockUpsertCpf = vi.mocked(upsertCpf);
const mockPutCpfSnapshot = vi.mocked(putCpfSnapshot);
const mockGetOrFetchRates = vi.mocked(getOrFetchRates);
const mockConvertAmount = vi.mocked(convertAmount);

const auth = { authenticated: true as const, session: { sessionId: 's1', sub: 'sub1', role: undefined as undefined } };
const user = { PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const settings = { PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency: 'SGD', timezone: 'Asia/Singapore', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const cpfRecord = { PK: 'CPF#sub1', SK: 'CPF', sub: 'sub1', oa: 10000, sa: 20000, ma: 5000, ra: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };

function makeEvent(method: string, body?: string, opts: { base64?: boolean; query?: string } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: '/cpf',
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
  mockGetCpf.mockResolvedValue(null);
  mockUpsertCpf.mockResolvedValue(undefined);
  mockPutCpfSnapshot.mockResolvedValue(undefined);
  mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
  mockConvertAmount.mockReturnValue(null);
});

describe('GET /cpf', () => {
  it('redirects when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue({ authenticated: false, redirect: { statusCode: 302, headers: { Location: '/auth/login' }, cookies: [], body: '' } });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
  });

  it('returns 200 HTML', async () => {
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
  });

  it('shows empty state when no CPF data', async () => {
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('No CPF data yet');
  });

  it('shows CPF balances when data exists', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('10,000.00');
    expect(body).toContain('20,000.00');
    expect(body).toContain('5,000.00');
  });

  it('shows total CPF balance', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('35,000.00');
  });

  it('shows interest rates on account cards', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('2.50% p.a.');
    expect(body).toContain('4.00% p.a.');
  });

  it('shows CPF reference figures', async () => {
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('110,200.00');
    expect(body).toContain('220,400.00');
    expect(body).toContain('75,500.00');
  });

  it('shows SA progress bar when CPF data exists and RA is 0', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('SA Progress');
  });

  it('shows RA progress bar when RA > 0', async () => {
    mockGetCpf.mockResolvedValue({ ...cpfRecord, ra: 50000 });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('RA Progress');
  });

  it('shows error banner on invalid query param', async () => {
    const res = await handler(makeEvent('GET', undefined, { query: 'error=invalid' }), {} as never, () => {});
    expect((res as { body: string }).body).toContain('valid amounts');
  });

  it('shows as-of date when CPF data exists', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('as of');
  });

  it('shows FX conversion when base currency is not SGD', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 3.45 }, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(120750);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('≈ MYR');
    expect(body).toContain('120,750.00');
  });

  it('shows rate label when FX available for non-SGD base', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 3.45 }, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(120750);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('1 SGD =');
  });

  it('shows rate tooltip with retrieval date', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 3.45 }, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(120750);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Rate as of 2026-06-28');
  });

  it('shows fallback dash when FX conversion null', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: {}, date: '2026-06-28' });
    mockConvertAmount.mockReturnValue(null);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('≈ MYR —');
  });

  it('shows rate unavailable tooltip when ratesDate empty', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockResolvedValue({ rates: { SGD: 3.45 }, date: '' });
    mockConvertAmount.mockReturnValue(120750);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Rate unavailable');
  });

  it('gracefully handles FX fetch failure', async () => {
    mockGetSettings.mockResolvedValue({ ...settings, currency: 'MYR' });
    mockGetCpf.mockResolvedValue(cpfRecord);
    mockGetOrFetchRates.mockRejectedValue(new Error('network'));
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect((res as { body: string }).body).toContain('rate unavailable');
  });

  it('does not call FX when base currency is SGD', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    await handler(makeEvent('GET'), {} as never, () => {});
    expect(mockGetOrFetchRates).not.toHaveBeenCalled();
  });

  it('does not show FX line when base currency is SGD', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).not.toContain('≈ SGD');
  });

  it('shows BRS met label when RA >= BRS', async () => {
    mockGetCpf.mockResolvedValue({ ...cpfRecord, ra: 111000 });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('BRS met');
  });

  it('shows FRS met label when RA >= FRS', async () => {
    mockGetCpf.mockResolvedValue({ ...cpfRecord, ra: 221000 });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('FRS met');
  });

  it('shows ERS met label when RA >= ERS', async () => {
    mockGetCpf.mockResolvedValue({ ...cpfRecord, ra: 441000 });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('ERS met');
  });

  it('shows below BRS label when RA < BRS', async () => {
    mockGetCpf.mockResolvedValue({ ...cpfRecord, ra: 50000 });
    const res = await handler(makeEvent('GET'), {} as never, () => {});
    expect((res as { body: string }).body).toContain('Below BRS');
  });
});

describe('POST /cpf', () => {
  const validBody = new URLSearchParams({ oa: '10000', sa: '20000', ma: '5000', ra: '0' }).toString();


  it('creates CPF record and redirects', async () => {
    const res = await handler(makeEvent('POST', validBody), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf' } });
    expect(mockUpsertCpf).toHaveBeenCalledOnce();
    expect(mockPutCpfSnapshot).toHaveBeenCalledOnce();
  });

  it('preserves createdAt when record exists', async () => {
    mockGetCpf.mockResolvedValue(cpfRecord);
    await handler(makeEvent('POST', validBody), {} as never, () => {});
    expect(mockUpsertCpf.mock.calls[0][0].createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('uses clock.nowIso for createdAt when new record', async () => {
    await handler(makeEvent('POST', validBody), {} as never, () => {});
    expect(mockUpsertCpf.mock.calls[0][0].createdAt).toBe('2026-06-28T12:00:00.000Z');
  });

  it('redirects on invalid (non-numeric) values', async () => {
    const body = new URLSearchParams({ oa: 'abc', sa: '0', ma: '0', ra: '0' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf?error=invalid' } });
    expect(mockUpsertCpf).not.toHaveBeenCalled();
  });

  it('redirects on negative values', async () => {
    const body = new URLSearchParams({ oa: '-1', sa: '0', ma: '0', ra: '0' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf?error=invalid' } });
    expect(mockUpsertCpf).not.toHaveBeenCalled();
  });

  it('accepts base64-encoded body', async () => {
    const res = await handler(makeEvent('POST', validBody, { base64: true }), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf' } });
    expect(mockUpsertCpf).toHaveBeenCalledOnce();
  });

  it('accepts zero values for all fields', async () => {
    const body = new URLSearchParams({ oa: '0', sa: '0', ma: '0', ra: '0' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf' } });
    expect(mockUpsertCpf).toHaveBeenCalledOnce();
  });

  it('treats missing RA as 0 (optional field)', async () => {
    const body = new URLSearchParams({ oa: '10000', sa: '20000', ma: '5000' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf' } });
    expect(mockUpsertCpf.mock.calls[0][0].ra).toBe(0);
  });

  it('treats empty RA string as 0 (optional field)', async () => {
    const body = new URLSearchParams({ oa: '10000', sa: '20000', ma: '5000', ra: '' }).toString();
    const res = await handler(makeEvent('POST', body), {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/cpf' } });
    expect(mockUpsertCpf.mock.calls[0][0].ra).toBe(0);
  });
});
