import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { queryIncomeByUser } from '../repositories/income';
import { toMonthlyAmount } from '../types/income';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { getAccountManagementUrl } from '../lib/account-management';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const [user, settings, accountManagementUrl, incomeSources] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
    getAccountManagementUrl(),
    queryIncomeByUser(auth.session.sub),
  ]);

  const currency = settings?.currency ?? 'SGD';
  const displayName = settings?.displayName ?? user?.name ?? user?.email ?? auth.session.sub;
  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const today = clock.today();
  const activeIncome = incomeSources.filter(s => !s.endDate || s.endDate >= today);
  let incomeMonthly = 0;
  let incomePartial = false;
  for (const s of activeIncome) {
    const monthly = toMonthlyAmount(s);
    if (s.currency === currency) { incomeMonthly += monthly; }
    else if (s.exchangeRate != null) { incomeMonthly += monthly * s.exchangeRate; }
    else { incomePartial = true; }
  }

  const partialMark = incomePartial ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">~</span>` : '';
  const incomeMeta = activeIncome.length > 0
    ? `${escapeHtml(currency)} ${escapeHtml(fmt(incomeMonthly))}${partialMark} / mo`
    : 'No sources yet';

  const body = `
  <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:1rem">Cash Flow</h2>

  <div style="display:flex;flex-direction:column;gap:0.75rem">
    <a href="/income" class="card" style="display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:var(--color-text);border-color:var(--color-border);transition:border-color 0.12s">
      <span style="font-size:1.3rem">💰</span>
      <div style="flex:1">
        <div style="font-weight:600">Income</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted)">${incomeMeta}</div>
      </div>
      <span style="color:var(--color-text-muted);font-size:1.1rem">›</span>
    </a>
    <a href="/expenses/items" class="card" style="display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:var(--color-text);border-color:var(--color-border);transition:border-color 0.12s">
      <span style="font-size:1.3rem">💸</span>
      <div style="flex:1">
        <div style="font-weight:600">Expenses</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted)">Track your spending</div>
      </div>
      <span style="color:var(--color-text-muted);font-size:1.1rem">›</span>
    </a>
    <div class="card" style="display:flex;align-items:center;gap:0.75rem;opacity:0.5">
      <span style="font-size:1.3rem">📊</span>
      <div style="flex:1">
        <div style="font-weight:600">Budget</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted)">Coming soon</div>
      </div>
    </div>
  </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: renderPage({
      title: 'Cash Flow — kopi-wealth',
      body,
      page: 'cash-flow',
      accountManagementUrl,
      user: {
        sub: auth.session.sub,
        displayName,
        email: user?.email,
        picture: user?.picture,
        role: auth.session.role,
      },
    }),
  };
};
