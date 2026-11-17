import { describe, it, expect, vi, beforeEach } from 'vitest';

type Item = Record<string, any>;
const db = vi.hoisted(() => ({ items: new Map<string, Item>(), snaps: [] as Item[] }));
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock('../../../src/repositories/session', () => ({ getSession: vi.fn(), renewSessionTtl: vi.fn() }));
vi.mock('../../../src/repositories/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../src/repositories/financialSettings', () => ({ getSettings: vi.fn() }));
vi.mock('../../../src/lib/account-management', () => ({ getAccountManagementUrl: vi.fn() }));
// In-memory account repository with the real key patterns (PK ACCOUNT#{sub}, SK ACCOUNT#{id}).
vi.mock('../../../src/repositories/account', () => ({
  getAccount: vi.fn(async (sub: string, id: string) => db.items.get(key(`ACCOUNT#${sub}`, `ACCOUNT#${id}`)) ?? null),
  queryByUser: vi.fn(async (sub: string) =>
    [...db.items.values()].filter((a) => a.PK === `ACCOUNT#${sub}` && !a.deletedAt)),
  putAccount: vi.fn(async (a: Item) => { db.items.set(key(a.PK, a.SK), { ...a }); }),
  updateAccount: vi.fn(async (sub: string, id: string, f: Item, updatedAt: string) => {
    const k = key(`ACCOUNT#${sub}`, `ACCOUNT#${id}`);
    db.items.set(k, {
      ...db.items.get(k), name: f.name, type: f.type, balance: f.balance,
      institution: f.institution ?? null, notes: f.notes ?? null, updatedAt,
    });
  }),
  softDelete: vi.fn(async (sub: string, id: string, deletedBy: string, deletedAt: string) => {
    const k = key(`ACCOUNT#${sub}`, `ACCOUNT#${id}`);
    db.items.set(k, { ...db.items.get(k), deletedAt, deletedBy });
  }),
  putSnapshot: vi.fn(async (s: Item) => { db.snaps.push({ ...s }); }),
}));
vi.mock('../../../src/lib/fx', async (orig) => ({ ...(await orig<typeof import('../../../src/lib/fx')>()), getOrFetchRates: vi.fn() }));
vi.mock('../../../src/lib/clock', () => ({
  clock: {
    nowMs: vi.fn(() => Date.parse('2026-06-29T00:00:00.000Z')),
    nowIso: vi.fn(() => '2026-06-29T00:00:00.000Z'),
    today: vi.fn(() => '2026-06-29'),
  },
}));

import { handler } from '../../../src/handlers/v1/accounts';
import { handler as webHandler } from '../../../src/handlers/accounts';
import { getSession } from '../../../src/repositories/session';
import { getUser } from '../../../src/repositories/user';
import { getSettings } from '../../../src/repositories/financialSettings';
import { getAccountManagementUrl } from '../../../src/lib/account-management';
import { getOrFetchRates } from '../../../src/lib/fx';
import { clock } from '../../../src/lib/clock';

const T = '2024-01-01T00:00:00.000Z';
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
const call = async (e: never) => {
  const res = await handler(e, {} as never, () => {}) as Res;
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, raw: res };
};

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
  vi.mocked(clock.nowIso).mockReturnValue('2026-06-29T00:00:00.000Z');
});

const create = (body: Record<string, unknown>, auth = 'tok1') => call(ev('POST', '/v1/accounts', { body, auth }));
const dbs = { name: 'DBS', type: 'savings', currency: 'SGD', balance: 1000 };

describe('auth', () => {
  it('accepts a Bearer token', async () => {
    expect((await call(ev('GET', '/v1/accounts'))).status).toBe(200);
  });
  it('accepts a cookie session', async () => {
    const e = { ...(ev('GET', '/v1/accounts', { auth: null }) as object), cookies: ['sid=web1'] } as never;
    expect((await call(e)).status).toBe(200);
  });
  it('refuses a signed-out request: JSON 401 for a bad Bearer, login redirect for no cookie', async () => {
    const bad = await call(ev('GET', '/v1/accounts', { auth: 'nope' }));
    expect(bad.status).toBe(401);
    expect(bad.json).toEqual({ error: 'unauthorized' });
    const none = await call(ev('GET', '/v1/accounts', { auth: null }));
    expect(none.status).toBe(302);
  });
});

