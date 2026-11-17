import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { json } from '../../lib/json';
import { clock } from '../../lib/clock';
import { getOrFetchRates, convertAmount } from '../../lib/fx';
import { metric } from '../../lib/finance/metric';
import type { Metric } from '../../lib/finance/metric';
import { sumConverted } from '../../lib/finance/convert';
import {
  parseNewAccount, parseName, parseType, parseInstitution, parseNotes, parseBalance, createAccount, saveAccountWithSnapshot,
} from '../../lib/accounts';
import { getSettings } from '../../repositories/financialSettings';
import { getAccount, queryByUser, updateAccount, softDelete } from '../../repositories/account';
import type { Account } from '../../types/account';

interface Fx {
  base: string;
  rates: Record<string, number>;
  failed: boolean;
}

async function loadFx(sub: string, accounts: Account[]): Promise<Fx> {
  const base = (await getSettings(sub))?.currency ?? 'SGD';
  let rates: Record<string, number> = {};
  let failed = false;
  if (accounts.some((a) => a.currency !== base)) {
    try { ({ rates } = await getOrFetchRates(base)); } catch { failed = true; }
  }
  return { base, rates, failed };
}

// converted: the base-currency amount. Equal to balance (no FX) in the base currency; otherwise
// null + partial + fx_unavailable when it cannot be converted.
function toAccountResponse(a: Account, fx: Fx) {
  let converted: Metric;
  if (a.currency === fx.base) {
    converted = metric(a.balance, true, false);
  } else {
    const c = fx.failed ? null : convertAmount(a.balance, a.currency, fx.base, fx.rates);
    converted = c === null ? metric(null, true, true) : metric(c, true, false);
  }
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution ?? null,
    notes: a.notes ?? null,
    currency: a.currency,
    balance: a.balance,
    converted,
    updatedAt: a.updatedAt,
  };
}

const badRequest = (error: string) => json(400, { error });
const notFound = () => json(404, { error: 'not_found' });

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function list(sub: string): Promise<APIGatewayProxyStructuredResultV2> {
  const accounts = (await queryByUser(sub)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const fx = await loadFx(sub, accounts);
  const sum = sumConverted(accounts.map((a) => ({ amount: a.balance, currency: a.currency })), fx.base, fx.rates, fx.failed);
  return json(200, {
    currency: fx.base,
    total: metric(accounts.length > 0 && !sum.partial ? sum.total : null, accounts.length > 0, sum.partial),
    accounts: accounts.map((a) => toAccountResponse(a, fx)),
  });
}

async function create(sub: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  const input = parseNewAccount(body);
  if (!input.ok) return badRequest(input.error);
  const account = await createAccount(sub, input.value, clock.nowIso());
  return json(201, { account: toAccountResponse(account, await loadFx(sub, [account])) });
}

// Details only: name, type, institution, notes. Absent fields are kept; an empty institution or
// notes clears it. Currency and balance are not editable here (balance has its own route).
async function patch(sub: string, id: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  if ('currency' in body || 'balance' in body) return badRequest('invalid_field');
  const keys = ['name', 'type', 'institution', 'notes'].filter((k) => k in body);
  if (keys.length === 0) return badRequest('no_changes');
  const name = 'name' in body ? parseName(body.name) : undefined;
  if (name === null) return badRequest('invalid_name');
  const type = 'type' in body ? parseType(body.type) : undefined;
  if (type === null) return badRequest('invalid_type');

  const existing = await getAccount(sub, id);
  if (!existing || existing.deletedAt) return notFound();

  const updated: Account = {
    ...existing,
    name: name ?? existing.name,
    type: type ?? existing.type,
    institution: 'institution' in body ? parseInstitution(body.institution) : existing.institution,
    notes: 'notes' in body ? parseNotes(body.notes) : existing.notes,
    updatedAt: clock.nowIso(),
  };
  await updateAccount(sub, id, updated, updated.updatedAt);
  return json(200, { account: toAccountResponse(updated, await loadFx(sub, [updated])) });
}

async function setBalance(sub: string, id: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  const balance = parseBalance(body.balance);
  if (balance === null) return badRequest('invalid_balance');

  const existing = await getAccount(sub, id);
  if (!existing || existing.deletedAt) return notFound();

  const now = clock.nowIso();
  await saveAccountWithSnapshot(sub, id, {
    name: existing.name, type: existing.type, institution: existing.institution, notes: existing.notes, balance,
  }, now);
  const updated: Account = { ...existing, balance, updatedAt: now };
  return json(200, {
    account: toAccountResponse(updated, await loadFx(sub, [updated])),
    previous: { balance: existing.balance, updatedAt: existing.updatedAt },
  });
}

async function remove(sub: string, id: string) {
  const existing = await getAccount(sub, id);
  if (!existing || existing.deletedAt) return notFound();
  await softDelete(sub, id, sub, clock.nowIso());
  return json(200, { ok: true });
}

// /v1/accounts · /v1/accounts/{id} · /v1/accounts/{id}/balance
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;
  const { sub } = auth.session;

  const method = event.requestContext.http.method;
  const [, , id, action, extra] = event.rawPath.split('/').filter(Boolean); // ['v1', 'accounts', id, action]

  try {
    if (!id) {
      if (method === 'GET') return await list(sub);
      if (method === 'POST') return await create(sub, event);
    } else if (!action && !extra) {
      if (method === 'PATCH') return await patch(sub, id, event);
      if (method === 'DELETE') return await remove(sub, id);
    } else if (action === 'balance' && !extra && method === 'POST') {
      return await setBalance(sub, id, event);
    }
    return notFound();
  } catch (err) {
    console.error('accounts failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'internal_error' });
  }
};
