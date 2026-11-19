import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../../lib/auth-middleware';
import { buildOverview } from '../../lib/finance/overview';
import type { Overview } from '../../lib/finance/overview';
import { isFeatureEnabled } from '../../lib/feature-flags';
import { json } from '../../lib/json';
import { metric } from '../../lib/finance/metric';
import { getUser } from '../../repositories/user';
import { getSettings } from '../../repositories/financialSettings';

export function toOverviewResponse(o: Overview) {
  const top = o.topGoals[0];
  return {
    currency: o.currency,
    asOf: o.asOf,
    netWorth: metric(o.netWorth, o.hasAnyData, o.netWorthPartial || (o.netWorth !== null && o.cpfPartial)),
    have: metric(o.totalAssets, o.hasAnyAssets, o.hasAnyAssets && !o.totalAssetsOk),
    owe: metric(o.hasLiabilities ? o.liabilitiesTotal : null, o.hasLiabilities, o.hasLiabilities && !o.liabilitiesOk),
    available: metric(o.availableFunds, o.hasAnyFunds, o.hasAnyFunds && !o.totalFundsOk),
    topGoal: top
      ? {
          name: top.goal.name,
          tracks: top.goal.tracksAgainst,
          percent: top.progress === null ? null : Math.round(top.progress * 10) / 10,
          amountToGo: top.currentValue === null || top.goal.targetAmount <= 0
            ? null
            : Math.max(0, top.goal.targetAmount - top.currentValue),
        }
      : null,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;
  const { sub } = auth.session;

  try {
    const [user, settings, debugPanel, accountSelfService] = await Promise.all([
      getUser(sub), // live read: the session's cached role is never used for isAdmin
      getSettings(sub),
      isFeatureEnabled('debugPanel', sub),
      isFeatureEnabled('accountSelfService', sub),
    ]);
    const overview = await buildOverview(sub, settings);

    // An absent flag means off.
    const flags: Record<string, true> = {};
    if (user?.role === 'admin') flags.isAdmin = true;
    if (debugPanel) flags.debugPanel = true;
    if (accountSelfService) flags.accountSelfService = true;

    return json(200, { ...toOverviewResponse(overview), flags, due: overview.due });
  } catch (err) {
    console.error('overview failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'internal_error' });
  }
};
