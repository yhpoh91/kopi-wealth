import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { ALLOWED_APP_REDIRECT_URIS, exchangeCode, verifyIdToken } from '../../../lib/auth';
import { MOBILE_SESSION_TTL_SECONDS } from '../../../lib/auth-middleware';
import { provisionUser } from '../../../lib/provision-user';
import { putSession } from '../../../repositories/session';
import { getSecret } from '../../../lib/secrets';
import { json } from '../../../lib/json';
import { clock } from '../../../lib/clock';
import { config, secretName } from '../../../config';

function parseBody(body: string | undefined, isBase64Encoded: boolean): Record<string, unknown> {
  try {
    const raw = body ?? '';
    const text = isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    const parsed: unknown = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

// POST /v1/auth/token — exchanges the mobile app's authorization code with kopi-sso (client secret
// from Secrets Manager), provisions the user exactly as the web callback does, and returns an opaque
// Bearer token for a 60-day mobile session that renews while in use.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = parseBody(event.body, event.isBase64Encoded);
  const code = str(body.code);
  const codeVerifier = str(body.codeVerifier);
  const redirectUri = str(body.redirectUri);

  if (!code || !codeVerifier || !redirectUri) {
    return json(400, { error: 'code, codeVerifier and redirectUri are required' });
  }
  if (!ALLOWED_APP_REDIRECT_URIS.has(redirectUri)) {
    return json(400, { error: 'redirectUri is not allowed' });
  }

  let tokens: { id_token: string; refresh_token?: string };
  try {
    const clientSecret = await getSecret(secretName('sso-client-secret'));
    tokens = await exchangeCode({
      issuer: config.ssoIssuer,
      clientId: config.ssoClientId,
      clientSecret,
      redirectUri,
      code,
      verifier: codeVerifier,
    });
  } catch {
    return json(502, { error: 'Token exchange failed' });
  }

  let claims: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    claims = await verifyIdToken(tokens.id_token);
  } catch {
    return json(401, { error: 'Invalid ID token' });
  }

  const now = clock.nowIso();
  const user = await provisionUser(claims, now);

  const token = randomBytes(32).toString('base64url');
  const ttl = Math.floor(clock.nowMs() / 1000) + MOBILE_SESSION_TTL_SECONDS;
  await putSession({
    PK: `SESSION#${token}`,
    SK: `SESSION#${token}`,
    sessionId: token,
    sub: claims.sub,
    createdAt: now,
    ttl,
    platform: 'mobile',
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
  });

  return json(200, {
    token,
    expiresAt: new Date(ttl * 1000).toISOString(),
    user: { sub: user.sub, email: user.email, name: user.name, picture: user.picture, role: user.role },
  });
};
