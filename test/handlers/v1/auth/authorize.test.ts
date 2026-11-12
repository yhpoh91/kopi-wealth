import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/config', () => ({
  config: { ssoIssuer: 'https://sso.example.com', ssoClientId: 'wealth-preview' },
}));

import { handler } from '../../../../src/handlers/v1/auth/authorize';

type Res = { statusCode: number; headers?: Record<string, string>; body?: string };

const valid = { code_challenge: 'chal', state: 'st', redirect_uri: 'kopiwealth://callback' };

async function call(qs: Record<string, string> | undefined): Promise<Res> {
  return await handler({ queryStringParameters: qs, headers: {} } as never, {} as never, () => {}) as Res;
}

function location(res: Res): URL {
  return new URL(res.headers!.Location);
}

describe('GET /v1/auth/authorize', () => {
  it('302s to the kopi-sso authorize URL with PKCE S256', async () => {
    const res = await call(valid);
    expect(res.statusCode).toBe(302);
    const url = location(res);
    expect(`${url.origin}${url.pathname}`).toBe('https://sso.example.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'wealth-preview',
      redirect_uri: 'kopiwealth://callback',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
    });
  });

  it('accepts the preview redirect URI and an explicit S256 method', async () => {
    const res = await call({ ...valid, redirect_uri: 'kopiwealthpreview://callback', code_challenge_method: 'S256' });
    expect(res.statusCode).toBe(302);
    expect(location(res).searchParams.get('redirect_uri')).toBe('kopiwealthpreview://callback');
  });

  it.each(['login', 'select_account'])('forwards prompt=%s', async (prompt) => {
    const res = await call({ ...valid, prompt });
    expect(location(res).searchParams.get('prompt')).toBe(prompt);
  });

  it.each(['none', 'consent', ''])('drops prompt=%j', async (prompt) => {
    const res = await call({ ...valid, prompt });
    expect(res.statusCode).toBe(302);
    expect(location(res).searchParams.has('prompt')).toBe(false);
  });

  it('rejects the plain challenge method', async () => {
    const res = await call({ ...valid, code_challenge_method: 'plain' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ error: 'code_challenge_method must be S256' });
  });

  it.each([
    'https://evil.example.com/callback',
    'kopiwealth://callback/extra',
    'kopihealth://callback',
  ])('rejects redirect_uri %s', async (redirect_uri) => {
    const res = await call({ ...valid, redirect_uri });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ error: 'redirect_uri is not allowed' });
  });

  it.each(['code_challenge', 'state', 'redirect_uri'])('requires %s', async (key) => {
    const qs: Record<string, string> = { ...valid };
    delete qs[key];
    const res = await call(qs);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 with no query string at all', async () => {
    expect((await call(undefined)).statusCode).toBe(400);
  });
});