describe('GET /v1/accounts', () => {
  it('returns an empty list and a no_data total for a user with no accounts', async () => {
    const { status, json } = await call(ev('GET', '/v1/accounts'));
    expect(status).toBe(200);
    expect(json).toEqual({ currency: 'SGD', total: { value: null, partial: false, reason: 'no_data' }, accounts: [] });
  });

  it('defaults the base currency to SGD without settings', async () => {
    vi.mocked(getSettings).mockResolvedValue(null);
    expect((await call(ev('GET', '/v1/accounts'))).json.currency).toBe('SGD');
  });

  it('lists accounts oldest first with converted amounts and a base-currency total', async () => {
    vi.mocked(clock.nowIso).mockReturnValueOnce('2026-06-01T00:00:00.000Z');
    await create({ ...dbs, institution: 'DBS Bank', notes: 'main' });
    await create({ name: 'US', type: 'checking', currency: 'USD', balance: 75 });
    const { json } = await call(ev('GET', '/v1/accounts'));
    expect(json.currency).toBe('SGD');
    expect(json.total).toEqual({ value: 1100, partial: false, reason: null });
    expect(json.accounts.map((a: Item) => a.name)).toEqual(['DBS', 'US']);
    expect(json.accounts[0]).toMatchObject({
      name: 'DBS', type: 'savings', institution: 'DBS Bank', notes: 'main', currency: 'SGD', balance: 1000,
      converted: { value: 1000, partial: false, reason: null },
    });
    expect(json.accounts[1]).toMatchObject({ currency: 'USD', balance: 75, converted: { value: 100, partial: false, reason: null } });
    expect(json.accounts[0]).not.toHaveProperty('PK');
    expect(json.accounts[1].institution).toBeNull();
  });

  it('does not fetch FX when everything is in the base currency', async () => {
    await create(dbs);
    await call(ev('GET', '/v1/accounts'));
    expect(getOrFetchRates).not.toHaveBeenCalled();
  });

  it('marks foreign amounts partial and the total partial (sum of what converted) when FX fails', async () => {
    await create(dbs);
    await create({ name: 'US', type: 'cash', currency: 'USD', balance: 75 });
    vi.mocked(getOrFetchRates).mockRejectedValue(new Error('down'));
    const { json } = await call(ev('GET', '/v1/accounts'));
    const us = json.accounts.find((a: Item) => a.currency === 'USD');
    expect(us.converted).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(json.accounts.find((a: Item) => a.currency === 'SGD').converted.partial).toBe(false);
    expect(json.total).toEqual({ value: 1000, partial: true, reason: null });
  });

  it('treats a currency with no rate as unavailable', async () => {
    await create({ name: 'Yen', type: 'cash', currency: 'JPY', balance: 5 });
    const { json } = await call(ev('GET', '/v1/accounts'));
    expect(json.accounts[0].converted).toEqual({ value: null, partial: true, reason: 'fx_unavailable' });
    expect(json.total).toEqual({ value: 0, partial: true, reason: null });
  });

  it('only lists the caller\'s accounts and hides deleted ones', async () => {
    const mine = (await create(dbs)).json.account;
    await create({ ...dbs, name: 'Other' }, 'tok2');
    expect((await call(ev('GET', '/v1/accounts'))).json.accounts).toHaveLength(1);
    await call(ev('DELETE', `/v1/accounts/${mine.id}`));
    expect((await call(ev('GET', '/v1/accounts'))).json.accounts).toEqual([]);
  });
});

