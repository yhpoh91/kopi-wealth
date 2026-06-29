import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getInvestment, queryByUser, putInvestment, updateInvestment, softDelete, putSnapshot } from '../repositories/investment';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { clock } from '../lib/clock';
import { INVESTMENT_TYPES, INVESTMENT_TYPE_LABELS } from '../types/investment';
import type { InvestmentType } from '../types/investment';

const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const pathParts = event.rawPath.split('/').filter(Boolean);
  // /investments            → ['investments']
  // /investments/:id        → ['investments', id]
  // /investments/:id/delete → ['investments', id, 'delete']
  const investId = pathParts[1];
  const action = pathParts[2];

  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
  ]);

  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    if (investId && action === 'delete') {
      const now = clock.nowIso();
      await softDelete(auth.session.sub, investId, auth.session.sub, now);
      return redirect('/investments');
    }

    if (investId) {
      const name = (params.name ?? '').trim().slice(0, 100);
      const type = INVESTMENT_TYPES.includes(params.type as InvestmentType) ? (params.type as InvestmentType) : null;
      const value = parseFloat(params.value ?? '');
      const institution = (params.institution ?? '').trim().slice(0, 100) || undefined;
      const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
      if (!name || !type || isNaN(value) || value < 0) return redirect('/investments?error=invalid_value');
      const now = clock.nowIso();
      const existing = await getInvestment(auth.session.sub, investId);
      if (!existing || existing.deletedAt) return redirect('/investments?error=not_found');
      await updateInvestment(auth.session.sub, investId, { name, type, value, institution, notes }, now);
      await putSnapshot({
        PK: `INVEST_SNAP#${investId}`,
        SK: `SNAP#${now}#${randomUUID()}`,
        investId,
        value,
        recordedAt: now,
        createdAt: now,
      });
      return redirect('/investments');
    }

    // Create
    const name = (params.name ?? '').trim().slice(0, 100);
    const type = INVESTMENT_TYPES.includes(params.type as InvestmentType) ? (params.type as InvestmentType) : null;
    const currency = CURRENCIES.includes(params.currency) ? params.currency : null;
    const value = parseFloat(params.value ?? '');
    const institution = (params.institution ?? '').trim().slice(0, 100) || undefined;
    const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;

    if (!name || !type || !currency || isNaN(value) || value < 0) {
      return redirect(`/investments?error=invalid&name=${encodeURIComponent(params.name ?? '')}&type=${encodeURIComponent(params.type ?? '')}&currency=${encodeURIComponent(params.currency ?? '')}&value=${encodeURIComponent(params.value ?? '')}`);
    }

    const id = randomUUID();
    const now = clock.nowIso();
    await putInvestment({
      PK: `INVEST#${auth.session.sub}`,
      SK: `INVEST#${id}`,
      GSI1PK: `USER#${auth.session.sub}`,
      GSI1SK: `INVEST#${now}`,
      id,
      sub: auth.session.sub,
      name,
      type,
      currency,
      value,
      institution,
      notes,
      createdAt: now,
      updatedAt: now,
    });
    await putSnapshot({
      PK: `INVEST_SNAP#${id}`,
      SK: `SNAP#${now}#${randomUUID()}`,
      investId: id,
      value,
      recordedAt: now,
      createdAt: now,
    });
    return redirect('/investments');
  }

  // GET
  const investments = await queryByUser(auth.session.sub);
  const currency = settings?.currency ?? 'SGD';
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorParam = qs.get('error');
  const errorBanner = errorParam
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">
        Validation failed (${escapeHtml(errorParam)}): name="${escapeHtml(qs.get('name') ?? '')}" type="${escapeHtml(qs.get('type') ?? '')}" currency="${escapeHtml(qs.get('currency') ?? '')}" value="${escapeHtml(qs.get('value') ?? '')}"
       </div>`
    : '';

  // FX: fetch once for all foreign-currency investments
  let rates: Record<string, number> = {};
  let ratesDate = '';
  let fxFailed = false;
  const foreignCurrencies = [...new Set(investments.map((i) => i.currency).filter((c) => c !== currency))];
  if (foreignCurrencies.length > 0) {
    try { ({ rates, date: ratesDate } = await getOrFetchRates(currency)); } catch { fxFailed = true; }
  }

  // Totals per type and grand total
  let grandTotal = 0;
  let grandPartial = false;
  const typeTotals: Partial<Record<InvestmentType, { total: number; partial: boolean }>> = {};
  for (const inv of investments) {
    const converted = convertAmount(inv.value, inv.currency, currency, rates);
    const amount = converted ?? 0;
    const partial = converted === null || fxFailed;
    grandTotal += amount;
    if (partial) grandPartial = true;
    const prev = typeTotals[inv.type] ?? { total: 0, partial: false };
    typeTotals[inv.type] = { total: prev.total + amount, partial: prev.partial || partial };
  }

  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partialNote = `<span style="font-size:0.7rem;color:var(--color-text-muted)"> (partial)</span>`;

  const typeBreakdown = INVESTMENT_TYPES
    .filter((t) => typeTotals[t])
    .map((t) => {
      const { total, partial } = typeTotals[t]!;
      return `<span style="white-space:nowrap">${escapeHtml(INVESTMENT_TYPE_LABELS[t])} ${escapeHtml(currency)} ${escapeHtml(fmt(total))}${partial ? partialNote : ''}</span>`;
    }).join('<span style="color:var(--color-border);margin:0 0.4rem">·</span>');

  const summaryBar = investments.length === 0 ? '' : `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.25rem">Total Investments</div>
      <div style="font-size:1.5rem;font-weight:700;color:var(--color-accent)">${escapeHtml(currency)} ${escapeHtml(fmt(grandTotal))}${grandPartial ? partialNote : ''}</div>
      ${typeBreakdown ? `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.25rem 0">${typeBreakdown}</div>` : ''}
    </div>`;

  const relativeTime = (iso: string) => {
    const diff = clock.nowMs() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  };

  const renderCard = (inv: (typeof investments)[0]) => {
    const typeOpts = INVESTMENT_TYPES.map(
      (t) => `<option value="${t}"${t === inv.type ? ' selected' : ''}>${escapeHtml(INVESTMENT_TYPE_LABELS[t])}</option>`,
    ).join('');
    const isForeign = inv.currency !== currency;
    const converted = isForeign ? convertAmount(inv.value, inv.currency, currency, rates) : null;
    const rate = isForeign && !fxFailed ? rates[inv.currency] : undefined;
    const rateLabel = rate !== undefined
      ? `1 ${escapeHtml(inv.currency)} = ${escapeHtml((1 / rate).toLocaleString('en-SG', { minimumFractionDigits: 4, maximumFractionDigits: 4 }))} ${escapeHtml(currency)}`
      : '';
    const tooltipText = ratesDate ? `Rate as of ${escapeHtml(ratesDate)}` : 'Rate unavailable';
    const rateInfo = rateLabel
      ? ` <span style="position:relative;display:inline-block;cursor:help" tabindex="0">ℹ️<span style="display:none;position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#333;color:#fff;font-size:0.65rem;white-space:nowrap;padding:0.2rem 0.4rem;border-radius:0.3rem;pointer-events:none" class="fx-tip">${tooltipText}</span></span>`
      : '';
    const convertedLine = isForeign
      ? converted !== null
        ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(converted))} <span style="opacity:0.7">(${rateLabel})</span>${rateInfo}</div>`
        : `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} —</div>`
      : '';

    return `
    <div class="card" style="cursor:default">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(inv.name)}</div>
          <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.15rem">
            ${escapeHtml(INVESTMENT_TYPE_LABELS[inv.type])}${inv.institution ? ' · ' + escapeHtml(inv.institution) : ''}
          </div>
          ${inv.notes ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(inv.notes)}</div>` : ''}
        </div>
        <button type="button" onclick="openInvPanel('${escapeHtml(inv.id)}')" title="Edit investment"
          style="flex-shrink:0;padding:0.2rem 0.3rem;background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:0.9rem;opacity:0.5;line-height:1;transition:opacity 0.12s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">✏️</button>
      </div>
      <div style="margin-top:0.5rem">
        <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent)">${escapeHtml(inv.currency)} ${escapeHtml(fmt(inv.value))}</div>
        ${convertedLine}
      </div>
      <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.4rem">Updated ${escapeHtml(relativeTime(inv.updatedAt))}</div>
    </div>

    <div class="panel-overlay" id="inv-overlay-${escapeHtml(inv.id)}" onclick="closeInvPanel('${escapeHtml(inv.id)}')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">${escapeHtml(inv.name)}</div>
          <button type="button" onclick="closeInvPanel('${escapeHtml(inv.id)}')" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/investments/${escapeHtml(inv.id)}">
          <div class="form-group">
            <label>Name</label>
            <input name="name" type="text" required value="${escapeHtml(inv.name)}">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">${typeOpts}</select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Currency</label>
              <input type="text" value="${escapeHtml(inv.currency)}" disabled style="opacity:0.6;cursor:not-allowed">
            </div>
            <div class="form-group">
              <label>Value</label>
              <input name="value" type="number" step="0.01" min="0" required value="${inv.value}">
            </div>
          </div>
          <div class="form-group">
            <label>Institution (optional)</label>
            <input name="institution" type="text" value="${escapeHtml(inv.institution ?? '')}" placeholder="e.g. IBKR">
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input name="notes" type="text" value="${escapeHtml(inv.notes ?? '')}" placeholder="e.g. core portfolio">
          </div>
          <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.75rem">Save changes</button>
        </form>
        <form method="POST" action="/investments/${escapeHtml(inv.id)}/delete"
          onsubmit="return confirm('Delete ${escapeHtml(inv.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}?')" style="text-align:center">
          <button type="submit" style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:0.85rem;padding:0.25rem 0">Delete investment</button>
        </form>
      </div>
    </div>`;
  };

  const investmentsContent = investments.length === 0
    ? `<div style="grid-column:1/-1"><div class="card" style="text-align:center;color:var(--color-text-muted);padding:2rem 1rem">No investments yet. Add your first investment below.</div></div>`
    : INVESTMENT_TYPES
        .filter((t) => investments.some((i) => i.type === t))
        .map((t) => {
          const group = investments.filter((i) => i.type === t);
          const { total, partial } = typeTotals[t]!;
          return `
          <div style="grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;margin-top:0.75rem;margin-bottom:0.25rem">
            <div style="font-size:0.8rem;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(INVESTMENT_TYPE_LABELS[t])}</div>
            <div style="font-size:0.8rem;color:var(--color-text-muted)">${escapeHtml(currency)} ${escapeHtml(fmt(total))}${partial ? partialNote : ''}</div>
          </div>
          ${group.map(renderCard).join('')}`;
        }).join('');

  const typeOptions = INVESTMENT_TYPES.map(
    (t) => `<option value="${t}">${escapeHtml(INVESTMENT_TYPE_LABELS[t])}</option>`,
  ).join('');
  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}"${c === currency ? ' selected' : ''}>${escapeHtml(c)}</option>`,
  ).join('');

  const body = `
    <style>@media(min-width:600px){.inv-grid{grid-template-columns:repeat(2,1fr)!important}}</style>
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem">Investments</h2>
        <button type="button" onclick="document.getElementById('add-overlay').classList.add('open')"
          class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">+ Add</button>
      </div>

      ${errorBanner}
      ${summaryBar}
      <div class="inv-grid" style="display:grid;grid-template-columns:1fr;gap:0.75rem">
        ${investmentsContent}
      </div>
    </div>

    <!-- Add investment panel -->
    <div class="panel-overlay" id="add-overlay" onclick="document.getElementById('add-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Add Investment</div>
          <button type="button" onclick="document.getElementById('add-overlay').classList.remove('open')" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/investments">
          <div class="form-group">
            <label>Name</label>
            <input name="name" type="text" required placeholder="e.g. IWDA, CapitaLand REIT">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">${typeOptions}</select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Currency</label>
              <select name="currency">${currencyOptions}</select>
            </div>
            <div class="form-group">
              <label>Value</label>
              <input name="value" type="number" step="0.01" min="0" required placeholder="0.00">
            </div>
          </div>
          <div class="form-group">
            <label>Institution (optional)</label>
            <input name="institution" type="text" placeholder="e.g. IBKR, Syfe">
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input name="notes" type="text" placeholder="e.g. core portfolio">
          </div>
          <button type="submit" class="btn-primary" style="width:100%">Add Investment</button>
        </form>
      </div>
    </div>

    <script>
      function openInvPanel(id){document.getElementById('inv-overlay-'+id).classList.add('open');}
      function closeInvPanel(id){document.getElementById('inv-overlay-'+id).classList.remove('open');}
      document.querySelectorAll('.fx-tip').forEach(function(tip){
        var el=tip.parentElement;
        el.addEventListener('mouseenter',function(){tip.style.display='block';});
        el.addEventListener('mouseleave',function(){tip.style.display='none';});
        el.addEventListener('focus',function(){tip.style.display='block';});
        el.addEventListener('blur',function(){tip.style.display='none';});
      });
    </script>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Investments — kopi-wealth',
      body,
      page: 'investments',
      user: {
        sub: auth.session.sub,
        displayName: settings?.displayName,
        email: user?.email,
        role: auth.session.role,
      },
    }),
  };
};

function redirect(location: string) {
  return {
    statusCode: 302,
    headers: { Location: location } as Record<string, string>,
    cookies: [] as string[],
    body: '',
  };
}
