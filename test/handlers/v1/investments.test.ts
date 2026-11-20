import { describe, it, expect, vi, beforeEach } from 'vitest';

type Item = Record<string, any>;
const db = vi.hoisted(() => ({ items: new Map<string, Item>(), snaps: [] as Item[] }));
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));
// In-memory investment repository with the real key patterns (PK INVEST#{sub}, SK INVEST#{id}).
vi.mock('../../../src/repositories/investment', () => ({
  getInvestment: vi.fn(async (sub: string, id: string) => db.items.get(key(`INVEST#${sub}`, `INVEST#${id}`)) ?? null),
  queryByUser: vi.fn(async (sub: string) =>
    [...db.items.values()].filter((a) => a.PK === `INVEST#${sub}` && !a.deletedAt)),
  putInvestment: vi.fn(async (a: Item) => { db.items.set(key(a.PK, a.SK), { ...a }); }),
  updateInvestment: vi.fn(async (sub: string, id: string, f: Item, updatedAt: string) => {
    const k = key(`INVEST#${sub}`, `INVEST#${id}`);
    db.items.set(k, {
      ...db.items.get(k), name: f.name, type: f.type, value: f.value,
      institution: f.institution ?? null, notes: f.notes ?? null, updatedAt,
    });
  }),
  softDelete: vi.fn(async (sub: string, id: string, deletedBy: string, deletedAt: string) => {
    const k = key(`INVEST#${sub}`, `INVEST#${id}`);
    db.items.set(k, { ...db.items.get(k), deletedAt, deletedBy });
  }),
  putSnapshot: vi.fn(async (s: Item) => { db.snaps.push({ ...s }); }),
  // newest first, as the real Query (ScanIndexForward false)
  querySnapshots: vi.fn(async (investId: string, limit = 12) =>
    db.snaps.filter((s) => s.investId === investId)
      .sort((a, b) => b.SK.localeCompare(a.SK)).slice(0, limit)),
}));
// The other asset groups are empty, so /v1/overview and /v1/assets only see investments.
vi.mock('../../../src/repositories/account', () => ({ queryByUser: vi.fn(async () => []) }));
vi.mock('../../../src/repositories/cpf', () => ({ getCpf: vi.fn(async () => null) }));
vi.mock('../../../src/repositories/liability', () => ({ queryByUser: vi.fn(async () => []) }));
vi.mock('../../../src/repositories/receivable', () => ({ queryByUser: vi.fn(async () => []) }));
vi.mock('../../../src/repositories/goal', () => ({ queryByUser: vi.fn(async () => []) }));
vi.mock('../../../src/lib/fx', async (orig) => ({ ...(await orig<typeof import('../../../src/lib/fx')>()), getOrFetchRates: vi.fn() }));
vi.mock('../../../src/lib/clock', () => ({
  clock: {
    nowMs: vi.fn(() => Date.parse('2026-06-29T00:00:00.000Z')),
    nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'),
    today: vi.fn(() => '2026-06-29'),
  },
}));

import { handler } from '../../../src/handlers/v1/investments';
import { handler as assetsHandler } from '../../../src/handlers/v1/assets';
import { handler as overviewHandler } from '../../../src/handlers/v1/overview';
import { handler as webHandler } from '../../../src/handlers/investments';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getSettings } from '../../../src/repositories/financialSettings';
import { getAccountManagementUrl } from '../../../src/lib/account-management';
import { softDelete, querySnapshots } from '../../../src/repositories/investment';
import { getOrFetchRates } from '../../../src/lib/fx';
import { clock } from '../../../src/lib/clock';

const T = '2024-01-01T00:00:00.000Z';
const NOW = '2026-06-29T00:00:00.000Z';
const settings = (currency = 'SGD') => ({ PK: 'SETTINGS#sub1', SK: 'SETTINGS', sub: 'sub1', currency, timezone: 'Asia/Singapore', createdAt: T, updatedAt: T });
type Res = { statusCode: number; body: string; headers?: Record<string, string> };

