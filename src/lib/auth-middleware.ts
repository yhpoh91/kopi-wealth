import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { parseCookies } from './session';
import { getSession } from '../repositories/session';
import { getUser } from '../repositories/user';

export interface SessionContext {
  sessionId: string;
  sub: string;
  role?: 'admin';
}

export type AuthResult =
  | { authenticated: true; session: SessionContext }
  | { authenticated: false; redirect: { statusCode: 302; headers: { Location: string }; cookies: string[]; body: string } };

export async function requireSession(event: APIGatewayProxyEventV2): Promise<AuthResult> {
  const cookies = parseCookies(event.cookies?.join('; ') ?? event.headers?.cookie);
  const sessionId = cookies.sid;

  if (!sessionId) {
    return redirect(event);
  }

  const session = await getSession(sessionId);
  if (!session) {
    return redirect(event);
  }

  const user = await getUser(session.sub);

  return {
    authenticated: true,
    session: {
      sessionId,
      sub: session.sub,
      role: user?.role,
    },
  };
}

function redirect(event: APIGatewayProxyEventV2): AuthResult {
  const returnTo = encodeURIComponent(event.rawPath ?? '/');
  return {
    authenticated: false,
    redirect: {
      statusCode: 302,
      headers: { Location: `/auth/login?return_to=${returnTo}` },
      cookies: [],
      body: '',
    },
  };
}
