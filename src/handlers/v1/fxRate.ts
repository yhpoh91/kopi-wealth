import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { lookupFxRate } from '../../lib/fx-rate';
import { clock } from '../../lib/clock';
import { json } from '../../lib/json';

// GET /v1/fx-rate?from=&to=[&date=YYYY-MM-DD] — date defaults to today.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;

  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const result = await lookupFxRate(qs.get('from') ?? '', qs.get('to') ?? '', qs.get('date') ?? clock.today());
  return json(result.status, result.body);
};