function ev(method: string, path: string, opts: { body?: unknown; raw?: string; auth?: string | null; b64?: boolean } = {}) {
  const auth = opts.auth === undefined ? 'tok1' : opts.auth;
  const raw = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return {
    requestContext: { http: { method } },
    rawPath: path,
    rawQueryString: '',
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    body: opts.b64 && raw ? Buffer.from(raw).toString('base64') : raw,
    isBase64Encoded: opts.b64 ?? false,
  } as never;
}
const run = async (h: typeof handler, e: never) => {
  const res = await h(e, {} as never, () => {}) as Res;
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, raw: res };
};
const call = (e: never) => run(handler, e);

const rates = { USD: 0.75, SGD: 1 }; // base SGD: 1 SGD = 0.75 USD → USD amounts divide by 0.75

beforeEach(() => {
  vi.clearAllMocks();
  db.items.clear();
  db.snaps.length = 0;
  vi.mocked(getSession).mockImplementation(async (id: string) => {
    const sub = { tok1: 'sub1', tok2: 'sub2', web1: 'sub1' }[id];
    if (!sub) return null;
    return { PK: `SESSION#${id}`, SK: `SESSION#${id}`, sessionId: id, sub, createdAt: T, ttl: 9999999999, ...(id.startsWith('tok') ? { platform: 'mobile' as const } : {}) };
  });
  vi.mocked(getUser).mockResolvedValue({ PK: 'USER#sub1', SK: 'USER#sub1', GSI1PK: 'ALL_USERS', GSI1SK: 'USER#sub1', sub: 'sub1', email: 'u@e.com', createdAt: T, updatedAt: T });
  vi.mocked(getSettings).mockResolvedValue(settings());
  vi.mocked(getAccountManagementUrl).mockResolvedValue('');
  vi.mocked(getOrFetchRates).mockResolvedValue({ rates, date: '2026-06-29' });
  vi.mocked(clock.nowIso).mockReturnValue(NOW);
  vi.mocked(clock.nowMs).mockReturnValue(Date.parse(NOW));
});

const create = (body: Record<string, unknown>, auth = 'tok1') => call(ev('POST', '/v1/investments', { body, auth }));
const iwda = { name: 'IWDA', type: 'etf', currency: 'SGD', value: 1000 };
const list = async (auth = 'tok1') => (await call(ev('GET', '/v1/investments', { auth }))).json;
const holdings = (json: Item) => json.groups.flatMap((g: Item) => g.holdings) as Item[];
const setValueAt = async (id: string, value: number, at: string) => {
  vi.mocked(clock.nowIso).mockReturnValue(at);
  return call(ev('POST', `/v1/investments/${id}/value`, { body: { value } }));
};

describe('auth', () => {
  it('accepts a Bearer token', async () => {
    expect((await call(ev('GET', '/v1/investments'))).status).toBe(200);
  });
  it('accepts a cookie session', async () => {
    const e = { ...(ev('GET', '/v1/investments', { auth: null }) as object), cookies: ['sid=web1'] } as never;
    expect((await call(e)).status).toBe(200);
  });
  it('refuses a signed-out request: JSON 401 for a bad Bearer, login redirect for no cookie', async () => {
    const bad = await call(ev('GET', '/v1/investments', { auth: 'nope' }));
    expect(bad.status).toBe(401);
    expect(bad.json).toEqual({ error: 'unauthorized' });
    expect((await call(ev('GET', '/v1/investments', { auth: null }))).status).toBe(302);
  });
});

