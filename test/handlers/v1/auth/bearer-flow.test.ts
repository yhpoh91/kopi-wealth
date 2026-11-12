// End to end over the real repositories and middleware (DynamoDB mocked in memory):
// a token from POST /v1/auth/token calls an authenticated route, and stops working after
// POST /v1/auth/logout while a web cookie session for the same user keeps working.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('../../../../src/lib/auth', async (orig) => ({
  ...(await orig<typeof import('../../../../src/lib/auth')>()),
  exchangeCode: vi.fn(async () => ({ id_token: 'id', access_token: 'at', refresh_token: 'rt' })),
  verifyIdToken: vi.fn(async () => ({ sub: 'sub1', email: 'u@example.com', name: 'U' })),
  revokeRefreshToken: vi.fn(async () => true),
}));
vi.mock('../../../../src/lib/secrets', () => ({ getSecret: vi.fn(async () => 'client-secret') }));
vi.mock('../../../../src/lib/fx', () => ({ getOrFetchHistoricalRate: vi.fn(async () => 1.35) }));

import { handler as token } from '../../../../src/handlers/v1/auth/token';
import { handler as logout } from '../../../../src/handlers/v1/auth/logout';
import { handler as fxRate } from '../../../../src/handlers/fxRate';
import { revokeRefreshToken } from '../../../../src/lib/auth';

const ddbMock = mockClient(DynamoDBDocumentClient);
const store = new Map<string, Record<string, unknown>>();
const key = (k: Record<string, unknown>) => `${k.PK}|${k.SK}`;

type Res = { statusCode: number; body: string };

function fxEvent(headers: Record<string, string>, cookies?: string[]) {
  return {
    requestContext: { http: { method: 'GET' } },
    rawPath: '/fx-rate',
    rawQueryString: 'from=USD&to=SGD&date=2026-07-03',
    headers,
    cookies,
  } as never;
}

beforeEach(() => {
  store.clear();
  ddbMock.reset();
  ddbMock.on(GetCommand).callsFake((input) => ({ Item: structuredClone(store.get(key(input.Key))) }));
  ddbMock.on(PutCommand).callsFake((input) => { store.set(key(input.Item), input.Item); return {}; });
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(UpdateCommand).callsFake((input) => {
    const item = store.get(key(input.Key));
    if (item && String(input.UpdateExpression).includes('deletedAt')) {
      item.deletedAt = input.ExpressionAttributeValues[':da'];
      delete item.refreshToken;
    }
    return {};
  });
});

describe('mobile Bearer flow', () => {
  it('a Bearer token from /v1/auth/token calls an authenticated route until logout', async () => {
    const tokenRes = await token(
      { body: JSON.stringify({ code: 'c', codeVerifier: 'v', redirectUri: 'kopiwealth://callback' }), headers: {} } as never,
      {} as never, () => {},
    ) as Res;
    expect(tokenRes.statusCode).toBe(200);
    const { token: bearer } = JSON.parse(tokenRes.body);
    expect(store.get(`SESSION#${bearer}|SESSION#${bearer}`)).toMatchObject({ platform: 'mobile', refreshToken: 'rt', sub: 'sub1' });

    // A web cookie session for the same user, created the way /auth/callback does.
    store.set('SESSION#web|SESSION#web', { PK: 'SESSION#web', SK: 'SESSION#web', sessionId: 'web', sub: 'sub1', createdAt: 'x', ttl: 9999999999 });

    const ok = await fxRate(fxEvent({ authorization: `Bearer ${bearer}` }), {} as never, () => {}) as Res;
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).rate).toBe(1.35);

    expect(await logout({ headers: { authorization: `Bearer ${bearer}` } } as never, {} as never, () => {})).toMatchObject({ statusCode: 200 });
    expect(revokeRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rt' }));

    const after = await fxRate(fxEvent({ authorization: `Bearer ${bearer}` }), {} as never, () => {}) as Res;
    expect(after.statusCode).toBe(401);

    const web = await fxRate(fxEvent({}, ['sid=web']), {} as never, () => {}) as Res;
    expect(web.statusCode).toBe(200);
  });
});
