import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { buildOverview } from '../../lib/finance/overview';
import type { Overview, GroupTotal } from '../../lib/finance/overview';
import { metric } from '../../lib/finance/metric';
import { json } from '../../lib/json';
import { getSettings } from '../../repositories/financialSettings';
import { toOverviewResponse } from './overview';

// dueCount stays 0 until the due rule (#26).
const DUE_COUNT = 0;

export function toAssetsResponse(o: Overview) {
  const { have, available } = toOverviewResponse(o);
  const group = (g: GroupTotal) => {
    const total = metric(g.has && !g.partial ? g.total : null, g.has, g.partial);
    // share = percent of total assets, one decimal; null when either figure is unknown.
    const share = total.value !== null && have.value !== null && have.value > 0
      ? Math.round((total.value / have.value) * 1000) / 10
      : null;
    return { total, share, dueCount: DUE_COUNT };
  };
  return {
    currency: o.currency,
    asOf: o.asOf,
    have,
    groups: {
      cashBank: group(o.groups.cashBank),
      investments: group(o.groups.investments),
      cpf: group(o.groups.cpf),
      owedToYou: group(o.groups.receivables),
    },
    available,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;
  const { sub } = auth.session;

  try {
    const overview = await buildOverview(sub, await getSettings(sub));
    return json(200, toAssetsResponse(overview));
  } catch (err) {
    console.error('assets failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'internal_error' });
  }
};
