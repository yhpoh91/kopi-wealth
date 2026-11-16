import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSessionOrBearer } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings, putSettings } from '../repositories/financialSettings';
import { queryByPeriod as queryExpensesByPeriod } from '../repositories/expenseItem';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { buildOverview } from '../lib/finance/overview';
import { getAccountManagementUrl } from '../lib/account-management';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSessionOrBearer(event);
  if (!auth.authenticated) return auth.response;

  const [user, settings, accountManagementUrl] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
    getAccountManagementUrl(),
  ]);

  if (!settings) {
    const now = clock.nowIso();
    await putSettings({
      PK: `SETTINGS#${auth.session.sub}`,
      SK: 'SETTINGS',
      sub: auth.session.sub,
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      createdAt: now,
      updatedAt: now,
    });
  }

  const displayName = settings?.displayName ?? user?.name ?? user?.email ?? 'there';
  const period = clock.today().slice(0, 7); // YYYY-MM

  const [overview, expenseItems] = await Promise.all([
    buildOverview(auth.session.sub, settings),
    queryExpensesByPeriod(auth.session.sub, period),
  ]);
  const {
    currency, asOf: today, netWorth, hasAnyData, netWorthPartial, totalAssets, hasAnyAssets, totalAssetsOk,
    hasLiabilities: hasLiabData, liabilitiesTotal: liabTotal, liabilitiesOk: liabOk,
    availableFunds, hasAnyFunds, totalFundsOk, topGoals,
  } = overview;

  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const netWorthColor = netWorth !== null && netWorth < 0 ? 'var(--color-error)' : 'var(--color-accent)';
  const netWorthDisplay = netWorth !== null
    ? `${escapeHtml(currency)} ${escapeHtml(fmt(netWorth))}`
    : `${escapeHtml(currency)} —`;
  const netWorthSubtext = !hasAnyData
    ? 'Add accounts, investments, liabilities or receivables to see net worth'
    : netWorthPartial
      ? 'Some currencies could not be converted'
      : `As of ${escapeHtml(today)}`;

  // Expense items this month — sum in base currency
  let expensesTotal = 0;
  let expensesPartial = false;
  for (const item of expenseItems) {
    if (item.currency === currency) {
      expensesTotal += item.amount;
    } else if (item.exchangeRate != null) {
      expensesTotal += item.amount * item.exchangeRate;
    } else {
      expensesPartial = true;
    }
  }

  const goalCards = topGoals.map(({ goal: g, currentValue, progress }) => {
    const progressBar = progress !== null
      ? `<div style="background:var(--color-border);border-radius:999px;height:3px;overflow:hidden;margin:0.4rem 0 0.2rem">
           <div style="background:var(--color-accent);height:100%;width:${escapeHtml(progress.toFixed(1))}%;border-radius:999px"></div>
         </div>
         <div style="font-size:0.65rem;color:var(--color-text-muted)">${escapeHtml(progress.toFixed(1))}% · ${escapeHtml(currency)} ${escapeHtml(fmt(currentValue!))} of ${escapeHtml(fmt(g.targetAmount))}</div>`
      : g.targetAmount > 0
        ? `<div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.3rem">Target: ${escapeHtml(currency)} ${escapeHtml(fmt(g.targetAmount))}</div>`
        : '<div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.3rem">No target set</div>';
    return `<div class="card" style="padding:0.75rem">
      <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🎯 ${escapeHtml(g.name)}</div>
      ${progressBar}
    </div>`;
  }).join('');

  const viewAllGoals = overview.activeGoalCount > 2
    ? `<a href="/goals" style="font-size:0.75rem;color:var(--color-accent);text-decoration:none">View all →</a>`
    : `<a href="/goals" style="font-size:0.75rem;color:var(--color-accent);text-decoration:none">View all</a>`;

  const goalsSection = topGoals.length > 0
    ? `<div style="margin-bottom:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted)">Goals</div>
          ${viewAllGoals}
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem">${goalCards}</div>
      </div>`
    : `<div style="margin-bottom:1rem">
        <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted);margin-bottom:0.5rem">Goals</div>
        <div class="card" style="padding:0.75rem;font-size:0.85rem;color:var(--color-text-muted);text-align:center">
          No active goals. <a href="/goals" style="color:var(--color-accent)">Set one up →</a>
        </div>
      </div>`;

  const partial = '<span style="font-size:0.65rem;color:var(--color-text-muted);margin-left:0.25rem">(partial)</span>';

  const metricRow = (label: string, value: number | null, hasData: boolean, isPartial: boolean, color?: string) => {
    const valueStr = !hasData
      ? '—'
      : value === null
        ? `${escapeHtml(currency)} —`
        : `${escapeHtml(currency)} ${escapeHtml(fmt(value))}`;
    const partialMark = isPartial && hasData ? partial : '';
    const colorStyle = color ? `color:${color}` : 'color:var(--color-accent)';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0;border-bottom:1px solid var(--color-border)">
      <div style="font-size:0.82rem;color:var(--color-text-muted)">${escapeHtml(label)}</div>
      <div style="font-size:0.95rem;font-weight:700;${colorStyle}">${valueStr}${partialMark}</div>
    </div>`;
  };

  // Month label for cash flow
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = monthNames[parseInt(period.slice(5, 7), 10) - 1] ?? period;

  const hasExpenses = expenseItems.length > 0;
  const cashFlowSection = `<div style="margin-bottom:1rem">
    <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted);margin-bottom:0.5rem">Cash Flow — ${escapeHtml(monthLabel)}</div>
    <div class="card" style="padding:0.75rem 1rem">
      ${hasExpenses
        ? `${metricRow('Expenses', expensesTotal, true, expensesPartial, 'var(--color-error)')}`
        : `<div style="font-size:0.85rem;color:var(--color-text-muted);text-align:center;padding:0.25rem 0">No expenses recorded this month. <a href="/expenses/items" style="color:var(--color-accent)">Add one →</a></div>`
      }
    </div>
  </div>`;

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.1rem;margin-bottom:1rem;color:var(--color-text-muted)">
        Hello, ${escapeHtml(displayName)} 👋
      </h2>

      <!-- Net Worth hero -->
      <div class="card" style="margin-bottom:0.75rem;padding:1.25rem 1.5rem;border-color:rgba(199,160,82,0.45)">
        <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-muted);margin-bottom:0.4rem">Net Worth</div>
        <div style="font-size:2.25rem;font-weight:800;color:${netWorthColor};line-height:1.1">${netWorthDisplay}</div>
        <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.4rem">${escapeHtml(netWorthSubtext)}</div>
      </div>

      <!-- Supporting metrics: stacked card -->
      <div class="card" style="margin-bottom:1rem;padding:0 1rem">
        ${metricRow('Total Assets', totalAssets, hasAnyAssets, hasAnyAssets && !totalAssetsOk)}
        ${metricRow('Total Liabilities', hasLiabData ? liabTotal : null, hasLiabData, hasLiabData && !liabOk, hasLiabData ? 'var(--color-error)' : undefined)}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0">
          <div style="font-size:0.82rem;color:var(--color-text-muted)">Available Funds</div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--color-accent)">${
            !hasAnyFunds ? '—' : availableFunds === null ? `${escapeHtml(currency)} —` : `${escapeHtml(currency)} ${escapeHtml(fmt(availableFunds))}`
          }${hasAnyFunds && !totalFundsOk ? partial : ''}</div>
        </div>
      </div>

      ${overview.accountCount === 0 ? `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:var(--color-text-muted);text-align:center;padding:0.75rem 0">
          🚀 Your wealth dashboard is ready.<br>
          <a href="/cash-bank" style="color:var(--color-accent)">Add your first account</a> to get started.
        </div>
      </div>` : ''}

      ${goalsSection}
      ${cashFlowSection}
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Dashboard — kopi-wealth',
      body,
      page: 'dashboard',
      accountManagementUrl,
      user: {
        sub: auth.session.sub,
        displayName: settings?.displayName,
        email: user?.email,
        picture: user?.picture,
        role: auth.session.role,
      },
    }),
  };
};
