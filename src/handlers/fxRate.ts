import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { getOrFetchHistoricalRate } from '../lib/fx';

const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const from = (qs.get('from') ?? '').toUpperCase();
  const to = (qs.get('to') ?? '').toUpperCase();
  const date = qs.get('date') ?? '';

  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || !DATE_RE.test(date)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid parameters' }) };
  }

  try {
    const rate = await getOrFetchHistoricalRate(from, to, date);
    if (rate === null) return { statusCode: 404, body: JSON.stringify({ error: 'Rate not available' }) };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, date, rate }),
    };
  } catch {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to fetch rate' }) };
  }
};