describe('GET /v1/investments', () => {
  it('returns no groups and a no_data total for a user with no holdings', async () => {
    const { status, json } = await call(ev('GET', '/v1/investments'));
    expect(status).toBe(200);
    expect(json).toEqual({ currency: 'SGD', total: { value: null, partial: false, reason: 'no_data' }, groups: [] });
  });

  it('defaults the base currency to SGD without settings', async () => {
    vi.mocked(getSettings).mockResolvedValue(null);
    expect((await list()).currency).toBe('SGD');
  });

  it('groups by type (only types present, web order) with totals and shares of the Investments total', async () => {
    await create({ name: 'Crypto', type: 'crypto', currency: 'SGD', value: 80 });
    await create({ name: 'Robo', type: 'robo', currency: 'SGD', value: 250 });
    await create({ name: 'IWDA', type: 'etf', currency: 'SGD', value: 400 });
    await create({ name: 'VWRA', type: 'etf', currency: 'USD', value: 202.5 }); // = 270 SGD
    const json = await list();
    expect(json.total).toEqual({ value: 1000, partial: false, reason: null });
    expect(json.groups.map((g: Item) => g.type)).toEqual(['etf', 'crypto', 'robo']);
    expect(json.groups.map((g: Item) => g.label)).toEqual(['ETF', 'Crypto', 'Robo-Advisor']);
    expect(json.groups.map((g: Item) => g.total.value)).toEqual([670, 80, 250]);
    expect(json.groups.map((g: Item) => g.share)).toEqual([67, 8, 25]);
    expect(json.groups.reduce((s: number, g: Item) => s + g.share, 0)).toBe(100);
    expect(json.groups[0].holdings.map((h: Item) => h.name)).toEqual(['IWDA', 'VWRA']);
  });

  it('a single type has a share of 100', async () => {
    await create(iwda);
    await create({ ...iwda, name: 'Two', value: 333 });
    expect((await list()).groups).toMatchObject([{ type: 'etf', share: 100, total: { value: 1333 } }]);
  });

  it('shares add up to ~100 with awkward splits (one decimal each)', async () => {
    for (const [type, value] of [['etf', 1], ['bonds', 1], ['reit', 1]] as const) await create({ name: type, type, currency: 'SGD', value });
    const sum = (await list()).groups.reduce((s: number, g: Item) => s + g.share, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.3);
  });

  it('a zero total has null shares', async () => {
    await create({ ...iwda, value: 0 });
    const json = await list();
    expect(json.total).toEqual({ value: 0, partial: false, reason: null });
    expect(json.groups[0].share).toBeNull();
  });

  it('lists holdings oldest first with the full holding shape, never raw record keys', async () => {
    vi.mocked(clock.nowIso).mockReturnValueOnce('2026-06-01T00:00:00.000Z');
    await create({ ...iwda, institution: 'IBKR', notes: 'core' });
    await create({ name: 'VWRA', type: 'etf', currency: 'USD', value: 75 });
    const [a, b] = holdings(await list());
    expect(a).toEqual({
      id: expect.any(String), name: 'IWDA', type: 'etf', institution: 'IBKR', notes: 'core', currency: 'SGD', value: 1000,
      converted: { value: 1000, partial: false, reason: null }, updatedAt: '2026-06-01T00:00:00.000Z',
      changeSinceLast: null, due: false, daysSince: 28,
    });
    expect(b).toMatchObject({ name: 'VWRA', currency: 'USD', value: 75, converted: { value: 100, partial: false, reason: null }, institution: null, notes: null });
    expect(a).not.toHaveProperty('PK');
  });

  it('does not fetch FX when everything is in the base currency', async () => {
    await create(iwda);
    await list();
    expect(getOrFetchRates).not.toHaveBeenCalled();
  });

  it('FX failure: foreign holdings are partial, and the totals are null + partial like /v1/assets', async () => {
    await create(iwda);
    await create({ name: 'VWRA', type: 'etf', currency: 'USD', value: 75 });
    await create({ name: 'BTC', type: 'crypto', currency: 'SGD', value: 100 });
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    const json = await list();
    const [etf, crypto] = json.groups;
    expect(holdings(json).find((h) => h.currency === 'USD')!.converted).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(holdings(json).find((h) => h.name === 'IWDA')!.converted.partial).toBe(false);
    expect(json.total).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(etf.total).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(crypto.total).toEqual({ value: 100, partial: false, reason: null });
    expect(etf.share).toBeNull();
    expect(crypto.share).toBeNull(); // the Investments total is unknown
    const assets = await run(assetsHandler, ev('GET', '/v1/assets'));
    expect(assets.json.groups.investments.total).toEqual(json.total);
  });

  it('a currency with no rate is unavailable', async () => {
    await create({ ...iwda, currency: 'JPY' });
    expect(holdings(await list())[0].converted).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
  });

  it("only lists the caller's holdings and hides deleted ones", async () => {
    const mine = (await create(iwda)).json.investment;
    await create({ ...iwda, name: 'Other' }, 'tok2');
    expect(holdings(await list())).toHaveLength(1);
    await call(ev('DELETE', `/v1/investments/${mine.id}`));
    expect((await list()).groups).toEqual([]);
  });

  it('reads snapshots with one Query per holding, limit 2 (no Scan)', async () => {
    await create(iwda);
    await create({ ...iwda, name: 'B' });
    vi.mocked(querySnapshots).mockClear();
    await list();
    expect(querySnapshots).toHaveBeenCalledTimes(2);
    for (const c of vi.mocked(querySnapshots).mock.calls) expect(c[1]).toBe(2);
  });
});

