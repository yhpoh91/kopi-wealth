import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { getAccountManagementUrl } from '../../lib/account-management';
import { json } from '../../lib/json';
import { getUser } from '../../repositories/user';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;
  const { sub } = auth.session;

  try {
    // Only the caller's own USER#<sub> record; picture and role are never returned.
    const [user, accountManagementUrl] = await Promise.all([getUser(sub), getAccountManagementUrl()]);
    if (!user) return json(404, { error: 'not_found' });

    return json(200, {
      user: { sub: user.sub, email: user.email, ...(user.name ? { name: user.name } : {}) },
      accountManagementUrl,
    });
  } catch (err) {
    console.error('me failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'internal_error' });
  }
};
