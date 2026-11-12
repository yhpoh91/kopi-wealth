import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { config } from '../../../config';
import { ALLOWED_APP_REDIRECT_URIS } from '../../../lib/auth';
import { json } from '../../../lib/json';

// GET /v1/auth/authorize — the mobile app's sign-in entry point. The app runs its own PKCE flow
// (it generates the verifier and state and checks the returned state itself), so this handler is
// stateless: it only builds the kopi-sso authorize URL server-side, so the app never needs to know
// the issuer or client id, and redirects to it.
const FORWARDED_PROMPTS = new Set(['login', 'select_account']);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = event.queryStringParameters ?? {};
  const { code_challenge: codeChallenge, state, redirect_uri: redirectUri, prompt } = params;
  const method = params.code_challenge_method ?? 'S256';

  if (!codeChallenge || !state || !redirectUri) {
    return json(400, { error: 'code_challenge, state and redirect_uri are required' });
  }
  if (method !== 'S256') {
    return json(400, { error: 'code_challenge_method must be S256' });
  }
  if (!ALLOWED_APP_REDIRECT_URIS.has(redirectUri)) {
    return json(400, { error: 'redirect_uri is not allowed' });
  }

  const url = new URL(`${config.ssoIssuer}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.ssoClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (prompt && FORWARDED_PROMPTS.has(prompt)) url.searchParams.set('prompt', prompt);

  return { statusCode: 302, headers: { Location: url.toString() }, body: '' };
};