describe('changeSinceLast', () => {
  it('is null with a single snapshot, never 0', async () => {
    await create(iwda);
    expect(holdings(await list())[0].changeSinceLast).toBeNull();
  });

  it('is null for a legacy holding with no snapshots', async () => {
    await create(iwda);
    db.snaps.length = 0;
    expect(holdings(await list())[0].changeSinceLast).toBeNull();
  });

  it('shows an increase against the value before the latest update', async () => {
    const id = (await create(iwda)).json.investment.id;
    await setValueAt(id, 1100, '2026-06-30T00:00:00.000Z');
    expect(holdings(await list())[0].changeSinceLast).toEqual({ amount: 100, percent: 10, since: NOW });
  });

  it('shows a decrease', async () => {
    const id = (await create(iwda)).json.investment.id;
    await setValueAt(id, 750, '2026-06-30T00:00:00.000Z');
    expect(holdings(await list())[0].changeSinceLast).toEqual({ amount: -250, percent: -25, since: NOW });
  });

  it('uses only the latest two snapshots', async () => {
    const id = (await create(iwda)).json.investment.id;
    await setValueAt(id, 2000, '2026-06-30T00:00:00.000Z');
    await setValueAt(id, 2100, '2026-07-01T00:00:00.000Z');
    expect(holdings(await list())[0].changeSinceLast).toEqual({ amount: 100, percent: 5, since: '2026-06-30T00:00:00.000Z' });
  });

  it('percent is null when the earlier value was 0, and a no-change is 0 not null', async () => {
    const id = (await create({ ...iwda, value: 0 })).json.investment.id;
    await setValueAt(id, 50, '2026-06-30T00:00:00.000Z');
    expect(holdings(await list())[0].changeSinceLast).toEqual({ amount: 50, percent: null, since: NOW });
    await setValueAt(id, 50, '2026-07-01T00:00:00.000Z');
    expect(holdings(await list())[0].changeSinceLast).toMatchObject({ amount: 0, percent: 0 });
  });
});

describe('due', () => {
  const at = async (iso: string) => {
    vi.mocked(clock.nowIso).mockReturnValueOnce(iso);
    return (await create({ ...iwda, name: iso })).json.investment;
  };

  it('is due only when more than 30 calendar days old: 29 and 30 not, 31 is', async () => {
    await at('2026-05-31T00:00:00.000Z'); // 29 days
    await at('2026-05-30T00:00:00.000Z'); // 30 days
    await at('2026-05-29T00:00:00.000Z'); // 31 days
    const hs = holdings(await list());
    expect(hs.map((h) => [h.daysSince, h.due]).sort()).toEqual([[29, false], [30, false], [31, true]]);
  });

  it('agrees with /v1/overview due[] and the /v1/assets Investments dueCount', async () => {
    await at('2026-05-01T00:00:00.000Z');
    await at('2026-04-01T00:00:00.000Z');
    await at('2026-06-20T00:00:00.000Z');
    const hs = holdings(await list());
    const dueIds = hs.filter((h) => h.due).map((h) => h.id).sort();
    expect(dueIds).toHaveLength(2);

    const overview = await run(overviewHandler, ev('GET', '/v1/overview'));
    const fromOverview = overview.json.due.filter((d: Item) => d.kind === 'investment');
    expect(fromOverview.map((d: Item) => d.id).sort()).toEqual(dueIds);
    for (const d of fromOverview) expect(d.daysSince).toBe(hs.find((h) => h.id === d.id)!.daysSince);

    const assets = await run(assetsHandler, ev('GET', '/v1/assets'));
    expect(assets.json.groups.investments.dueCount).toBe(dueIds.length);
  });

  it("uses the user's timezone like the due rule", async () => {
    // 2026-06-01T20:00Z is already 2 June in Singapore (+8): 27 days to 29 June there
    await at('2026-06-01T20:00:00.000Z');
    vi.mocked(getSettings).mockResolvedValue({ ...settings(), timezone: 'UTC' });
    expect(holdings(await list())[0].daysSince).toBe(28);
    vi.mocked(getSettings).mockResolvedValue(settings());
    expect(holdings(await list())[0].daysSince).toBe(27);
  });
});

