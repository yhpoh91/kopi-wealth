import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings, putSettings } from '../repositories/financialSettings';
import { queryByUser as queryAccounts } from '../repositories/account';
import { queryByUser as queryInvestments } from '../repositories/investment';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { clock } from '../lib/clock';
import { calcReservedFunds, calcAvailableFunds, calcEmergencyFund } from '../lib/finance/reserved-funds';
import type { FinancialSettings } from '../types/financialSettings';

const fmt = (n: number) =>
  n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function computeTotals(sub: string, currency: string): Promise<{
  savingsTotal: number | null;
  investmentsTotal: number | null;
}> {
  const [accounts, investments] = await Promise.all([
    queryAccounts(sub),
    queryInvestments(sub),
  ]);

  const activeAccounts = accounts.filter((a) => !a.deletedAt);
  const activeInvestments = investments.filter((i) => !i.deletedAt);

  const foreignCurrencies = new Set([
    ...activeAccounts.filter((a) => a.currency !== currency).map((a) => a.currency),
    ...activeInvestments.filter((i) => i.currency !== currency).map((i) => i.currency),
  ]);

  let rates: Record<string, number> = {};
  if (foreignCurrencies.size > 0) {
    try {
      ({ rates } = await getOrFetchRates(currency));
    } catch {
      return { savingsTotal: null, investmentsTotal: null };
    }
  }

  let savingsTotal = 0;
  let savingsPartial = false;
  for (const a of activeAccounts) {
    if (a.currency === currency) {
      savingsTotal += a.balance;
    } else {
      const converted = convertAmount(a.balance, a.currency, currency, rates);
      if (converted === null) { savingsPartial = true; } else { savingsTotal += converted; }
    }
  }

  let investmentsTotal = 0;
  let investmentsPartial = false;
  for (const i of activeInvestments) {
    if (i.currency === currency) {
      investmentsTotal += i.value;
    } else {
      const converted = convertAmount(i.value, i.currency, currency, rates);
      if (converted === null) { investmentsPartial = true; } else { investmentsTotal += converted; }
    }
  }

  return {
    savingsTotal: savingsPartial ? null : savingsTotal,
    investmentsTotal: investmentsPartial ? null : investmentsTotal,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
  ]);

  const currency = settings?.currency ?? 'SGD';

  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    const ef1SavingsFixed = params.ef1SavingsFixed !== '' ? parseFloat(params.ef1SavingsFixed ?? '') : 0;
    const ef1SavingsPct = params.ef1SavingsPct !== '' ? parseFloat(params.ef1SavingsPct ?? '') : 0;
    const ef1InvestmentFixed = params.ef1InvestmentFixed !== '' ? parseFloat(params.ef1InvestmentFixed ?? '') : 0;
    const ef1InvestmentPct = params.ef1InvestmentPct !== '' ? parseFloat(params.ef1InvestmentPct ?? '') : 0;
    const efType = params.efType === 'budget_based' ? 'budget_based' as const : 'none' as const;
    const ef2LeanMonthly = params.ef2LeanMonthly !== '' ? parseFloat(params.ef2LeanMonthly ?? '') : 0;
    const ef2LeanMonths = params.ef2LeanMonths !== '' ? parseFloat(params.ef2LeanMonths ?? '') : 0;
    const ef2FatMonthly = params.ef2FatMonthly !== '' ? parseFloat(params.ef2FatMonthly ?? '') : 0;
    const ef2FatMonths = params.ef2FatMonths !== '' ? parseFloat(params.ef2FatMonths ?? '') : 0;

    const allNums = [ef1SavingsFixed, ef1SavingsPct, ef1InvestmentFixed, ef1InvestmentPct, ef2LeanMonthly, ef2LeanMonths, ef2FatMonthly, ef2FatMonths];
    if (allNums.some((v) => isNaN(v) || v < 0)) {
      return redirect('/reserved-funds?error=invalid');
    }
    if (ef1SavingsPct > 100 || ef1InvestmentPct > 100) {
      return redirect('/reserved-funds?error=invalid');
    }

    const now = clock.nowIso();
    const existing = settings ?? {
      PK: `SETTINGS#${auth.session.sub}`,
      SK: 'SETTINGS',
      sub: auth.session.sub,
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      createdAt: now,
      updatedAt: now,
    };

    await putSettings({
      ...existing,
      ef1SavingsFixed: ef1SavingsFixed || undefined,
      ef1SavingsPct: ef1SavingsPct || undefined,
      ef1InvestmentFixed: ef1InvestmentFixed || undefined,
      ef1InvestmentPct: ef1InvestmentPct || undefined,
      efType,
      ef2LeanMonthly: ef2LeanMonthly || undefined,
      ef2LeanMonths: ef2LeanMonths || undefined,
      ef2FatMonthly: ef2FatMonthly || undefined,
      ef2FatMonths: ef2FatMonths || undefined,
      updatedAt: now,
    });

    return redirect('/reserved-funds');
  }

  // GET
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorBanner = qs.get('error')
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">Please enter valid non-negative values (percentages must be 0–100).</div>`
    : '';

  const { savingsTotal, investmentsTotal } = await computeTotals(auth.session.sub, currency);
  const s = settings as FinancialSettings | null;

  const { reservedSavings, reservedInvestments } = calcReservedFunds(savingsTotal, investmentsTotal, s ?? {
    PK: '', SK: '', sub: '', currency, timezone: 'Asia/Singapore', createdAt: '', updatedAt: '',
  });
  const { availableSavings, availableInvestments } = calcAvailableFunds(savingsTotal, investmentsTotal, reservedSavings, reservedInvestments);
  const ef = calcEmergencyFund(s ?? { PK: '', SK: '', sub: '', currency, timezone: 'Asia/Singapore', createdAt: '', updatedAt: '' }, savingsTotal, investmentsTotal);

  const statusSection = buildStatusSection(currency, savingsTotal, investmentsTotal, reservedSavings, reservedInvestments, availableSavings, availableInvestments, ef);
  const configForm = buildConfigForm(s);

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.3rem;margin-bottom:1.25rem">Reserved Funds &amp; Emergency Fund</h2>
      ${errorBanner}
      ${statusSection}
      ${configForm}
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Reserved Funds — kopi-wealth',
      body,
      page: 'reserved-funds',
      user: {
        sub: auth.session.sub,
        displayName: s?.displayName,
        email: user?.email,
        role: auth.session.role,
      },
    }),
  };
};

