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
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';

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

  const [accounts, investments, cpf, liabilities, receivables] = await Promise.all([
    queryByUser(auth.session.sub),
    queryInvestments(auth.session.sub),
    getCpf(auth.session.sub),
    queryLiabilities(auth.session.sub),
    queryReceivables(auth.session.sub),
  ]);
  let savingsDisplay = '—';
  let savingsNote = '';

  // Gather all foreign currencies needed (accounts + investments + CPF if base != SGD)
  const needsCpfFx = cpf !== null && currency !== 'SGD';
  const foreignCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...investments.map((i) => i.currency),
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

  if (accounts.length > 0) {
    let total = 0;
    let hasUnconverted = false;

    for (const account of accounts) {
      if (account.currency === currency) {
        total += account.balance;
      } else {
        const converted = convertAmount(account.balance, account.currency, currency, rates);
        if (converted !== null && !fxFailed) {
          total += converted;
        } else {
          hasUnconverted = true;
        }
      }
    }

    savingsDisplay = total.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (hasUnconverted || fxFailed) {
      savingsNote = ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(partial)</span>';
    }
  }

  // Investments total in display currency
  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let investDisplay = '—';
  let investNote = '';
  if (investments.length > 0) {
    let total = 0;
    let hasUnconverted = false;
    for (const inv of investments) {
      if (inv.currency === currency) {
        total += inv.value;
      } else {
        const converted = convertAmount(inv.value, inv.currency, currency, rates);
        if (converted !== null && !fxFailed) {
          total += converted;
        } else {
          hasUnconverted = true;
        }
      }
    }
    investDisplay = fmt(total);
    if (hasUnconverted || fxFailed) {
      investNote = ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(partial)</span>';
    }
  }

  // CPF total in display currency
  let cpfDisplay = '—';
  let cpfNote = '';
  if (cpf) {
    const cpfSgd = cpf.oa + cpf.sa + cpf.ma + cpf.ra;
    if (currency === 'SGD') {
      cpfDisplay = fmt(cpfSgd);
    } else {
      const converted = convertAmount(cpfSgd, 'SGD', currency, rates);
      if (converted !== null && !fxFailed) {
        cpfDisplay = fmt(converted);
      } else {
        cpfDisplay = fmt(cpfSgd);
        cpfNote = ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(SGD)</span>';
      }
    }
  }

  // Liabilities total in display currency (active only)
  let liabTotal = 0;
  let liabPartial = false;
  for (const l of liabilities.filter((l) => l.status !== 'settled')) {
    if (l.currency === currency) {
      liabTotal += l.outstandingAmount;
    } else {
      const converted = convertAmount(l.outstandingAmount, l.currency, currency, rates);
      if (converted !== null && !fxFailed) {
        liabTotal += converted;
      } else {
        liabPartial = true;
      }
    }
  }
  const liabDisplay = liabilities.filter((l) => l.status !== 'settled').length > 0
    ? fmt(liabTotal) + (liabPartial || fxFailed ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(partial)</span>' : '')
    : null;

  // Receivables total in display currency (active only)
  let recvTotal = 0;
  let recvPartial = false;
  for (const r of receivables.filter((r) => r.status !== 'settled')) {
    if (r.currency === currency) {
      recvTotal += r.outstandingAmount;
    } else {
      const converted = convertAmount(r.outstandingAmount, r.currency, currency, rates);
      if (converted !== null && !fxFailed) {
        recvTotal += converted;
      } else {
        recvPartial = true;
      }
    }
  }
  const recvDisplay = receivables.filter((r) => r.status !== 'settled').length > 0
    ? fmt(recvTotal) + (recvPartial || fxFailed ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(partial)</span>' : '')
    : null;

  // Net worth = savings + investments + cpf + receivables − liabilities
  const hasSavingsData = accounts.length > 0;
  const hasInvestData = investments.length > 0;
  const hasCpfData = cpf !== null;
  const hasLiabData = liabilities.filter((l) => l.status !== 'settled').length > 0;
  const hasRecvData = receivables.filter((r) => r.status !== 'settled').length > 0;
  const savingsOk = !hasSavingsData || (!fxFailed && savingsDisplay !== '—');
  const investOk = !hasInvestData || (!fxFailed && investDisplay !== '—');
  const liabOk = !hasLiabData || (!liabPartial && !fxFailed);
  const recvOk = !hasRecvData || (!recvPartial && !fxFailed);
  const hasAnyData = hasSavingsData || hasInvestData || hasCpfData || hasLiabData || hasRecvData;
  const netWorthKnown = hasAnyData && savingsOk && investOk && liabOk && recvOk;

  let savingsNum = 0;
  if (hasSavingsData && savingsOk) {
    for (const a of accounts) {
      if (a.currency === currency) { savingsNum += a.balance; }
      else {
        const c = convertAmount(a.balance, a.currency, currency, rates);
        if (c !== null) savingsNum += c;
      }
    }
  }
  let investNum = 0;
  if (hasInvestData && investOk) {
    for (const i of investments) {
      if (i.currency === currency) { investNum += i.value; }
      else {
        const c = convertAmount(i.value, i.currency, currency, rates);
        if (c !== null) investNum += c;
      }
    }
  }
  let cpfNum = 0;
  if (hasCpfData) {
    const cpfSgd = cpf!.oa + cpf!.sa + cpf!.ma + cpf!.ra;
    if (currency === 'SGD') { cpfNum = cpfSgd; }
    else {
      const c = convertAmount(cpfSgd, 'SGD', currency, rates);
      cpfNum = c !== null ? c : cpfSgd;
    }
  }

  const netWorth = netWorthKnown ? savingsNum + investNum + cpfNum + recvTotal - liabTotal : null;
  const netWorthColor = netWorth !== null && netWorth < 0 ? 'var(--color-error)' : 'var(--color-accent)';
  const netWorthDisplay = netWorth !== null
    ? `${escapeHtml(currency)} ${escapeHtml(fmt(netWorth))}`
    : `${escapeHtml(currency)} —`;
  const netWorthSubtext = !hasAnyData
    ? 'Add accounts, investments, liabilities or receivables to see net worth'
    : netWorth === null
      ? 'Some currencies could not be converted'
      : `As of ${escapeHtml(clock.today())}`;

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.3rem;margin-bottom:1.5rem">
        Hello, ${escapeHtml(displayName)} 👋
      </h2>

      <div class="card" style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.25rem">Net Worth</div>
        <div style="font-size:2rem;font-weight:700;color:${netWorthColor}">${netWorthDisplay}</div>
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.25rem">${escapeHtml(netWorthSubtext)}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Savings</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">${accounts.length > 0 ? escapeHtml(currency) + ' ' + savingsDisplay + savingsNote : '—'}</div>
        </div>
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Investments</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">${investments.length > 0 ? escapeHtml(currency) + ' ' + investDisplay + investNote : '—'}</div>
        </div>
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">CPF</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">${cpf ? escapeHtml(currency) + ' ' + cpfDisplay + cpfNote : '—'}</div>
        </div>
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Liabilities</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem;color:${liabDisplay ? 'var(--color-error)' : 'inherit'}">${liabDisplay ? escapeHtml(currency) + ' ' + liabDisplay : '—'}</div>
        </div>
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Receivables</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">${recvDisplay ? escapeHtml(currency) + ' ' + recvDisplay : '—'}</div>
        </div>
      </div>

      ${accounts.length === 0 ? `
      <div class="card">
        <div style="font-size:0.85rem;color:var(--color-text-muted);text-align:center;padding:1rem 0">
          🚀 Your wealth dashboard is ready.<br>
          <a href="/accounts" style="color:var(--color-accent)">Add your first account</a> to get started.
        </div>
      </div>` : ''}
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