describe('Investments total matches /v1/assets', () => {
  it('same total and group share for the same data, with FX', async () => {
    await create(iwda);
    await create({ name: 'VWRA', type: 'etf', currency: 'USD', value: 75 });
    const json = await list();
    const assets = await run(assetsHandler, ev('GET', '/v1/assets'));
    expect(json.total).toEqual({ value: 1100, partial: false, reason: null });
    expect(assets.json.groups.investments.total).toEqual(json.total);
  });

  it('same no_data total for an empty user', async () => {
    const json = await list();
    const assets = await run(assetsHandler, ev('GET', '/v1/assets'));
    expect(assets.json.groups.investments.total).toEqual(json.total);
  });
});

describe('POST /v1/investments', () => {
  it('creates a holding and its first snapshot, returning the holding', async () => {
    const { status, json } = await create({ ...iwda, name: '  IWDA  ', institution: ' IBKR ' });
    expect(status).toBe(201);
    expect(json.investment).toMatchObject({
      name: 'IWDA', institution: 'IBKR', notes: null, value: 1000, converted: { value: 1000, partial: false, reason: null },
      updatedAt: NOW, changeSinceLast: null, due: false, daysSince: 0,
    });
    expect(db.items.size).toBe(1);
    expect(db.snaps).toHaveLength(1);
    expect(db.snaps[0]).toMatchObject({ PK: `INVEST_SNAP#${json.investment.id}`, value: 1000, investId: json.investment.id });
  });

  it('converts a foreign-currency holding and accepts string values and a base64 body', async () => {
    expect((await create({ name: 'US', type: 'stocks', currency: 'USD', value: '75' })).json.investment.converted.value).toBe(100);
    expect((await call(ev('POST', '/v1/investments', { body: iwda, b64: true }))).status).toBe(201);
  });

  it.each([
    ['bad currency code', { ...iwda, currency: 'XXX' }, 'invalid_currency'],
    ['lowercase currency', { ...iwda, currency: 'sgd' }, 'invalid_currency'],
    ['non-string currency', { ...iwda, currency: 5 }, 'invalid_currency'],
    ['unknown type', { ...iwda, type: 'savings' }, 'invalid_type'],
    ['missing type', { name: 'x', currency: 'SGD', value: 1 }, 'invalid_type'],
    ['empty name', { ...iwda, name: '   ' }, 'invalid_name'],
    ['non-string name', { ...iwda, name: 7 }, 'invalid_name'],
    ['negative value', { ...iwda, value: -1 }, 'invalid_value'],
    ['non-numeric value', { ...iwda, value: 'abc' }, 'invalid_value'],
    ['missing value', { name: 'x', type: 'etf', currency: 'SGD' }, 'invalid_value'],
    ['boolean value', { ...iwda, value: true }, 'invalid_value'],
  ])('rejects %s with 400', async (_n, body, error) => {
    const { status, json } = await create(body);
    expect(status).toBe(400);
    expect(json).toEqual({ error });
    expect(db.items.size).toBe(0);
    expect(db.snaps).toHaveLength(0);
  });

  it('accepts every investment type', async () => {
    for (const type of ['stocks', 'etf', 'unit_trust', 'bonds', 'crypto', 'robo', 'reit', 'private_equity', 'insurance_linked', 'other']) {
      expect((await create({ ...iwda, type })).status).toBe(201);
    }
  });

  it('truncates an over-long name, institution and notes exactly as the web does', async () => {
    const { json } = await create({ ...iwda, name: 'n'.repeat(150), institution: 'i'.repeat(150), notes: 'x'.repeat(600) });
    expect(json.investment.name).toHaveLength(100);
    expect(json.investment.institution).toHaveLength(100);
    expect(json.investment.notes).toHaveLength(500);
  });

  it.each([
    ['not JSON', { raw: '{nope' }],
    ['a JSON array', { raw: '[]' }],
    ['JSON null', { raw: 'null' }],
    ['an empty body', {}],
  ])('rejects %s with 400 invalid_json', async (_n, opts) => {
    const { status, json } = await call(ev('POST', '/v1/investments', opts));
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'invalid_json' });
  });
});

