import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { exchangeCode, verifyIdToken } from '../../lib/auth';
import { parseCookies, setCookieHeader, clearCookieHeader } from '../../lib/session';
import { getUser, putUser } from '../../repositories/user';
import { putSession } from '../../repositories/session';
import { getSecret } from '../../lib/secrets';
import { config, secretName } from '../../config';
import { clock } from '../../lib/clock';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const cookies = parseCookies(event.cookies?.join('; ') ?? event.headers?.cookie);
  const { code, state } = event.queryStringParameters ?? {};

  if (!code || !state) {
    return { statusCode: 400, body: 'Missing code or state' };
  }

  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return { statusCode: 400, body: 'Invalid state' };
  }

  const verifier = cookies.pkce_verifier;
  if (!verifier) {
    return { statusCode: 400, body: 'Missing PKCE verifier' };
  }

  const isSecure = config.stage === 'prod';
  const redirectUri = `${config.appUrl}/auth/callback`;

  let idToken: string;
  try {
    const clientSecret = await getSecret(secretName('sso-client-secret'));
    const tokens = await exchangeCode({
      issuer: config.ssoIssuer,
      clientId: config.ssoClientId,
      clientSecret,
      redirectUri,
      code,
      verifier,
    });
    idToken = tokens.id_token;
  } catch {
    return { statusCode: 400, body: 'Token exchange failed' };
  }

  let claims: { sub: string; email: string; name?: string };
  try {
    claims = await verifyIdToken(idToken);
  } catch {
    return { statusCode: 400, body: 'Invalid ID token' };
  }

  const now = clock.nowIso();

  let user = await getUser(claims.sub);
  if (!user) {
    user = {
      PK: `USER#${claims.sub}`,
      SK: `USER#${claims.sub}`,
      GSI1PK: 'ALL_USERS',
      GSI1SK: `USER#${claims.sub}`,
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  } else {
    user = { ...user, lastSeenAt: now, updatedAt: now };
    if (claims.email !== user.email) user = { ...user, email: claims.email };
    if (claims.name !== undefined) user = { ...user, name: claims.name };
  }
  await putUser(user);

  const sessionId = randomUUID();
  const ttl = Math.floor(clock.nowMs() / 1000) + 86400;
  await putSession({
    PK: `SESSION#${sessionId}`,
    SK: `SESSION#${sessionId}`,
    sessionId,
    sub: claims.sub,
    createdAt: now,
    ttl,
  });

  const returnTo = cookies.return_to ?? '/';

  return {
    statusCode: 302,
    headers: { Location: returnTo },
    cookies: [
      setCookieHeader('sid', sessionId, 86400, isSecure),
      clearCookieHeader('pkce_verifier'),
      clearCookieHeader('oauth_state'),
      clearCookieHeader('return_to'),
    ],
    body: '',
  };
};
