import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { queryIncomeByUser, getIncome, putIncome, updateIncome, softDeleteIncome } from '../repositories/income';
import { clock } from '../lib/clock';
import { getAccountManagementUrl } from '../lib/account-management';
import type { IncomeSource, IncomeType, IncomeFrequency } from '../types/income';
import { toMonthlyAmount } from '../types/income';

const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];
const INCOME_TYPES: IncomeType[] = ['salary', 'rental', 'other'];
const INCOME_TYPE_LABELS: Record<IncomeType, string> = { salary: 'Salary', rental: 'Rental', other: 'Other' };
const FREQUENCIES: IncomeFrequency[] = ['monthly', 'quarterly', 'annual'];
const FREQUENCY_LABELS: Record<IncomeFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location } as Record<string, string>, cookies: [] as string[], body: '' };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const pathParts = event.rawPath.split('/').filter(Boolean);
  // /income            → ['income']
  // /income/{id}       → ['income', id]
  // /income/{id}/delete → ['income', id, 'delete']
  const incomeId = pathParts[1];
  const action = pathParts[2];

  const [user, settings, accountManagementUrl] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
    getAccountManagementUrl(),
  ]);

  const currency = settings?.currency ?? 'SGD';
  const today = clock.today();

  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    // DELETE
    if (incomeId && action === 'delete') {
      const existing = await getIncome(auth.session.sub, incomeId);
      if (!existing || existing.deletedAt) return redirect('/income');
      await softDeleteIncome(auth.session.sub, incomeId, auth.session.sub);
      return redirect('/income');
    }

    // UPDATE
    if (incomeId) {
      const existing = await getIncome(auth.session.sub, incomeId);
      if (!existing || existing.deletedAt) return redirect('/income?error=not_found');
      const type = INCOME_TYPES.includes(params.type as IncomeType) ? (params.type as IncomeType) : null;
      const amount = parseFloat(params.amount ?? '');
      const frequency = FREQUENCIES.includes(params.frequency as IncomeFrequency) ? (params.frequency as IncomeFrequency) : null;
      if (!type || isNaN(amount) || amount <= 0 || !frequency) return redirect('/income?error=invalid');
      const name = (params.name ?? '').trim().slice(0, 100) || undefined;
      const rawExchangeRate = parseFloat(params.exchangeRate ?? '');
      const exchangeRate = !isNaN(rawExchangeRate) && rawExchangeRate > 0 ? rawExchangeRate : undefined;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params.startDate ?? '') ? params.startDate : undefined;
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(params.endDate ?? '') ? params.endDate : undefined;
      const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
      await updateIncome(auth.session.sub, incomeId, { type, name, amount, exchangeRate, frequency, startDate, endDate, notes });
      return redirect('/income');
    }

    // CREATE
    const type = INCOME_TYPES.includes(params.type as IncomeType) ? (params.type as IncomeType) : null;
    const incCurrency = CURRENCIES.includes(params.currency) ? params.currency : null;
    const amount = parseFloat(params.amount ?? '');
    const frequency = FREQUENCIES.includes(params.frequency as IncomeFrequency) ? (params.frequency as IncomeFrequency) : null;
    if (!type || !incCurrency || isNaN(amount) || amount <= 0 || !frequency) return redirect('/income?error=invalid');
    const name = (params.name ?? '').trim().slice(0, 100) || `${INCOME_TYPE_LABELS[type]} income`;
    const rawExchangeRate = parseFloat(params.exchangeRate ?? '');
    const exchangeRate = !isNaN(rawExchangeRate) && rawExchangeRate > 0 ? rawExchangeRate : undefined;
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params.startDate ?? '') ? params.startDate : today;
    const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
    const id = randomUUID();
    const now = clock.nowIso();
    const item: IncomeSource = {
      PK: `INCOME#${auth.session.sub}`,
      SK: `INCOME#${id}`,
      GSI1PK: `USER#${auth.session.sub}`,
      GSI1SK: `INCOME#${now}`,
      id,
      sub: auth.session.sub,
      type,
      name,
      amount,
      currency: incCurrency,
      exchangeRate,
      frequency,
      startDate,
      notes,
      createdAt: now,
      updatedAt: now,
    };
    await putIncome(item);
    return redirect('/income');
  }

  // GET
  const sources = await queryIncomeByUser(auth.session.sub);
  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const isActive = (s: IncomeSource) => !s.endDate || s.endDate >= today;
  const activeSources = sources.filter(isActive);
  const endedSources = sources.filter(s => !isActive(s));

  // Monthly total from active sources
  let monthlyTotal = 0;
  let monthlyPartial = false;
  for (const s of activeSources) {
    const monthly = toMonthlyAmount(s);
    if (s.currency === currency) {
      monthlyTotal += monthly;
    } else if (s.exchangeRate != null) {
      monthlyTotal += monthly * s.exchangeRate;
    } else {
      monthlyPartial = true;
    }
  }

  const partialMark = `<span style="font-size:0.7rem;color:var(--color-text-muted)" title="partial estimate — some sources have no exchange rate">~</span>`;

  const freqLabel = (f: IncomeFrequency) => `/ ${FREQUENCY_LABELS[f].toLowerCase()}`;

  function renderCard(s: IncomeSource, dimmed = false): string {
    const baseEquiv = s.currency !== currency && s.exchangeRate != null
      ? `<div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:0.2rem">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(toMonthlyAmount(s) * s.exchangeRate!))} / month</div>`
      : '';
    const endedNote = s.endDate
      ? `<div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.15rem">ended ${escapeHtml(s.endDate)}</div>`
      : '';
    return `
    <div class="card" style="margin-bottom:0.5rem;padding:0.75rem 1rem;${dimmed ? 'opacity:0.5' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem">
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.95rem">${escapeHtml(s.name ?? INCOME_TYPE_LABELS[s.type] + ' income')}</div>
          <div style="font-size:0.875rem;color:var(--color-accent);margin-top:0.25rem">${escapeHtml(s.currency)} ${escapeHtml(fmt(s.amount))} ${escapeHtml(freqLabel(s.frequency))}</div>
          ${baseEquiv}${endedNote}
        </div>
        <button onclick="openEdit('${escapeHtml(s.id)}')" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);font-size:1rem;padding:0.25rem">✏️</button>
      </div>
    </div>`;
  }

  function renderGroup(label: string, items: IncomeSource[], dimmed = false): string {
    if (items.length === 0) return '';
    return `
    <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted);margin:1rem 0 0.4rem">
      ${escapeHtml(label)}
    </div>
    ${items.map(s => renderCard(s, dimmed)).join('')}`;
  }

  const grouped = INCOME_TYPES.map(t => renderGroup(INCOME_TYPE_LABELS[t], activeSources.filter(s => s.type === t)));
  const endedGroup = renderGroup('Ended', endedSources, true);

  const emptyState = sources.length === 0
    ? `<div class="card" style="text-align:center;padding:2rem 1rem;color:var(--color-text-muted)">
        No income sources yet.<br>
        <button onclick="openAdd()" style="margin-top:0.75rem;background:none;border:none;color:var(--color-accent);cursor:pointer;font-size:0.95rem;text-decoration:underline">Add one →</button>
      </div>`
    : '';

  // Edit panels for each source
  const editPanels = sources.map(s => {
    const typeOptions = INCOME_TYPES.map(t =>
      `<option value="${t}"${s.type === t ? ' selected' : ''}>${escapeHtml(INCOME_TYPE_LABELS[t])}</option>`).join('');
    const freqOptions = FREQUENCIES.map(f =>
      `<option value="${f}"${s.frequency === f ? ' selected' : ''}>${escapeHtml(FREQUENCY_LABELS[f])}</option>`).join('');
    const fxRow = s.currency !== currency
      ? `<div class="form-group" id="edit-fx-group-${escapeHtml(s.id)}">
          <label>Exchange Rate <span style="font-size:0.75rem;color:var(--color-text-muted)">(1 ${escapeHtml(s.currency)} = ? ${escapeHtml(currency)})</span></label>
          <input name="exchangeRate" id="edit-fx-${escapeHtml(s.id)}" type="number" step="0.000001" min="0.000001" placeholder="Auto-fetched" value="${escapeHtml(String(s.exchangeRate ?? ''))}">
          <div id="edit-fx-status-${escapeHtml(s.id)}" style="font-size:0.75rem;color:var(--color-text-muted)"></div>
        </div>`
      : '';
    return `
    <div class="panel-overlay" id="edit-panel-${escapeHtml(s.id)}" onclick="closeEdit('${escapeHtml(s.id)}')">
      <div class="panel-sheet panel-scroll" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Edit Income Source</div>
          <button type="button" onclick="closeEdit('${escapeHtml(s.id)}')" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/income/${escapeHtml(s.id)}">
          <div class="form-group">
            <label>Type</label>
            <select name="type">${typeOptions}</select>
          </div>
          <div class="form-group">
            <label>Name <span style="color:var(--color-text-muted);font-size:0.8rem">(optional)</span></label>
            <input name="name" type="text" value="${escapeHtml(s.name ?? '')}" maxlength="100">
          </div>
          <div class="form-group">
            <label>Currency</label>
            <input type="text" value="${escapeHtml(s.currency)}" disabled style="opacity:0.6">
          </div>
          <div class="form-group">
            <label>Amount</label>
            <input name="amount" type="number" step="0.01" min="0.01" value="${escapeHtml(String(s.amount))}" required>
          </div>
          ${fxRow}
          <div class="form-group">
            <label>Frequency</label>
            <select name="frequency">${freqOptions}</select>
          </div>
          <div class="form-group">
            <label>Start Date <span style="color:var(--color-text-muted);font-size:0.8rem">(optional)</span></label>
            <input name="startDate" type="date" value="${escapeHtml(s.startDate ?? '')}">
          </div>
          <div class="form-group">
            <label>End Date <span style="color:var(--color-text-muted);font-size:0.8rem">(leave blank if still active)</span></label>
            <input name="endDate" type="date" value="${escapeHtml(s.endDate ?? '')}">
          </div>
          <div class="form-group">
            <label>Notes <span style="color:var(--color-text-muted);font-size:0.8rem">(optional)</span></label>
            <textarea name="notes" rows="2" maxlength="500">${escapeHtml(s.notes ?? '')}</textarea>
          </div>
          <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.5rem">Save Changes</button>
        </form>
        <form method="POST" action="/income/${escapeHtml(s.id)}/delete" onsubmit="return confirm('Delete this income source?')">
          <button type="submit" class="btn-danger">Delete</button>
        </form>
      </div>
    </div>`;
  }).join('');

  const typeOptionsAdd = INCOME_TYPES.map(t => `<option value="${t}">${escapeHtml(INCOME_TYPE_LABELS[t])}</option>`).join('');
  const currencyOptionsAdd = CURRENCIES.map(c => `<option value="${c}"${c === currency ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const freqOptionsAdd = FREQUENCIES.map(f => `<option value="${f}">${escapeHtml(FREQUENCY_LABELS[f])}</option>`).join('');

  const addPanel = `
  <div class="panel-overlay" id="add-panel" onclick="closeAdd()">
    <div class="panel-sheet panel-scroll" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <div style="font-weight:600;font-size:1rem">Add Income Source</div>
        <button type="button" onclick="closeAdd()" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
      </div>
      <form method="POST" action="/income">
        <div class="form-group">
          <label>Type</label>
          <select name="type" id="add-type" onchange="syncAddFx()">${typeOptionsAdd}</select>
        </div>
        <div class="form-group">
          <label>Name <span style="color:var(--color-text-muted);font-size:0.8rem">(optional — auto-generated if blank)</span></label>
          <input name="name" type="text" maxlength="100" placeholder="e.g. Main job">
        </div>
        <div style="display:flex;flex-direction:row;gap:0.5rem;align-items:flex-end;margin-bottom:1rem">
          <div style="flex:0 0 7rem">
            <label style="display:block;font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.4rem">Currency</label>
            <select name="currency" id="add-currency" onchange="syncAddFx()">${currencyOptionsAdd}</select>
          </div>
          <div style="flex:1">
            <label style="display:block;font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.4rem">Amount</label>
            <input name="amount" id="add-amount" type="number" step="0.01" min="0.01" required placeholder="0.00">
          </div>
        </div>
        <div class="form-group" id="add-fx-group" style="display:none">
          <label>Exchange Rate <span id="add-fx-label" style="font-size:0.75rem;color:var(--color-text-muted)"></span></label>
          <input name="exchangeRate" id="add-fx-input" type="number" step="0.000001" min="0.000001" placeholder="Auto-fetched">
          <div id="add-fx-status" style="font-size:0.75rem;color:var(--color-text-muted)"></div>
        </div>
        <div class="form-group">
          <label>Frequency</label>
          <select name="frequency">${freqOptionsAdd}</select>
        </div>
        <div class="form-group">
          <label>Start Date <span style="color:var(--color-text-muted);font-size:0.8rem">(optional)</span></label>
          <input name="startDate" type="date">
        </div>
        <div class="form-group">
          <label>Notes <span style="color:var(--color-text-muted);font-size:0.8rem">(optional)</span></label>
          <textarea name="notes" rows="2" maxlength="500"></textarea>
        </div>
        <button type="submit" class="btn-primary" style="width:100%">Add Income Source</button>
      </form>
    </div>
  </div>`;

  const errorQs = new URLSearchParams(event.rawQueryString ?? '');
  const errorBanner = errorQs.get('error')
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">Invalid input — please check amount and frequency.</div>`
    : '';

  const body = `
  ${errorBanner}
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
    <h2 style="font-size:1.15rem;font-weight:700">Income</h2>
    <button onclick="openAdd()" class="btn-primary" style="font-size:0.85rem;padding:0.4rem 0.85rem">+ Add</button>
  </div>

  ${activeSources.length > 0 ? `
  <div class="card" style="margin-bottom:1rem;padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:0.82rem;color:var(--color-text-muted)">Est. monthly income</div>
    <div style="font-size:1rem;font-weight:700;color:var(--color-accent)">${escapeHtml(currency)} ${escapeHtml(fmt(monthlyTotal))}${monthlyPartial ? partialMark : ''}</div>
  </div>` : ''}

  ${emptyState}
  ${grouped.join('')}
  ${endedGroup}

  ${addPanel}
  ${editPanels}

  <script>
    var _baseCurrency = '${escapeHtml(currency)}';
    function openAdd(){ document.getElementById('add-panel').classList.add('open'); }
    function closeAdd(){ document.getElementById('add-panel').classList.remove('open'); }
    function openEdit(id){ document.getElementById('edit-panel-'+id).classList.add('open'); }
    function closeEdit(id){ document.getElementById('edit-panel-'+id).classList.remove('open'); }

    function _fetchRate(from, to, inputEl, statusEl, labelEl) {
      if(!from || from === to){ if(labelEl) labelEl.textContent=''; return; }
      if(labelEl) labelEl.textContent = '(1 '+from+' = ? '+to+')';
      statusEl.textContent = 'Fetching…';
      var today = '${escapeHtml(today)}';
      fetch('/fx-rate?from='+from+'&to='+to+'&date='+today)
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(d.rate){ inputEl.value = d.rate; statusEl.textContent = 'Rate as of '+d.date; }
          else { statusEl.textContent = 'Could not fetch rate'; }
        })
        .catch(function(){ statusEl.textContent = 'Could not fetch rate'; });
    }

    function syncAddFx() {
      var cur = document.getElementById('add-currency').value;
      var grp = document.getElementById('add-fx-group');
      var inp = document.getElementById('add-fx-input');
      var sta = document.getElementById('add-fx-status');
      var lbl = document.getElementById('add-fx-label');
      if(cur && cur !== _baseCurrency){
        grp.style.display = '';
        inp.value = '';
        _fetchRate(cur, _baseCurrency, inp, sta, lbl);
      } else {
        grp.style.display = 'none';
      }
    }
    // Run on load in case base currency is not default
    syncAddFx();
  </script>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: renderPage({
      title: 'Income — kopi-wealth',
      body,
      page: 'cash-flow',
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