describe('PATCH /v1/investments/{id}', () => {
  it('edits details, keeps the value and writes no snapshot', async () => {
    const id = (await create({ ...iwda, institution: 'IBKR', notes: 'n' })).json.investment.id;
    vi.mocked(clock.nowIso).mockReturnValue('2026-07-01T00:00:00.000Z');
    const { status, json } = await call(ev('PATCH', `/v1/investments/${id}`, { body: { name: 'Renamed', type: 'reit', institution: '', notes: ' hi ' } }));
    expect(status).toBe(200);
    expect(json.investment).toMatchObject({ id, name: 'Renamed', type: 'reit', institution: null, notes: 'hi', value: 1000, currency: 'SGD', updatedAt: '2026-07-01T00:00:00.000Z' });
    expect(db.snaps).toHaveLength(1);
    expect(db.items.get(key('INVEST#sub1', `INVEST#${id}`))).toMatchObject({ name: 'Renamed', institution: null, notes: 'hi', value: 1000 });
  });

  it('keeps fields that are absent, and reports the change from the snapshots', async () => {
    const id = (await create({ ...iwda, institution: 'IBKR', notes: 'n' })).json.investment.id;
    await setValueAt(id, 1200, '2026-06-30T00:00:00.000Z');
    const { json } = await call(ev('PATCH', `/v1/investments/${id}`, { body: { name: 'Only name' } }));
    expect(json.investment).toMatchObject({ name: 'Only name', type: 'etf', institution: 'IBKR', notes: 'n', changeSinceLast: { amount: 200, percent: 20 } });
  });

  it.each([
    ['invalid name', { name: ' ' }, 'invalid_name'],
    ['invalid type', { type: 'x' }, 'invalid_type'],
    ['value field', { name: 'a', value: 5 }, 'invalid_field'],
    ['currency field', { currency: 'USD' }, 'invalid_field'],
    ['nothing to change', { colour: 'red' }, 'no_changes'],
  ])('rejects %s with 400', async (_n, body, error) => {
    const id = (await create(iwda)).json.investment.id;
    const { status, json } = await call(ev('PATCH', `/v1/investments/${id}`, { body }));
    expect(status).toBe(400);
    expect(json).toEqual({ error });
  });

  it('rejects an unparseable body and 404s an unknown id', async () => {
    const id = (await create(iwda)).json.investment.id;
    expect((await call(ev('PATCH', `/v1/investments/${id}`, { raw: 'x' }))).json).toEqual({ error: 'invalid_json' });
    const r = await call(ev('PATCH', '/v1/investments/nope', { body: { name: 'a' } }));
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
  });
});

