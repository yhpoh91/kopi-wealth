import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { parseCookies, clearCookieHeader } from '../../lib/session';
import { getSession, deleteSession } from '../../repositories/session';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const cookies = parseCookies(event.cookies?.join('; ') ?? event.headers?.cookie);
  const sessionId = cookies.sid;

  if (sessionId) {
    const session = await getSession(sessionId);
    if (session) {
      await deleteSession(sessionId, session.sub);
    }
  }

  return {
    statusCode: 302,
    multiValueHeaders: {
      'Set-Cookie': [clearCookieHeader('sid')],
    },
    headers: { Location: '/auth/login' },
    body: '',
  };
};
