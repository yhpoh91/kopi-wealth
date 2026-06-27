import { createRemoteJWKSet, jwtVerify } from 'jose';
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