describe('POST /v1/investments/{id}/value', () => {
  it('stores the new value, writes a snapshot, returns the previous value and date', async () => {
    const id = (await create(iwda)).json.investment.id;
    const { status, json } = await setValueAt(id, 1250.5, '2026-07-01T00:00:00.000Z');
    expect(status).toBe(200);
    expect(json.investment).toMatchObject({
      id, value: 1250.5, updatedAt: '2026-07-01T00:00:00.000Z', name: 'IWDA',
      changeSinceLast: { amount: 250.5, percent: 25.1, since: NOW },
    });
    expect(json.previous).toEqual({ value: 1000, updatedAt: NOW });
    expect(db.snaps).toHaveLength(2);
    expect(db.snaps[1]).toMatchObject({ PK: `INVEST_SNAP#${id}`, value: 1250.5, recordedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('keeps details, and a first update of a legacy holding has no change', async () => {
    const id = (await create({ ...iwda, institution: 'IBKR', notes: 'n' })).json.investment.id;
    db.snaps.length = 0;
    const { json } = await setValueAt(id, 5, '2026-07-01T00:00:00.000Z');
    expect(json.investment).toMatchObject({ institution: 'IBKR', notes: 'n', type: 'etf', changeSinceLast: null });
  });

  it('accepts zero and rejects negative, non-numeric and missing values', async () => {
    const id = (await create(iwda)).json.investment.id;
    expect((await call(ev('POST', `/v1/investments/${id}/value`, { body: { value: 0 } }))).status).toBe(200);
    for (const value of [-5, 'abc', null, undefined]) {
      const r = await call(ev('POST', `/v1/investments/${id}/value`, { body: { value } }));
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: 'invalid_value' });
    }
    expect((await call(ev('POST', `/v1/investments/${id}/value`, { raw: '' }))).json).toEqual({ error: 'invalid_json' });
    expect(db.snaps).toHaveLength(2);
  });

  it('404s for an unknown id', async () => {
    expect((await call(ev('POST', '/v1/investments/nope/value', { body: { value: 1 } }))).status).toBe(404);
  });
});

describe('DELETE /v1/investments/{id}', () => {
  it('soft-deletes (deletedAt, deletedBy) and never removes the record', async () => {
    const id = (await create(iwda)).json.investment.id;
    const { status, json } = await call(ev('DELETE', `/v1/investments/${id}`));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(db.items.get(key('INVEST#sub1', `INVEST#${id}`))).toMatchObject({ deletedAt: NOW, deletedBy: 'sub1' });
  });

  it('404s for an unknown id', async () => {
    expect((await call(ev('DELETE', '/v1/investments/nope'))).status).toBe(404);
  });

  it('answers 404 for an already-deleted holding and does not write again', async () => {
    const id = (await create(iwda)).json.investment.id;
    await call(ev('DELETE', `/v1/investments/${id}`));
    vi.mocked(softDelete).mockClear();
    expect((await call(ev('DELETE', `/v1/investments/${id}`))).status).toBe(404);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('a deleted holding cannot be patched or have its value updated', async () => {
    const id = (await create(iwda)).json.investment.id;
    await call(ev('DELETE', `/v1/investments/${id}`));
    expect((await call(ev('PATCH', `/v1/investments/${id}`, { body: { name: 'x' } }))).status).toBe(404);
    expect((await call(ev('POST', `/v1/investments/${id}/value`, { body: { value: 5 } }))).status).toBe(404);
    expect(db.snaps).toHaveLength(1);
  });
});

describe('ownership (two users)', () => {
  it("answers 404 for another user's holding on PATCH, value and DELETE, and changes nothing", async () => {
    const id = (await create(iwda)).json.investment.id; // owned by sub1
    const before = JSON.stringify([...db.items.entries()]);
    const snaps = db.snaps.length;

    for (const r of [
      await call(ev('PATCH', `/v1/investments/${id}`, { body: { name: 'hacked' }, auth: 'tok2' })),
      await call(ev('POST', `/v1/investments/${id}/value`, { body: { value: 1 }, auth: 'tok2' })),
      await call(ev('DELETE', `/v1/investments/${id}`, { auth: 'tok2' })),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' }); // same as a non-existent id
    }
    expect(JSON.stringify([...db.items.entries()])).toBe(before);
    expect(db.snaps).toHaveLength(snaps);
    expect(holdings(await list())[0]).toMatchObject({ id, name: 'IWDA', value: 1000 });
    expect((await list('tok2')).groups).toEqual([]);
  });
});

describe('round trip', () => {
  it('create, patch, value update, delete', async () => {
    const created = (await create({ ...iwda, value: 100 })).json.investment;
    await call(ev('PATCH', `/v1/investments/${created.id}`, { body: { name: 'IWDA 2' } }));
    const upd = await setValueAt(created.id, 250, '2026-07-01T00:00:00.000Z');
    expect(upd.json.investment).toMatchObject({ name: 'IWDA 2', value: 250 });
    const json = await list();
    expect(json.total.value).toBe(250);
    expect(json.groups[0].holdings[0].changeSinceLast).toMatchObject({ amount: 150, percent: 150 });
    await call(ev('DELETE', `/v1/investments/${created.id}`));
    expect((await list()).groups).toEqual([]);
  });
});

describe('routing and errors', () => {
  it.each([
    ['PUT', '/v1/investments'],
    ['GET', '/v1/investments/abc'],
    ['PUT', '/v1/investments/abc/value'],
    ['POST', '/v1/investments/abc/other'],
    ['POST', '/v1/investments/abc/value/extra'],
    ['PATCH', '/v1/investments/abc/extra/more'],
  ])('%s %s is a 404 JSON error', async (m, p) => {
    const r = await call(ev(m, p, { body: {} }));
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
  });

  it('turns an unexpected failure into a 500 without a stack trace', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSettings).mockRejectedValue(new Error('ddb exploded at /secret/path'));
    const r = await call(ev('GET', '/v1/investments'));
    expect(r.status).toBe(500);
    expect(r.raw.body).toBe('{"error":"internal_error"}');
    vi.mocked(getSettings).mockRejectedValue('weird');
    expect((await call(ev('GET', '/v1/investments'))).status).toBe(500);
    spy.mockRestore();
  });
});

describe('web and API write identical records', () => {
  const webPost = async (path: string, form: Record<string, string>) => {
    const res = await webHandler({
      requestContext: { http: { method: 'POST' } }, rawPath: path, rawQueryString: '',
      headers: {}, cookies: ['sid=web1'], isBase64Encoded: false, body: new URLSearchParams(form).toString(),
    } as never, {} as never, () => {}) as Res;
    expect(res.statusCode).toBe(302);
    return res;
  };
  // ids are random: replace each with a placeholder so records compare structurally
  const normalised = () => JSON.parse(JSON.stringify({ items: [...db.items.values()], snaps: db.snaps })
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'));

  it('create + value update + snapshots match the web form', async () => {
    const input = { name: ' IWDA ', type: 'etf', currency: 'USD', value: '1000.5', institution: 'IBKR', notes: 'core' };
    await webPost('/investments', input);
    const webId = [...db.items.values()][0].id as string;
    vi.mocked(clock.nowIso).mockReturnValue('2026-07-01T00:00:00.000Z');
    await webPost(`/investments/${webId}`, { name: 'IWDA 2', type: 'reit', value: '2000', institution: 'IBKR', notes: 'core' });
    const web = normalised();

    db.items.clear(); db.snaps.length = 0;
    vi.mocked(clock.nowIso).mockReturnValue(NOW);
    const id = (await create({ ...input, value: 1000.5 })).json.investment.id;
    vi.mocked(clock.nowIso).mockReturnValue('2026-07-01T00:00:00.000Z');
    // PATCH + value reproduces the web edit; the API writes one snapshot per value change
    await call(ev('PATCH', `/v1/investments/${id}`, { body: { name: 'IWDA 2', type: 'reit' } }));
    await call(ev('POST', `/v1/investments/${id}/value`, { body: { value: 2000 } }));
    const api = normalised();

    expect(api.items).toEqual(web.items);
    expect(api.snaps).toEqual(web.snaps);
  });

  it('web and API reject the same invalid input', async () => {
    const bad = { name: 'x', type: 'etf', currency: 'SGD', value: '-3' };
    await webPost('/investments', bad);
    expect(db.items.size).toBe(0);
    expect((await create(bad)).status).toBe(400);
    const badType = { ...bad, value: '3', type: 'nope' };
    await webPost('/investments', badType);
    expect(db.items.size).toBe(0);
    expect((await create(badType)).status).toBe(400);
  });
});