describe('POST /v1/accounts', () => {
  it('creates an account, a snapshot and returns the account (base currency, no FX)', async () => {
    const { status, json } = await create({ ...dbs, name: '  DBS  ', institution: ' Bank ' });
    expect(status).toBe(201);
    expect(json.account).toMatchObject({ name: 'DBS', institution: 'Bank', notes: null, balance: 1000, converted: { value: 1000, partial: false, reason: null }, updatedAt: '2026-06-29T00:00:00.000Z' });
    expect(db.items.size).toBe(1);
    expect(db.snaps).toHaveLength(1);
    expect(db.snaps[0]).toMatchObject({ PK: `ACCT_SNAP#${json.account.id}`, balance: 1000, accountId: json.account.id });
  });

  it('converts a foreign-currency account', async () => {
    const { json } = await create({ name: 'US', type: 'cash', currency: 'USD', balance: '75' });
    expect(json.account.converted.value).toBe(100);
  });

  it('accepts a base64 body', async () => {
    const res = await call(ev('POST', '/v1/accounts', { body: dbs, b64: true }));
    expect(res.status).toBe(201);
  });

  it.each([
    ['bad currency code', { ...dbs, currency: 'XXX' }, 'invalid_currency'],
    ['lowercase currency', { ...dbs, currency: 'sgd' }, 'invalid_currency'],
    ['non-string currency', { ...dbs, currency: 5 }, 'invalid_currency'],
    ['unknown type', { ...dbs, type: 'crypto' }, 'invalid_type'],
    ['empty name', { ...dbs, name: '   ' }, 'invalid_name'],
    ['non-string name', { ...dbs, name: 7 }, 'invalid_name'],
    ['negative balance', { ...dbs, balance: -1 }, 'invalid_balance'],
    ['non-numeric balance', { ...dbs, balance: 'abc' }, 'invalid_balance'],
    ['missing balance', { name: 'x', type: 'cash', currency: 'SGD' }, 'invalid_balance'],
    ['boolean balance', { ...dbs, balance: true }, 'invalid_balance'],
  ])('rejects %s with 400', async (_n, body, error) => {
    const { status, json } = await create(body);
    expect(status).toBe(400);
    expect(json).toEqual({ error });
    expect(db.items.size).toBe(0);
    expect(db.snaps).toHaveLength(0);
  });

  it('truncates an over-long name, institution and notes exactly as the web does', async () => {
    const { json } = await create({ ...dbs, name: 'n'.repeat(150), institution: 'i'.repeat(150), notes: 'x'.repeat(600) });
    expect(json.account.name).toHaveLength(100);
    expect(json.account.institution).toHaveLength(100);
    expect(json.account.notes).toHaveLength(500);
  });

  it.each([
    ['not JSON', { raw: '{nope' }],
    ['a JSON array', { raw: '[]' }],
    ['JSON null', { raw: 'null' }],
    ['an empty body', {}],
  ])('rejects %s with 400 invalid_json', async (_n, opts) => {
    const { status, json } = await call(ev('POST', '/v1/accounts', opts));
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'invalid_json' });
  });
});

describe('PATCH /v1/accounts/{id}', () => {
  it('edits details, keeps the balance and writes no snapshot', async () => {
    const id = (await create({ ...dbs, institution: 'DBS', notes: 'n' })).json.account.id;
    vi.mocked(clock.nowIso).mockReturnValue('2026-07-01T00:00:00.000Z');
    const { status, json } = await call(ev('PATCH', `/v1/accounts/${id}`, { body: { name: 'Renamed', type: 'checking', institution: '', notes: ' hi ' } }));
    expect(status).toBe(200);
    expect(json.account).toMatchObject({ id, name: 'Renamed', type: 'checking', institution: null, notes: 'hi', balance: 1000, currency: 'SGD', updatedAt: '2026-07-01T00:00:00.000Z' });
    expect(db.snaps).toHaveLength(1); // only the one from create
    expect(db.items.get(key('ACCOUNT#sub1', `ACCOUNT#${id}`))).toMatchObject({ name: 'Renamed', institution: null, notes: 'hi', balance: 1000 });
  });

  it('keeps fields that are absent', async () => {
    const id = (await create({ ...dbs, institution: 'DBS', notes: 'n' })).json.account.id;
    const { json } = await call(ev('PATCH', `/v1/accounts/${id}`, { body: { name: 'Only name' } }));
    expect(json.account).toMatchObject({ name: 'Only name', type: 'savings', institution: 'DBS', notes: 'n' });
  });

  it.each([
    ['invalid name', { name: ' ' }, 'invalid_name'],
    ['invalid type', { type: 'x' }, 'invalid_type'],
    ['balance field', { name: 'a', balance: 5 }, 'invalid_field'],
    ['currency field', { currency: 'USD' }, 'invalid_field'],
    ['nothing to change', { colour: 'red' }, 'no_changes'],
  ])('rejects %s with 400', async (_n, body, error) => {
    const id = (await create(dbs)).json.account.id;
    const { status, json } = await call(ev('PATCH', `/v1/accounts/${id}`, { body }));
    expect(status).toBe(400);
    expect(json).toEqual({ error });
  });

  it('rejects an unparseable body', async () => {
    const id = (await create(dbs)).json.account.id;
    expect((await call(ev('PATCH', `/v1/accounts/${id}`, { raw: 'x' }))).json).toEqual({ error: 'invalid_json' });
  });

  it('404s for an unknown id', async () => {
    const { status, json } = await call(ev('PATCH', '/v1/accounts/nope', { body: { name: 'a' } }));
    expect(status).toBe(404);
    expect(json).toEqual({ error: 'not_found' });
  });
});