function buildStatusSection(
  currency: string,
  savingsTotal: number | null,
  investmentsTotal: number | null,
  reservedSavings: number,
  reservedInvestments: number,
  availableSavings: number | null,
  availableInvestments: number | null,
  ef: ReturnType<typeof calcEmergencyFund>,
): string {
  const cur = escapeHtml(currency);
  const fmtVal = (v: number | null) => v !== null ? `${cur} ${escapeHtml(fmt(v))}` : '—';

  const totalUsable = (availableSavings !== null || availableInvestments !== null)
    ? (availableSavings ?? 0) + (availableInvestments ?? 0)
    : null;

  const bucketRow = (label: string, total: number | null, reserved: number, available: number | null) => `
    <div style="border-top:1px solid var(--color-border);padding-top:0.75rem;margin-top:0.75rem">
      <div style="font-size:0.75rem;font-weight:600;color:var(--color-text-muted);margin-bottom:0.5rem">${label}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem">
        <div>
          <div style="font-size:0.65rem;color:var(--color-text-muted)">Total</div>
          <div style="font-size:0.9rem;font-weight:600">${fmtVal(total)}</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--color-text-muted)">Reserved</div>
          <div style="font-size:0.9rem;font-weight:600">−${fmtVal(reserved)}</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--color-text-muted)">Usable</div>
          <div style="font-size:0.9rem;font-weight:700;color:var(--color-accent)">${fmtVal(available)}</div>
        </div>
      </div>
    </div>`;

  const statusCard = `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.25rem">Total Usable</div>
      <div style="font-size:1.75rem;font-weight:700;color:var(--color-accent)">${fmtVal(totalUsable)}</div>
      ${bucketRow('Savings 🏦', savingsTotal, reservedSavings, availableSavings)}
      ${bucketRow('Investments 📈', investmentsTotal, reservedInvestments, availableInvestments)}
    </div>`;

  const efCard = ef
    ? (() => {
        const pctLean = ef.leanTarget > 0 ? Math.min(100, (ef.actual / ef.leanTarget) * 100) : 100;
        const pctFat = ef.fatTarget > 0 ? Math.min(100, (ef.actual / ef.fatTarget) * 100) : 100;
        return `
      <div class="card" style="margin-bottom:1.25rem">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">Emergency Fund</div>
        <div style="margin-bottom:0.75rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem">
            <div style="font-size:0.75rem">Lean target: ${cur} ${escapeHtml(fmt(ef.leanTarget))}</div>
            <div style="font-size:0.75rem;color:${ef.leanMet ? 'var(--color-accent)' : 'var(--color-text-muted)'}">${ef.leanMet ? '✓ Met' : `${escapeHtml(pctLean.toFixed(0))}%`}</div>
          </div>
          <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
            <div style="background:var(--color-accent);height:100%;width:${escapeHtml(pctLean.toFixed(1))}%;border-radius:999px"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem">
            <div style="font-size:0.75rem">Fat target: ${cur} ${escapeHtml(fmt(ef.fatTarget))}</div>
            <div style="font-size:0.75rem;color:${ef.fatMet ? 'var(--color-accent)' : 'var(--color-text-muted)'}">${ef.fatMet ? '✓ Met' : `${escapeHtml(pctFat.toFixed(0))}%`}</div>
          </div>
          <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
            <div style="background:var(--color-accent);height:100%;width:${escapeHtml(pctFat.toFixed(1))}%;border-radius:999px"></div>
          </div>
        </div>
        <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.6rem">Actual: ${cur} ${escapeHtml(fmt(ef.actual))} (savings + investments)</div>
      </div>`;
      })()
    : '';

  return statusCard + efCard;
}

