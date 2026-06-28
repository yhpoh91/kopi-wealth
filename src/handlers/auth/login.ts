import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { generatePkce, generateState, buildAuthorizeUrl } from '../../lib/auth';
import { setCookieHeader } from '../../lib/session';
import { config } from '../../config';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const isSecure = config.stage === 'prod';
  const redirectUri = `${config.appUrl}/auth/callback`;

  const authorizeUrl = buildAuthorizeUrl({
    issuer: config.ssoIssuer,
    clientId: config.ssoClientId,
    redirectUri,
    state,
    challenge,
  });

  const returnTo = event.queryStringParameters?.return_to ?? '/';

  return {
    statusCode: 302,
    headers: { Location: authorizeUrl },
    cookies: [
      setCookieHeader('pkce_verifier', verifier, 600, isSecure),
      setCookieHeader('oauth_state', state, 600, isSecure),
      setCookieHeader('return_to', returnTo, 600, isSecure),
    ],
    body: '',
  };
};
