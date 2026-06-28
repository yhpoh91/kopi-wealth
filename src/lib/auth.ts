import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import { config } from '../config';

const jwksCaches = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string) {
  if (!jwksCaches.has(issuer)) {
    jwksCaches.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  }
  return jwksCaches.get(issuer)!;
}

export async function verifyIdToken(token: string): Promise<{ sub: string; email: string; name?: string }> {
  const jwks = getJwks(config.ssoIssuer);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.ssoIssuer,
    audience: config.ssoClientId,
  });
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    name: payload.name as string | undefined,
  };
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(`${params.issuer}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<{ id_token: string; access_token: string }> {
  const res = await fetch(`${params.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
      code_verifier: params.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return res.json() as Promise<{ id_token: string; access_token: string }>;
}
