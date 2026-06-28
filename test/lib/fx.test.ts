import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/fxRate', () => ({
  getFxRate: vi.fn(),
  putFxRate: vi.fn(),
}));
vi.mock('../../src/lib/clock', () => ({
  clock: { nowMs: () => new Date('2026-06-28T00:00:00.000Z').getTime(), nowIso: () => '2026-06-28T00:00:00.000Z', today: () => '2026-06-28' },
}));

import { getOrFetchRates, convertAmount } from '../../src/lib/fx';
import { getFxRate, putFxRate } from '../../src/repositories/fxRate';

const mockGetFxRate = vi.mocked(getFxRate);
const mockPutFxRate = vi.mocked(putFxRate);

const cachedRates = { MYR: 3.45, USD: 0.74 };

beforeEach(() => {
  vi.clearAllMocks();
  mockPutFxRate.mockResolvedValue(undefined);
});

describe('getOrFetchRates', () => {
  it('returns cached rates on cache hit', async () => {
    mockGetFxRate.mockResolvedValue({
      PK: 'FXRATE#SGD', SK: 'FXRATE#2024-01-01',
      baseCurrency: 'SGD', date: '2024-01-01',
      rates: cachedRates, createdAt: '2024-01-01T00:00:00.000Z', ttl: 9999999999,
    });
    const result = await getOrFetchRates('SGD');
    expect(result).toEqual({ rates: cachedRates, date: '2024-01-01' });
    expect(mockPutFxRate).not.toHaveBeenCalled();
  });

  it('fetches from frankfurter and caches on miss', async () => {
    mockGetFxRate.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ rates: cachedRates }),
    } as Response);

    const result = await getOrFetchRates('SGD');
    expect(result.rates).toEqual(cachedRates);
    expect(result.date).toBe('2026-06-28');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('frankfurter.app'));
    expect(mockPutFxRate).toHaveBeenCalledOnce();
    expect(mockPutFxRate.mock.calls[0][0]).toMatchObject({
      baseCurrency: 'SGD',
      rates: cachedRates,
    });
    fetchMock.mockRestore();
  });

  it('throws when fetch fails', async () => {
    mockGetFxRate.mockResolvedValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    await expect(getOrFetchRates('SGD')).rejects.toThrow('FX fetch failed');
  });
});

describe('convertAmount', () => {
  const rates = { MYR: 3.45, USD: 0.74 };

  it('returns amount unchanged when from === to', () => {
    expect(convertAmount(100, 'SGD', 'SGD', rates)).toBe(100);
  });

  it('converts MYR to SGD', () => {
    // 345 MYR / 3.45 rate = 100 SGD
    expect(convertAmount(345, 'MYR', 'SGD', rates)).toBeCloseTo(100, 5);
  });

  it('converts USD to SGD', () => {
    // 74 USD / 0.74 rate = 100 SGD
    expect(convertAmount(74, 'USD', 'SGD', rates)).toBeCloseTo(100, 5);
  });

  it('returns null when rate not found', () => {
    expect(convertAmount(100, 'JPY', 'SGD', rates)).toBeNull();
  });
});
