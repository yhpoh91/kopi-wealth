import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/auth', () => ({
  generatePkce: () => ({ verifier: 'test-verifier', challenge: 'test-challenge' }),
  generateState: () => 'test-state',
  buildAuthorizeUrl: (p: Record<string, string>) =>
    `https://sso.example.com/oauth2/authorize?client_id=${p.clientId}&state=${p.state}&code_challenge=${p.challenge}`,
}));

vi.mock('../../../src/config', () => ({
  config: {
    stage: 'preview',
    appUrl: 'https://wealth-preview.kopi.life',
    ssoIssuer: 'https://sso.example.com',
    ssoClientId: 'wealth-preview',
  },
}));

import { handler } from '../../../src/handlers/auth/login';

beforeEach(() => vi.clearAllMocks());

describe('GET /auth/login', () => {
  it('redirects to SSO authorize URL', async () => {
    const res = await handler({ queryStringParameters: {} } as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302 });
    const location = (res as { headers: Record<string, string> }).headers.Location;
    expect(location).toContain('sso.example.com/oauth2/authorize');
    expect(location).toContain('test-challenge');
  });

  it('sets pkce_verifier, oauth_state, return_to cookies', async () => {
    const res = await handler({ queryStringParameters: {} } as never, {} as never, () => {});
    const cookies = (res as { multiValueHeaders: Record<string, string[]> }).multiValueHeaders['Set-Cookie'];
    expect(cookies.some((c: string) => c.startsWith('pkce_verifier='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('oauth_state='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('return_to='))).toBe(true);
  });

  it('uses return_to query param', async () => {
    const res = await handler(
      { queryStringParameters: { return_to: '/dashboard' } } as never,
      {} as never,
      () => {},
    );
    const cookies = (res as { multiValueHeaders: Record<string, string[]> }).multiValueHeaders['Set-Cookie'];
    const returnToCookie = cookies.find((c: string) => c.startsWith('return_to='));
    expect(returnToCookie).toContain('%2Fdashboard');
  });

  it('defaults return_to to /', async () => {
    const res = await handler({ queryStringParameters: undefined } as never, {} as never, () => {});
    const cookies = (res as { multiValueHeaders: Record<string, string[]> }).multiValueHeaders['Set-Cookie'];
    const returnToCookie = cookies.find((c: string) => c.startsWith('return_to='));
    expect(returnToCookie).toContain('%2F');
  });
});