describe('POST /v1/accounts/{id}/balance', () => {
  it('stores the new balance, writes a snapshot and returns the previous balance and date', async () => {
    const id = (await create(dbs)).json.account.id;
    vi.mocked(clock.nowIso).mockReturnValue('2026-07-01T00:00:00.000Z');
    const { status, json } = await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance: '1250.5' } }));
    expect(status).toBe(200);
    expect(json.account).toMatchObject({ id, balance: 1250.5, updatedAt: '2026-07-01T00:00:00.000Z', name: 'DBS' });
    expect(json.previous).toEqual({ balance: 1000, updatedAt: '2026-06-29T00:00:00.000Z' });
    expect(db.snaps).toHaveLength(2);
    expect(db.snaps[1]).toMatchObject({ PK: `ACCT_SNAP#${id}`, balance: 1250.5, recordedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('accepts zero and rejects negative, non-numeric and missing balances', async () => {
    const id = (await create(dbs)).json.account.id;
    expect((await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance: 0 } }))).status).toBe(200);
    for (const balance of [-5, 'abc', null, undefined]) {
      const r = await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance } }));
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: 'invalid_balance' });
    }
    expect((await call(ev('POST', `/v1/accounts/${id}/balance`, { raw: '' }))).json).toEqual({ error: 'invalid_json' });
    expect(db.snaps).toHaveLength(2);
  });

  it('404s for an unknown id', async () => {
    expect((await call(ev('POST', '/v1/accounts/nope/balance', { body: { balance: 1 } }))).status).toBe(404);
  });
});

describe('DELETE /v1/accounts/{id}', () => {
  it('soft-deletes (deletedAt, deletedBy) and never removes the record', async () => {
    const id = (await create(dbs)).json.account.id;
    const { status, json } = await call(ev('DELETE', `/v1/accounts/${id}`));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(db.items.get(key('ACCOUNT#sub1', `ACCOUNT#${id}`))).toMatchObject({ deletedAt: '2026-06-29T00:00:00.000Z', deletedBy: 'sub1' });
  });

  it('404s for an unknown id', async () => {
    expect((await call(ev('DELETE', '/v1/accounts/nope'))).status).toBe(404);
  });

  it('answers 404 for an already-deleted account and does not write again', async () => {
    const { softDelete } = await import('../../../src/repositories/account');
    const id = (await create(dbs)).json.account.id;
    await call(ev('DELETE', `/v1/accounts/${id}`));
    vi.mocked(softDelete).mockClear();
    expect((await call(ev('DELETE', `/v1/accounts/${id}`))).status).toBe(404);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('a deleted account cannot be patched or have its balance updated', async () => {
    const id = (await create(dbs)).json.account.id;
    await call(ev('DELETE', `/v1/accounts/${id}`));
    expect((await call(ev('PATCH', `/v1/accounts/${id}`, { body: { name: 'x' } }))).status).toBe(404);
    expect((await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance: 5 } }))).status).toBe(404);
    expect(db.snaps).toHaveLength(1);
  });
});

