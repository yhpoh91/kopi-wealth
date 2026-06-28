import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { parseCookies } from '../lib/session';
import { getSession } from '../repositories/session';
import { renderPage } from '../lib/layout';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const cookies = parseCookies(event.cookies?.join('; ') ?? event.headers?.cookie);
  const sessionId = cookies.sid;

  if (sessionId) {
    const session = await getSession(sessionId);
    if (session) {
      return { statusCode: 302, headers: { Location: '/dashboard' } as Record<string, string>, cookies: [], body: '' };
    }
  }

  const body = `
    <div style="max-width:480px;margin:0 auto;padding:2rem 0;text-align:center">
      <div style="font-size:3rem;margin-bottom:1rem">☕</div>
      <h1 style="font-size:1.75rem;font-weight:700;color:var(--color-accent);margin-bottom:0.5rem">kopi-wealth</h1>
      <p style="font-size:1rem;color:var(--color-text-muted);margin-bottom:2.5rem">Track your wealth. Know your number.</p>
      <a href="/auth/login" class="btn-primary" style="display:inline-block;padding:0.75rem 2rem;font-size:1rem;text-decoration:none">Sign in</a>
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'kopi-wealth',
      body,
      hideNav: true,
    }),
  };
};
