import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings, putSettings } from '../repositories/financialSettings';
import { queryByUser } from '../repositories/account';
import { queryByUser as queryInvestments } from '../repositories/investment';
import { getCpf } from '../repositories/cpf';
import { queryByUser as queryLiabilities } from '../repositories/liability';
import { queryByUser as queryReceivables } from '../repositories/receivable';
import { queryByUser as queryGoals } from '../repositories/goal';
import { queryByPeriod as queryExpensesByPeriod } from '../repositories/expenseItem';
import { queryIncomeByUser } from '../repositories/income';
import { toMonthlyAmount } from '../types/income';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { calcReservedFunds, calcAvailableFunds } from '../lib/finance/reserved-funds';
import { resolveTrackedValue, calcGoalProgress } from '../lib/finance/goal';
import type { GoalMetrics } from '../lib/finance/goal';
import { getAccountManagementUrl } from '../lib/account-management';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

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
  const currency = settings?.currency ?? 'SGD';
  const today = clock.today();
  const period = today.slice(0, 7); // YYYY-MM

  const [accounts, investments, cpf, liabilities, receivables, goals, expenseItems, incomeSources] = await Promise.all([
    queryByUser(auth.session.sub),
    queryInvestments(auth.session.sub),
    getCpf(auth.session.sub),
    queryLiabilities(auth.session.sub),
    queryReceivables(auth.session.sub),
    queryGoals(auth.session.sub),
    queryExpensesByPeriod(auth.session.sub, period),
    queryIncomeByUser(auth.session.sub),
  ]);

  // Gather all foreign currencies needed
  const needsCpfFx = cpf !== null && currency !== 'SGD';
  const foreignCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...investments.map((i) => i.currency),
    ...liabilities.filter((l) => l.status !== 'settled').map((l) => l.currency),
    ...receivables.filter((r) => r.status !== 'settled').map((r) => r.currency),
  ].filter((c) => c !== currency))];
  if (needsCpfFx && !foreignCurrencies.includes('SGD')) foreignCurrencies.push('SGD');

  let rates: Record<string, number> = {};
  let fxFailed = false;
  if (foreignCurrencies.length > 0) {
    try {
      ({ rates } = await getOrFetchRates(currency));
    } catch {
      fxFailed = true;
    }
  }

  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Savings (accounts)
  const hasSavingsData = accounts.length > 0;
  let savingsNum = 0;
  let savingsPartial = false;
  for (const a of accounts) {
    if (a.currency === currency) {
      savingsNum += a.balance;
    } else {
      const c = convertAmount(a.balance, a.currency, currency, rates);
      if (c !== null && !fxFailed) { savingsNum += c; } else { savingsPartial = true; }
    }
  }
  const savingsOk = !hasSavingsData || (!savingsPartial && !fxFailed);

  // Investments
  const hasInvestData = investments.length > 0;
  let investNum = 0;
  let investPartial = false;
  for (const inv of investments) {
    if (inv.currency === currency) {
      investNum += inv.value;
    } else {
      const c = convertAmount(inv.value, inv.currency, currency, rates);
      if (c !== null && !fxFailed) { investNum += c; } else { investPartial = true; }
    }
  }
  const investOk = !hasInvestData || (!investPartial && !fxFailed);

  // CPF
  const hasCpfData = cpf !== null;
  let cpfNum = 0;
  let cpfPartial = false;
  if (hasCpfData) {
    const cpfSgd = cpf!.oa + cpf!.sa + cpf!.ma + cpf!.ra;
    if (currency === 'SGD') {
      cpfNum = cpfSgd;
    } else {
      const c = convertAmount(cpfSgd, 'SGD', currency, rates);
      if (c !== null && !fxFailed) { cpfNum = c; } else { cpfNum = cpfSgd; cpfPartial = true; }
    }
  }

  // Liabilities (active only)
  const activeLibs = liabilities.filter((l) => l.status !== 'settled');
  const hasLiabData = activeLibs.length > 0;
  let liabTotal = 0;
  let liabPartial = false;
  for (const l of activeLibs) {
    if (l.currency === currency) {
      liabTotal += l.outstandingAmount;
    } else {
      const c = convertAmount(l.outstandingAmount, l.currency, currency, rates);
      if (c !== null && !fxFailed) { liabTotal += c; } else { liabPartial = true; }
    }
  }
  const liabOk = !hasLiabData || (!liabPartial && !fxFailed);

  // Receivables (active only)
  const activeRecvs = receivables.filter((r) => r.status !== 'settled');
  const hasRecvData = activeRecvs.length > 0;
  let recvTotal = 0;
  let recvPartial = false;
  for (const r of activeRecvs) {
    if (r.currency === currency) {
      recvTotal += r.outstandingAmount;
    } else {
      const c = convertAmount(r.outstandingAmount, r.currency, currency, rates);
      if (c !== null && !fxFailed) { recvTotal += c; } else { recvPartial = true; }
    }
  }
  const recvOk = !hasRecvData || (!recvPartial && !fxFailed);

  const hasAnyData = hasSavingsData || hasInvestData || hasCpfData || hasLiabData || hasRecvData;
  const netWorthKnown = hasAnyData && savingsOk && investOk && liabOk && recvOk;

  // Net Worth = savings + investments + CPF + receivables − liabilities
  const netWorth = netWorthKnown ? savingsNum + investNum + cpfNum + recvTotal - liabTotal : null;
  const netWorthColor = netWorth !== null && netWorth < 0 ? 'var(--color-error)' : 'var(--color-accent)';
  const netWorthDisplay = netWorth !== null
    ? `${escapeHtml(currency)} ${escapeHtml(fmt(netWorth))}`
    : `${escapeHtml(currency)} —`;
  const netWorthPartial = hasAnyData && !netWorthKnown;
  const netWorthSubtext = !hasAnyData
    ? 'Add accounts, investments, liabilities or receivables to see net worth'
    : netWorthPartial
      ? 'Some currencies could not be converted'
      : `As of ${escapeHtml(today)}`;

  // Total Assets = savings + investments + CPF + receivables
  const hasAnyAssets = hasSavingsData || hasInvestData || hasCpfData || hasRecvData;
  const totalAssetsOk = savingsOk && investOk && !cpfPartial && recvOk;
  const totalAssets = hasAnyAssets && totalAssetsOk ? savingsNum + investNum + cpfNum + recvTotal : null;

  // Available Funds = savings + investments − reserved funds
  const hasAnyFunds = hasSavingsData || hasInvestData;
  const totalFundsOk = savingsOk && investOk;
  const availableFunds = (() => {
    if (!settings || !hasAnyFunds) return null;
    if (!totalFundsOk) return null;
    const { reservedSavings, reservedInvestments } = calcReservedFunds(savingsNum, investNum, settings);
    const { availableSavings, availableInvestments } = calcAvailableFunds(savingsNum, investNum, reservedSavings, reservedInvestments);
    return availableSavings! + availableInvestments!;
  })();

  // Income monthly total (active sources only — no endDate or endDate >= today)
  const activeIncome = incomeSources.filter((s) => !s.endDate || s.endDate >= today);
  let incomeMonthly = 0;
  let incomePartial = false;
  for (const s of activeIncome) {
    const monthly = toMonthlyAmount(s);
    if (s.currency === currency) { incomeMonthly += monthly; }
    else if (s.exchangeRate != null) { incomeMonthly += monthly * s.exchangeRate; }
    else { incomePartial = true; }
  }

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

  // Build GoalMetrics for goal progress bars
  const currentAssets = (hasSavingsData || hasInvestData || hasRecvData) && savingsOk && investOk && recvOk
    ? savingsNum + investNum + recvTotal
    : null;
  const totalFunds = hasAnyFunds && totalFundsOk ? savingsNum + investNum : null;
  const goalMetrics: GoalMetrics = {
    netWorth,
    currentAssets,
    investableAssets: totalFunds,
    totalSavings: hasSavingsData ? savingsNum : 0,
    totalInvestments: hasInvestData ? investNum : 0,
    cpfTotal: hasCpfData ? cpfNum : null,
    availableFunds,
  };

  const allActiveGoals = goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const topGoals = allActiveGoals.slice(0, 2);

  const goalCards = topGoals.map((g) => {
    const currentValue = resolveTrackedValue(g.tracksAgainst, goalMetrics);
    const progress = currentValue !== null && g.targetAmount > 0 ? calcGoalProgress(currentValue, g.targetAmount) : null;
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

  const viewAllGoals = allActiveGoals.length > 2
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
  const hasIncome = activeIncome.length > 0;
  const cashFlowSection = `<div style="margin-bottom:1rem">
    <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted);margin-bottom:0.5rem">Cash Flow — ${escapeHtml(monthLabel)}</div>
    <div class="card" style="padding:0.75rem 1rem">
      ${hasIncome
        ? `${metricRow('Est. Income / mo', incomeMonthly, true, incomePartial)}`
        : `<div style="font-size:0.85rem;color:var(--color-text-muted);padding:0.25rem 0">No income sources. <a href="/income" style="color:var(--color-accent)">Add one →</a></div>`
      }
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

      ${accounts.length === 0 ? `
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
