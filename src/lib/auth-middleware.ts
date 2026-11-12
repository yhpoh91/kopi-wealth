import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { parseCookies } from './session';
import { clock } from './clock';
import { getSession, renewSessionTtl } from '../repositories/session';
import { getUser } from '../repositories/user';

export const MOBILE_SESSION_TTL_SECONDS = 60 * 86400; // 60 days
const MOBILE_RENEWAL_THROTTLE_SECONDS = 86400; // renew at most once a day

export interface SessionContext {
  sessionId: string;
  sub: string;
  role?: 'admin';
}

export type AuthResult =
  | { authenticated: true; session: SessionContext }
  | { authenticated: false; response: APIGatewayProxyStructuredResultV2 };

export function getBearerToken(event: APIGatewayProxyEventV2): string | undefined {
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match?.[1];
}

// Authorization: Bearer first (mobile app), then the sid cookie (web). A failed Bearer
// gets a JSON 401; a failed cookie gets the same login redirect web has always had.
export async function requireSessionOrBearer(event: APIGatewayProxyEventV2): Promise<AuthResult> {
  const bearer = getBearerToken(event);
  if (bearer) {
    const session = await resolveSession(bearer);
    return session ? { authenticated: true, session } : unauthorized();
  }

  const cookies = parseCookies(event.cookies?.join('; ') ?? event.headers?.cookie);
  const sessionId = cookies.sid;
  if (!sessionId) return redirect(event);

  const session = await resolveSession(sessionId);
  return session ? { authenticated: true, session } : redirect(event);
}

async function resolveSession(sessionId: string): Promise<SessionContext | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  // Web sessions keep their fixed 24 h life (DDB TTL). Mobile sessions are checked here
  // (TTL deletion can lag) and slide forward to a fresh 60 days while in use.
  if (session.platform === 'mobile') {
    const now = Math.floor(clock.nowMs() / 1000);
    if (session.ttl <= now) return null;
    if (session.ttl < now + MOBILE_SESSION_TTL_SECONDS - MOBILE_RENEWAL_THROTTLE_SECONDS) {
      await renewSessionTtl(sessionId, now + MOBILE_SESSION_TTL_SECONDS);
    }
  }

  const user = await getUser(session.sub);
  return { sessionId, sub: session.sub, role: user?.role };
}

function unauthorized(): AuthResult {
  return {
    authenticated: false,
    response: {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
      body: JSON.stringify({ error: 'unauthorized' }),
    },
  };
}

function redirect(event: APIGatewayProxyEventV2): AuthResult {
  const returnTo = encodeURIComponent(event.rawPath ?? '/');
  return {
    authenticated: false,
    response: {
      statusCode: 302,
      headers: { Location: `/auth/login?return_to=${returnTo}` },
      cookies: [],
      body: '',
    },
  };
}
