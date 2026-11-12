import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getBearerToken } from '../../../lib/auth-middleware';
import { revokeRefreshToken } from '../../../lib/auth';
import { getSession, deleteSession } from '../../../repositories/session';
import { getSecret } from '../../../lib/secrets';
import { json } from '../../../lib/json';
import { config, secretName } from '../../../config';

// POST /v1/auth/logout — ends only the caller's own session (soft delete, so the Bearer token stops
// working at once) and revokes that session's SSO refresh token, best effort. Always 200: a 401 would
// trip the app's expired-session handling mid-logout, and a reply that varied by token state would
// tell a caller whether a guessed token exists.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const token = getBearerToken(event);
  if (token) {
    try {
      const session = await getSession(token);
      if (session) {
        await deleteSession(token, session.sub);
        if (session.refreshToken) {
          const clientSecret = await getSecret(secretName('sso-client-secret'));
          await revokeRefreshToken({
            issuer: config.ssoIssuer,
            clientId: config.ssoClientId,
            clientSecret,
            refreshToken: session.refreshToken,
          });
        }
      }
    } catch {
      // Logout must not fail from the app's point of view.
    }
  }
  return json(200, { ok: true });
};