function buildConfigForm(settings: FinancialSettings | null): string {
  const v = (field: keyof FinancialSettings, fallback = '') => {
    const val = settings?.[field];
    return val !== undefined && val !== null && val !== 0 ? escapeHtml(String(val)) : fallback;
  };
  const efType = settings?.efType ?? 'none';

  return `
    <form method="POST" action="/reserved-funds">
      <div class="card" style="margin-bottom:1.25rem">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">Reserved Funds — Savings</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Fixed amount</label>
            <input name="ef1SavingsFixed" type="number" step="0.01" min="0" value="${v('ef1SavingsFixed')}" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Percentage (%)</label>
            <input name="ef1SavingsPct" type="number" step="0.01" min="0" max="100" value="${v('ef1SavingsPct')}" placeholder="0.00">
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1.25rem">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">Reserved Funds — Investments</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Fixed amount</label>
            <input name="ef1InvestmentFixed" type="number" step="0.01" min="0" value="${v('ef1InvestmentFixed')}" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Percentage (%)</label>
            <input name="ef1InvestmentPct" type="number" step="0.01" min="0" max="100" value="${v('ef1InvestmentPct')}" placeholder="0.00">
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1.25rem">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">Emergency Fund</div>
        <div class="form-group">
          <label>Type</label>
          <select name="efType" onchange="document.getElementById('ef-budget').style.display=this.value==='budget_based'?'block':'none'">
            <option value="none"${efType === 'none' ? ' selected' : ''}>None</option>
            <option value="budget_based"${efType === 'budget_based' ? ' selected' : ''}>Budget-based</option>
          </select>
        </div>
        <div id="ef-budget" style="display:${efType === 'budget_based' ? 'block' : 'none'}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Lean monthly</label>
              <input name="ef2LeanMonthly" type="number" step="0.01" min="0" value="${v('ef2LeanMonthly')}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Lean months</label>
              <input name="ef2LeanMonths" type="number" step="1" min="0" value="${v('ef2LeanMonths')}" placeholder="6">
            </div>
            <div class="form-group">
              <label>Fat monthly</label>
              <input name="ef2FatMonthly" type="number" step="0.01" min="0" value="${v('ef2FatMonthly')}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Fat months</label>
              <input name="ef2FatMonths" type="number" step="1" min="0" value="${v('ef2FatMonths')}" placeholder="12">
            </div>
          </div>
        </div>
      </div>
      <button type="submit" class="btn-primary" style="width:100%">Save</button>
    </form>`;
}

function redirect(location: string) {
  return {
    statusCode: 302,
    headers: { Location: location } as Record<string, string>,
    cookies: [] as string[],
    body: '',
  };
}