describe('ownership (two users)', () => {
  it("answers 404 for another user's account on PATCH, balance and DELETE, and changes nothing", async () => {
    const id = (await create(dbs)).json.account.id; // owned by sub1
    const before = JSON.stringify([...db.items.entries()]);
    const snaps = db.snaps.length;

    for (const r of [
      await call(ev('PATCH', `/v1/accounts/${id}`, { body: { name: 'hacked' }, auth: 'tok2' })),
      await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance: 1 }, auth: 'tok2' })),
      await call(ev('DELETE', `/v1/accounts/${id}`, { auth: 'tok2' })),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' }); // same as a non-existent id
    }
    expect(JSON.stringify([...db.items.entries()])).toBe(before);
    expect(db.snaps).toHaveLength(snaps);
    // and the owner still has it, untouched
    expect((await call(ev('GET', '/v1/accounts'))).json.accounts[0]).toMatchObject({ id, name: 'DBS', balance: 1000 });
    // user 2 sees none of user 1's accounts
    expect((await call(ev('GET', '/v1/accounts', { auth: 'tok2' }))).json.accounts).toEqual([]);
  });
});

describe('round trip', () => {
  it('create, patch, balance update, delete', async () => {
    const created = (await create({ ...dbs, balance: 100 })).json.account;
    await call(ev('PATCH', `/v1/accounts/${created.id}`, { body: { name: 'Savings 2' } }));
    const bal = await call(ev('POST', `/v1/accounts/${created.id}/balance`, { body: { balance: 250 } }));
    expect(bal.json.account).toMatchObject({ name: 'Savings 2', balance: 250 });
    expect((await call(ev('GET', '/v1/accounts'))).json.total.value).toBe(250);
    await call(ev('DELETE', `/v1/accounts/${created.id}`));
    expect((await call(ev('GET', '/v1/accounts'))).json.accounts).toEqual([]);
  });
});

describe('routing and errors', () => {
  it.each([
    ['PUT', '/v1/accounts'],
    ['GET', '/v1/accounts/abc'],
    ['PUT', '/v1/accounts/abc/balance'],
    ['POST', '/v1/accounts/abc/other'],
    ['POST', '/v1/accounts/abc/balance/extra'],
    ['PATCH', '/v1/accounts/abc/extra/more'],
  ])('%s %s is a 404 JSON error', async (m, p) => {
    const r = await call(ev(m, p, { body: {} }));
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
  });

  it('turns an unexpected failure into a 500 without a stack trace', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSettings).mockRejectedValue(new Error('ddb exploded at /secret/path'));
    const r = await call(ev('GET', '/v1/accounts'));
    expect(r.status).toBe(500);
    expect(r.raw.body).toBe('{"error":"internal_error"}');
    vi.mocked(getSettings).mockRejectedValue('weird');
    expect((await call(ev('GET', '/v1/accounts'))).status).toBe(500);
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
  };
  // ids are random: replace each with a placeholder so records compare structurally
  const normalised = (ids: string[]) => {
    let s = JSON.stringify({ items: [...db.items.values()], snaps: db.snaps });
    ids.forEach((id, i) => { s = s.split(id).join(`<id${i}>`); });
    return s.replace(/<id\d>/g, '<id>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>');
  };
  const idsOf = () => [...db.items.values()].map((a) => a.id as string);

  it('create + balance update + snapshots match the web form byte for byte', async () => {
    const input = { name: ' DBS ', type: 'savings', currency: 'SGD', balance: '1000.5', institution: 'Bank', notes: 'joint' };
    await webPost('/cash-bank', input);
    const webIds = idsOf();
    await webPost(`/cash-bank/${webIds[0]}`, { name: 'DBS 2', type: 'checking', balance: '2000', institution: 'Bank', notes: 'joint' });
    const web = normalised(webIds);

    db.items.clear(); db.snaps.length = 0;
    const id = (await create({ ...input, balance: 1000.5 })).json.account.id;
    // PATCH + balance reproduces the web edit (details and balance, one snapshot per balance change)
    await call(ev('PATCH', `/v1/accounts/${id}`, { body: { name: 'DBS 2', type: 'checking' } }));
    await call(ev('POST', `/v1/accounts/${id}/balance`, { body: { balance: 2000 } }));
    const api = normalised([id]);

    // The API writes the same account record and the same snapshots as the web
    expect(JSON.parse(api).items).toEqual(JSON.parse(web).items);
    expect(JSON.parse(api).snaps).toEqual(JSON.parse(web).snaps);
  });

  it('web and API reject the same invalid input', async () => {
    const bad = { name: 'x', type: 'savings', currency: 'SGD', balance: '-3' };
    await webPost('/cash-bank', bad);
    expect(db.items.size).toBe(0);
    expect((await create(bad)).status).toBe(400);
  });
});
