import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { json } from '../../lib/json';
import { clock } from '../../lib/clock';
import { getOrFetchRates } from '../../lib/fx';
import type { Metric } from '../../lib/finance/metric';
import { sumConverted, convertedMetric } from '../../lib/finance/convert';
import { groupMetric } from '../../lib/finance/overview';
import { daysSince, isDue } from '../../lib/finance/due';
import {
  parseNewInvestment, parseName, parseInvestmentType, parseInstitution, parseNotes, parseValue,
  createInvestment, saveInvestmentWithSnapshot,
} from '../../lib/investments';
import { getSettings } from '../../repositories/financialSettings';
import { getInvestment, queryByUser, updateInvestment, softDelete, querySnapshots } from '../../repositories/investment';
import { INVESTMENT_TYPES, INVESTMENT_TYPE_LABELS } from '../../types/investment';
import type { Investment } from '../../types/investment';
import type { FinancialSettings } from '../../types/financialSettings';

interface Ctx {
  base: string;
  timeZone: string;
  rates: Record<string, number>;
  failed: boolean;
}

async function loadCtx(settings: FinancialSettings | null, investments: Investment[]): Promise<Ctx> {
  const base = settings?.currency ?? 'SGD';
  let rates: Record<string, number> = {};
  let failed = false;
  if (investments.some((i) => i.currency !== base)) {
    try { ({ rates } = await getOrFetchRates(base)); } catch { failed = true; }
  }
  // Same zone default as buildOverview, so due agrees with /v1/overview and /v1/assets.
  return { base, timeZone: settings?.timezone ?? 'Asia/Singapore', rates, failed };
}

// The change between the current value and the value before the latest update, in the holding's
// own currency. percent is null when the earlier value was 0. `since` is when that earlier value
// was recorded.
export interface Change {
  amount: number;
  percent: number | null;
  since: string;
}

function toChange(current: number, previous: { value: number; recordedAt: string } | undefined): Change | null {
  if (!previous) return null;
  const amount = current - previous.value;
  return {
    amount,
    percent: previous.value === 0 ? null : Math.round((amount / previous.value) * 1000) / 10,
    since: previous.recordedAt,
  };
}

