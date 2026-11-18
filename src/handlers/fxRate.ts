import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../lib/auth-middleware';
import { lookupFxRate } from '../lib/fx-rate';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const result = await lookupFxRate(qs.get('from') ?? '', qs.get('to') ?? '', qs.get('date') ?? '');
  if (result.status !== 200) return { statusCode: result.status, body: JSON.stringify(result.body) };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
};
