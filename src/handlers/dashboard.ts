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
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { calcReservedFunds, calcAvailableFunds } from '../lib/finance/reserved-funds';
import { resolveTrackedValue, calcGoalProgress } from '../lib/finance/goal';
import type { GoalMetrics } from '../lib/finance/goal';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
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

  const [accounts, investments, cpf, liabilities, receivables, goals] = await Promise.all([
    queryByUser(auth.session.sub),
    queryInvestments(auth.session.sub),
    getCpf(auth.session.sub),
    queryLiabilities(auth.session.sub),
    queryReceivables(auth.session.sub),
    queryGoals(auth.session.sub),
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
      : `As of ${escapeHtml(clock.today())}`;

  // Total Assets = savings + investments + CPF + receivables
  const hasAnyAssets = hasSavingsData || hasInvestData || hasCpfData || hasRecvData;
  const totalAssetsOk = savingsOk && investOk && !cpfPartial && recvOk;
  const totalAssets = hasAnyAssets && totalAssetsOk ? savingsNum + investNum + cpfNum + recvTotal : null;

  // Current Assets = savings + investments + receivables (excludes CPF)
  const hasCurrentAssets = hasSavingsData || hasInvestData || hasRecvData;
  const currentAssetsOk = savingsOk && investOk && recvOk;
  const currentAssets = hasCurrentAssets && currentAssetsOk ? savingsNum + investNum + recvTotal : null;

  // Total Funds = savings + investments
  const hasAnyFunds = hasSavingsData || hasInvestData;
  const totalFundsOk = savingsOk && investOk;
  const totalFunds = hasAnyFunds && totalFundsOk ? savingsNum + investNum : null;

  // Available Funds = savings + investments − reserved funds
  const availableFunds = (() => {
    if (!settings || !hasAnyFunds) return null;
    if (!totalFundsOk) return null;
    const { reservedSavings, reservedInvestments } = calcReservedFunds(savingsNum, investNum, settings);
    const { availableSavings, availableInvestments } = calcAvailableFunds(savingsNum, investNum, reservedSavings, reservedInvestments);
    return availableSavings! + availableInvestments!;
  })();

  // Build GoalMetrics for goal progress bars
  const goalMetrics: GoalMetrics = {
    netWorth,
    currentAssets,
    investableAssets: totalFunds,
    totalSavings: hasSavingsData ? savingsNum : 0,
    totalInvestments: hasInvestData ? investNum : 0,
    cpfTotal: hasCpfData ? cpfNum : null,
    availableFunds,
  };

  const activeGoals = goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 4);

  const goalCards = activeGoals.map((g) => {
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
      <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.name)}</div>
      ${progressBar}
    </div>`;
  }).join('');

  const goalsSection = activeGoals.length > 0 ? `
    <div style="margin-bottom:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
        <div style="font-size:0.8rem;font-weight:600;color:var(--color-text-muted)">Active Goals</div>
        <a href="/goals" style="font-size:0.75rem;color:var(--color-accent);text-decoration:none">View all →</a>
      </div>
      <style>@media(min-width:600px){.goal-grid{grid-template-columns:repeat(2,1fr)!important}}</style>
      <div class="goal-grid" style="display:grid;grid-template-columns:1fr;gap:0.5rem">${goalCards}</div>
    </div>` : '';

  const partial = '<span style="font-size:0.65rem;color:var(--color-text-muted);margin-left:0.25rem">(partial)</span>';

  const metricVal = (value: number | null, hasData: boolean, isPartial: boolean) => {
    if (!hasData) return '<span style="color:var(--color-text-muted)">—</span>';
    if (value === null) return `<span style="color:var(--color-text-muted)">${escapeHtml(currency)} —</span>${partial}`;
    return `${escapeHtml(currency)} ${escapeHtml(fmt(value))}${isPartial ? partial : ''}`;
  };

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.1rem;margin-bottom:1rem;color:var(--color-text-muted)">
        Hello, ${escapeHtml(displayName)} 👋
      </h2>

      <div class="card" style="margin-bottom:1rem;padding:1.25rem 1.5rem">
        <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-muted);margin-bottom:0.4rem">Net Worth</div>
        <div style="font-size:2.25rem;font-weight:800;color:${netWorthColor};line-height:1.1">${netWorthDisplay}</div>
        <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.4rem">${escapeHtml(netWorthSubtext)}</div>
      </div>

      <style>
        .metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.625rem; margin-bottom:1rem }
        .metrics-grid .metric-full { grid-column: 1 / -1 }
        @media(max-width:400px){ .metrics-grid { grid-template-columns:1fr } .metrics-grid .metric-full { grid-column:1 } }
      </style>
      <div class="metrics-grid">
        <div class="card">
          <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:0.4rem">Total Assets</div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--color-accent)">${metricVal(totalAssets, hasAnyAssets, hasAnyAssets && !totalAssetsOk)}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.2rem">Accounts · Invest · CPF · Recv</div>
        </div>
        <div class="card">
          <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:0.4rem">Current Assets</div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--color-accent)">${metricVal(currentAssets, hasCurrentAssets, hasCurrentAssets && !currentAssetsOk)}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.2rem">Accounts · Invest · Recv</div>
        </div>
        <div class="card">
          <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:0.4rem">Total Liabilities</div>
          <div style="font-size:1.05rem;font-weight:700;color:${hasLiabData ? 'var(--color-error)' : 'inherit'}">${metricVal(hasLiabData ? liabTotal : null, hasLiabData, hasLiabData && !liabOk)}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.2rem">Active only</div>
        </div>
        <div class="card">
          <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:0.4rem">Total Funds</div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--color-accent)">${metricVal(totalFunds, hasAnyFunds, hasAnyFunds && !totalFundsOk)}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.2rem">Accounts · Invest</div>
        </div>
        <div class="card metric-full" style="border-color:rgba(199,160,82,0.45)">
          <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:0.4rem">Available Funds</div>
          <div style="font-size:1.25rem;font-weight:700;color:var(--color-accent)">${metricVal(availableFunds, hasAnyFunds, hasAnyFunds && !totalFundsOk)}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.2rem">Accounts + Invest − Reserved</div>
        </div>
      </div>

      ${accounts.length === 0 ? `
      <div class="card" style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:var(--color-text-muted);text-align:center;padding:0.75rem 0">
          🚀 Your wealth dashboard is ready.<br>
          <a href="/accounts" style="color:var(--color-accent)">Add your first account</a> to get started.
        </div>
      </div>` : ''}
      ${goalsSection}
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Dashboard — kopi-wealth',
      body,
      page: 'dashboard',
      user: {
        sub: auth.session.sub,
        displayName: settings?.displayName,
        email: user?.email,
        role: auth.session.role,
      },
    }),
  };
};
