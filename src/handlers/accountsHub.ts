import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { queryByUser as queryAccounts } from '../repositories/account';
import { queryByUser as queryInvestments } from '../repositories/investment';
import { getCpf } from '../repositories/cpf';
import { queryByUser as queryLiabilities } from '../repositories/liability';
import { queryByUser as queryReceivables } from '../repositories/receivable';
import { queryByUser as queryGoals } from '../repositories/goal';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { getAccountManagementUrl } from '../lib/account-management';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const [user, settings, accountManagementUrl] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
    getAccountManagementUrl(),
  ]);

  const currency = settings?.currency ?? 'SGD';

  const [accounts, investments, cpf, liabilities, receivables, goals] = await Promise.all([
    queryAccounts(auth.session.sub),
    queryInvestments(auth.session.sub),
    getCpf(auth.session.sub),
    queryLiabilities(auth.session.sub),
    queryReceivables(auth.session.sub),
    queryGoals(auth.session.sub),
  ]);

  const foreignCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...investments.map((i) => i.currency),
    ...liabilities.filter((l) => l.status !== 'settled').map((l) => l.currency),
    ...receivables.filter((r) => r.status !== 'settled').map((r) => r.currency),
  ].filter((c) => c !== currency))];
  if (cpf !== null && currency !== 'SGD' && !foreignCurrencies.includes('SGD')) {
    foreignCurrencies.push('SGD');
  }

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

  // Cash & Bank total
  let cashTotal = 0;
  let cashPartial = false;
  for (const a of accounts) {
    if (a.currency === currency) { cashTotal += a.balance; }
    else {
      const c = convertAmount(a.balance, a.currency, currency, rates);
      if (c !== null && !fxFailed) { cashTotal += c; } else { cashPartial = true; }
    }
  }

  // Investments total
  let investTotal = 0;
  let investPartial = false;
  for (const inv of investments) {
    if (inv.currency === currency) { investTotal += inv.value; }
    else {
      const c = convertAmount(inv.value, inv.currency, currency, rates);
      if (c !== null && !fxFailed) { investTotal += c; } else { investPartial = true; }
    }
  }

  // CPF total
  let cpfTotal = 0;
  let cpfPartial = false;
  if (cpf !== null) {
    const cpfSgd = cpf.oa + cpf.sa + cpf.ma + cpf.ra;
    if (currency === 'SGD') { cpfTotal = cpfSgd; }
    else {
      const c = convertAmount(cpfSgd, 'SGD', currency, rates);
      if (c !== null && !fxFailed) { cpfTotal = c; } else { cpfTotal = cpfSgd; cpfPartial = true; }
    }
  }

  // Receivables (active only)
  const activeRecvs = receivables.filter((r) => r.status !== 'settled');
  let recvTotal = 0;
  let recvPartial = false;
  for (const r of activeRecvs) {
    if (r.currency === currency) { recvTotal += r.outstandingAmount; }
    else {
      const c = convertAmount(r.outstandingAmount, r.currency, currency, rates);
      if (c !== null && !fxFailed) { recvTotal += c; } else { recvPartial = true; }
    }
  }

  // Liabilities (active only)
  const activeLibs = liabilities.filter((l) => l.status !== 'settled');
  let liabTotal = 0;
  let liabPartial = false;
  for (const l of activeLibs) {
    if (l.currency === currency) { liabTotal += l.outstandingAmount; }
    else {
      const c = convertAmount(l.outstandingAmount, l.currency, currency, rates);
      if (c !== null && !fxFailed) { liabTotal += c; } else { liabPartial = true; }
    }
  }

  const activeGoals = goals.filter((g) => g.status === 'active');

  const partial = (flag: boolean) => flag ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)" title="Partial FX conversion">~</span>' : '';

  const card = (href: string, icon: string, label: string, value: string, flag: boolean) => `
    <a href="${escapeHtml(href)}" class="hub-card">
      <div class="hub-card-top">
        <span class="hub-icon">${icon}</span>
        <span class="hub-label">${escapeHtml(label)}</span>
      </div>
      <div class="hub-value">${escapeHtml(currency)} ${escapeHtml(value)}${partial(flag)}</div>
    </a>`;

  const wideCard = (href: string, icon: string, label: string, value: string, flag: boolean) => `
    <a href="${escapeHtml(href)}" class="hub-card hub-card-wide">
      <span class="hub-icon">${icon}</span>
      <span class="hub-label">${escapeHtml(label)}</span>
      <span class="hub-value-inline">${escapeHtml(currency)} ${escapeHtml(value)}${partial(flag)}</span>
      <span class="hub-arrow">›</span>
    </a>`;

  const planCard = (href: string, icon: string, label: string, meta: string) => `
    <a href="${escapeHtml(href)}" class="hub-card hub-card-wide">
      <span class="hub-icon">${icon}</span>
      <span class="hub-label">${escapeHtml(label)}</span>
      <span class="hub-meta">${escapeHtml(meta)}</span>
      <span class="hub-arrow">›</span>
    </a>`;

  const body = `
  <style>
    .hub-section-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-muted); margin: 1.25rem 0 0.5rem; }
    .hub-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .hub-card {
      display: flex; flex-direction: column; gap: 0.4rem;
      background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 0.75rem;
      padding: 0.85rem 0.9rem; text-decoration: none; color: var(--color-text);
      transition: border-color 0.12s;
    }
    .hub-card:hover { border-color: var(--color-accent); }
    .hub-card-wide {
      flex-direction: row; align-items: center; gap: 0.6rem;
      grid-column: 1 / -1;
    }
    .hub-card-top { display: flex; align-items: center; gap: 0.4rem; }
    .hub-icon { font-size: 1.15rem; }
    .hub-label { font-size: 0.82rem; color: var(--color-text-muted); flex: 1; }
    .hub-value { font-size: 1rem; font-weight: 700; color: var(--color-accent); }
    .hub-value-inline { font-size: 0.95rem; font-weight: 700; color: var(--color-accent); margin-left: auto; }
    .hub-meta { font-size: 0.85rem; color: var(--color-text-muted); margin-left: auto; }
    .hub-arrow { color: var(--color-text-muted); font-size: 1.1rem; margin-left: 0.25rem; }
  </style>

  <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:0.25rem">Accounts</h2>
  <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.25rem">As of ${escapeHtml(clock.today())}</p>

  <div class="hub-section-label">Assets</div>
  <div class="hub-grid">
    ${card('/cash-bank', '🏦', 'Cash & Bank', fmt(cashTotal), cashPartial)}
    ${card('/investments', '📈', 'Investments', fmt(investTotal), investPartial)}
    ${card('/cpf', '🏛️', 'CPF', fmt(cpfTotal), cpfPartial)}
    ${card('/receivables', '📥', 'Receivables', fmt(recvTotal), recvPartial)}
  </div>

  <div class="hub-section-label">Liabilities</div>
  <div class="hub-grid">
    ${wideCard('/liabilities', '💳', 'Liabilities', fmt(liabTotal), liabPartial)}
  </div>

  <div class="hub-section-label">Planning</div>
  <div class="hub-grid">
    ${planCard('/goals', '🎯', 'Goals', activeGoals.length === 1 ? '1 active' : `${activeGoals.length} active`)}
    ${planCard('/reserved-funds', '🛡️', 'Reserved Funds', settings?.ef1SavingsFixed || settings?.ef1SavingsPct ? 'configured' : 'not set up')}
  </div>

  `;

  const displayName = settings?.displayName ?? user?.name ?? user?.email ?? auth.session.sub;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: renderPage({
      title: 'Accounts — kopi-wealth',
      body,
      page: 'accounts-hub',
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