function toHolding(i: Investment, ctx: Ctx, changeSinceLast: Change | null) {
  const days = daysSince(i.updatedAt, clock.nowMs(), ctx.timeZone);
  return {
    id: i.id,
    name: i.name,
    type: i.type,
    institution: i.institution ?? null,
    notes: i.notes ?? null,
    currency: i.currency,
    value: i.value,
    converted: convertedMetric(i.value, i.currency, ctx.base, ctx.rates, ctx.failed),
    updatedAt: i.updatedAt,
    changeSinceLast,
    due: isDue(days),
    daysSince: days,
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

// Total and per-type totals follow the /v1/assets Investments group (groupMetric): null + partial
// when any amount cannot be converted. share = percent of the Investments total, one decimal,
// null when either figure is unknown.
function groupOf(items: Investment[], ctx: Ctx): { total: Metric; has: boolean } {
  const sum = sumConverted(items.map((i) => ({ amount: i.value, currency: i.currency })), ctx.base, ctx.rates, ctx.failed);
  const has = items.length > 0;
  return { total: groupMetric({ total: sum.total, has, partial: sum.partial }), has };
}

async function list(sub: string): Promise<APIGatewayProxyStructuredResultV2> {
  const [investments, settings] = await Promise.all([queryByUser(sub), getSettings(sub)]);
  investments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ctx = await loadCtx(settings, investments);

  // One small Query per holding (INVEST_SNAP#{id}, newest first, limit 2), in parallel.
  const snaps = await Promise.all(investments.map((i) => querySnapshots(i.id, 2)));
  const holdings = new Map(investments.map((i, n) => [i.id, toHolding(i, ctx, toChange(i.value, snaps[n][1]))]));

  const all = groupOf(investments, ctx);
  const groups = INVESTMENT_TYPES
    .filter((t) => investments.some((i) => i.type === t))
    .map((t) => {
      const items = investments.filter((i) => i.type === t);
      const { total } = groupOf(items, ctx);
      const share = total.value !== null && all.total.value !== null && all.total.value > 0
        ? Math.round((total.value / all.total.value) * 1000) / 10
        : null;
      return { type: t, label: INVESTMENT_TYPE_LABELS[t], total, share, holdings: items.map((i) => holdings.get(i.id)!) };
    });

  return json(200, { currency: ctx.base, total: all.total, groups });
}

async function respond(status: number, sub: string, i: Investment, change: Change | null, extra: object = {}) {
  const ctx = await loadCtx(await getSettings(sub), [i]);
  return json(status, { investment: toHolding(i, ctx, change), ...extra });
}

async function create(sub: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  const input = parseNewInvestment(body);
  if (!input.ok) return badRequest(input.error);
  const investment = await createInvestment(sub, input.value, clock.nowIso());
  return respond(201, sub, investment, null);
}

// Details only: name, type, institution, notes. Absent fields are kept; an empty institution or
// notes clears it. Currency and value are not editable here (value has its own route).
async function patch(sub: string, id: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  if ('currency' in body || 'value' in body) return badRequest('invalid_field');
  if (!['name', 'type', 'institution', 'notes'].some((k) => k in body)) return badRequest('no_changes');
  const name = 'name' in body ? parseName(body.name) : undefined;
  if (name === null) return badRequest('invalid_name');
  const type = 'type' in body ? parseInvestmentType(body.type) : undefined;
  if (type === null) return badRequest('invalid_type');

  const existing = await getInvestment(sub, id);
  if (!existing || existing.deletedAt) return notFound();

  const updated: Investment = {
    ...existing,
    name: name ?? existing.name,
    type: type ?? existing.type,
    institution: 'institution' in body ? parseInstitution(body.institution) : existing.institution,
    notes: 'notes' in body ? parseNotes(body.notes) : existing.notes,
    updatedAt: clock.nowIso(),
  };
  await updateInvestment(sub, id, updated, updated.updatedAt);
  const [, before] = await querySnapshots(id, 2);
  return respond(200, sub, updated, toChange(updated.value, before));
}

async function setValue(sub: string, id: string, event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body) return badRequest('invalid_json');
  const value = parseValue(body.value);
  if (value === null) return badRequest('invalid_value');

  const existing = await getInvestment(sub, id);
  if (!existing || existing.deletedAt) return notFound();

  // The snapshot being replaced, read before the write (a Query straight after it could miss it).
  const [last] = await querySnapshots(id, 1);
  const now = clock.nowIso();
  await saveInvestmentWithSnapshot(sub, id, {
    name: existing.name, type: existing.type, institution: existing.institution, notes: existing.notes, value,
  }, now);
  const updated: Investment = { ...existing, value, updatedAt: now };
  return respond(200, sub, updated, toChange(value, last), {
    previous: { value: existing.value, updatedAt: existing.updatedAt },
  });
}

async function remove(sub: string, id: string) {
  const existing = await getInvestment(sub, id);
  if (!existing || existing.deletedAt) return notFound();
  await softDelete(sub, id, sub, clock.nowIso());
  return json(200, { ok: true });
}

// /v1/investments · /v1/investments/{id} · /v1/investments/{id}/value
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;
  const { sub } = auth.session;

  const method = event.requestContext.http.method;
  const [, , id, action, extra] = event.rawPath.split('/').filter(Boolean); // ['v1', 'investments', id, action]

  try {
    if (!id) {
      if (method === 'GET') return await list(sub);
      if (method === 'POST') return await create(sub, event);
    } else if (!action && !extra) {
      if (method === 'PATCH') return await patch(sub, id, event);
      if (method === 'DELETE') return await remove(sub, id);
    } else if (action === 'value' && !extra && method === 'POST') {
      return await setValue(sub, id, event);
    }
    return notFound();
  } catch (err) {
    console.error('investments failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'internal_error' });
  }
};
