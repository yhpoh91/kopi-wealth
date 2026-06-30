import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getLiability, queryByUser, putLiability, updateLiability, softDelete, putSnapshot } from '../repositories/liability';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { clock } from '../lib/clock';
import { calcLiabilityStatus } from '../lib/finance/liability';
import type { LiabilityType } from '../types/liability';

const LIABILITY_TYPES: LiabilityType[] = ['mortgage', 'personal_loan', 'car_loan', 'student_loan', 'credit_card', 'other'];
const LIABILITY_TYPE_LABELS: Record<LiabilityType, string> = {
  mortgage: 'Mortgage',
  personal_loan: 'Personal Loan',
  car_loan: 'Car Loan',
  student_loan: 'Student Loan',
  credit_card: 'Credit Card',
  other: 'Other',
};
const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];

const fmt = (n: number) =>
  n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABELS = { outstanding: 'Outstanding', partially_returned: 'Partial', settled: 'Settled' };
const STATUS_COLORS = { outstanding: 'var(--color-error)', partially_returned: 'var(--color-accent)', settled: 'var(--color-text-muted)' };

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const pathParts = event.rawPath.split('/').filter(Boolean);
  const liabId = pathParts[1];
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

    if (liabId && action === 'delete') {
      const now = clock.nowIso();
      await softDelete(auth.session.sub, liabId, auth.session.sub, now);
      return redirect('/liabilities');
    }

    if (liabId) {
      // Update outstanding balance
      const outstandingAmount = parseFloat(params.outstandingAmount ?? '');
      if (isNaN(outstandingAmount) || outstandingAmount < 0) return redirect('/liabilities?error=invalid');
      const now = clock.nowIso();
      const existing = await getLiability(auth.session.sub, liabId);
      if (!existing || existing.deletedAt) return redirect('/liabilities?error=not_found');
      const status = calcLiabilityStatus(existing.originalAmount, outstandingAmount);
      await updateLiability(auth.session.sub, liabId, {
        outstandingAmount,
        status,
        updatedAt: now,
        GSI1SK: `LIAB#${now}`,
      });
      await putSnapshot({
        PK: `LIAB_SNAP#${liabId}`,
        SK: `SNAP#${now}#${randomUUID()}`,
        liabId,
        outstandingAmount,
        status,
        recordedAt: now,
        createdAt: now,
      });
      return redirect('/liabilities');
    }

    // Create
    const name = (params.name ?? '').trim().slice(0, 100);
    const type = LIABILITY_TYPES.includes(params.type as LiabilityType) ? (params.type as LiabilityType) : null;
    const currency = (params.currency ?? '').trim().toUpperCase().slice(0, 10);
    const originalAmount = parseFloat(params.originalAmount ?? '');
    const outstandingRaw = params.outstandingAmount !== '' ? parseFloat(params.outstandingAmount ?? '') : NaN;
    const outstandingAmount = isNaN(outstandingRaw) ? originalAmount : outstandingRaw;

    if (!name || !type || !currency || isNaN(originalAmount) || originalAmount <= 0 || outstandingAmount < 0) {
      return redirect('/liabilities?error=invalid');
    }

    const now = clock.nowIso();
    const id = randomUUID();
    const status = calcLiabilityStatus(originalAmount, outstandingAmount);
    await putLiability({
      PK: `LIAB#${auth.session.sub}`,
      SK: `LIAB#${id}`,
      GSI1PK: `USER#${auth.session.sub}`,
      GSI1SK: `LIAB#${now}`,
      id,
      sub: auth.session.sub,
      name,
      type,
      currency,
      originalAmount,
      outstandingAmount,
      status,
      createdAt: now,
      updatedAt: now,
    });
    await putSnapshot({
      PK: `LIAB_SNAP#${id}`,
      SK: `SNAP#${now}#${randomUUID()}`,
      liabId: id,
      outstandingAmount,
      status,
      recordedAt: now,
      createdAt: now,
    });
    return redirect('/liabilities');
  }

  // GET
  const currency = settings?.currency ?? 'SGD';
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorParam = qs.get('error');
  const errorBanner = errorParam
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">${errorParam === 'not_found' ? 'Liability not found.' : 'Please enter valid values.'}</div>`
    : '';

  const liabilities = await queryByUser(auth.session.sub);

  // Sort: active (outstanding/partially_returned) by updatedAt desc, settled at bottom by updatedAt desc
  const active = liabilities
    .filter((l) => l.status !== 'settled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const settled = liabilities
    .filter((l) => l.status === 'settled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sorted = [...active, ...settled];

  // Compute total outstanding in display currency
  const foreignCurrencies = [...new Set(liabilities.filter((l) => l.currency !== currency).map((l) => l.currency))];
  let rates: Record<string, number> = {};
  let ratesDate: string | undefined;
  let fxFailed = false;
  if (foreignCurrencies.length > 0) {
    try {
      ({ rates, date: ratesDate } = await getOrFetchRates(currency));
    } catch {
      fxFailed = true;
    }
  }

  let liabTotal = 0;
  let partial = false;
  for (const l of liabilities.filter((l) => l.status !== 'settled')) {
    if (l.currency === currency) {
      liabTotal += l.outstandingAmount;
    } else {
      const converted = convertAmount(l.outstandingAmount, l.currency, currency, rates);
      if (converted === null) { partial = true; } else { liabTotal += converted; }
    }
  }
  const partialNote = (fxFailed || partial) ? ' <span style="font-size:0.7rem;color:var(--color-text-muted)">(partial)</span>' : '';
  const activeCount = liabilities.filter((l) => l.status !== 'settled').length;
  const hasAnySameCurrency = liabilities.some((l) => l.status !== 'settled' && l.currency === currency);
  const totalDisplay = activeCount === 0
    ? '—'
    : (fxFailed || partial) && !hasAnySameCurrency && liabTotal === 0
      ? `— ${partialNote}`
      : `${escapeHtml(currency)} ${escapeHtml(fmt(liabTotal))}${partialNote}`;

  const liabilityCards = sorted.map((l) => {
    const isSettled = l.status === 'settled';
    const pct = l.originalAmount > 0
      ? Math.max(0, Math.min(100, ((l.originalAmount - Math.min(l.outstandingAmount, l.originalAmount)) / l.originalAmount) * 100))
      : 0;
    const isForeign = l.currency !== currency;
    const convertedOutstanding = isForeign ? convertAmount(l.outstandingAmount, l.currency, currency, rates) : null;
    const rate = isForeign && !fxFailed ? rates[l.currency] : undefined;
    const rateLabel = rate !== undefined
      ? `1 ${escapeHtml(l.currency)} = ${escapeHtml((1 / rate).toLocaleString('en-SG', { minimumFractionDigits: 4, maximumFractionDigits: 4 }))} ${escapeHtml(currency)}`
      : '';
    const tooltipText = ratesDate ? `Rate as of ${escapeHtml(ratesDate)}` : 'Rate unavailable';
    const rateInfo = rateLabel
      ? ` <span style="position:relative;display:inline-block;cursor:help" tabindex="0">ℹ️<span style="display:none;position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#333;color:#fff;font-size:0.65rem;white-space:nowrap;padding:0.2rem 0.4rem;border-radius:0.3rem;pointer-events:none" class="fx-tip">${tooltipText}</span></span>`
      : '';
    const convertedLine = isForeign
      ? convertedOutstanding !== null
        ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(convertedOutstanding))} <span style="opacity:0.7">(${rateLabel})</span>${rateInfo}</div>`
        : `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} —</div>`
      : '';
    return `
    <div class="card" style="margin-bottom:0.75rem${isSettled ? ';opacity:0.6' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem">
        <div>
          <div style="font-weight:600;font-size:0.95rem">${escapeHtml(l.name)}</div>
          <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">${escapeHtml(LIABILITY_TYPE_LABELS[l.type])}</div>
        </div>
        <span style="font-size:0.7rem;font-weight:600;color:${STATUS_COLORS[l.status]};white-space:nowrap;margin-top:0.15rem">${STATUS_LABELS[l.status]}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:${isSettled ? '0' : '0.5rem'}">
        <div>
          <div style="font-size:0.65rem;color:var(--color-text-muted)">Outstanding</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent)">${escapeHtml(l.currency)} ${escapeHtml(fmt(l.outstandingAmount))}</div>
          ${convertedLine}
        </div>
        <div style="text-align:right">
          <div style="font-size:0.65rem;color:var(--color-text-muted)">Original</div>
          <div style="font-size:0.85rem;color:var(--color-text-muted)">${escapeHtml(l.currency)} ${escapeHtml(fmt(l.originalAmount))}</div>
        </div>
      </div>
      ${!isSettled ? `
      <div style="background:var(--color-border);border-radius:999px;height:4px;overflow:hidden;margin-bottom:0.5rem">
        <div style="background:var(--color-accent);height:100%;width:${escapeHtml(pct.toFixed(1))}%;border-radius:999px"></div>
      </div>` : ''}
      <div style="display:flex;gap:0.5rem;justify-content:flex-end">
        <button class="btn-ghost" style="font-size:0.8rem;padding:0.3rem 0.75rem"
          onclick="openEdit('${escapeHtml(l.id)}','${escapeHtml(l.name)}',${l.outstandingAmount})">Edit</button>
        <button class="btn-ghost" style="font-size:0.8rem;padding:0.3rem 0.75rem;color:var(--color-error);border-color:var(--color-error)"
          onclick="openDelete('${escapeHtml(l.id)}','${escapeHtml(l.name)}')">Delete</button>
      </div>
    </div>`;
  }).join('');

  const emptyState = liabilities.length === 0
    ? `<div class="card" style="text-align:center;color:var(--color-text-muted);padding:1.5rem 1rem;margin-bottom:1rem">No liabilities yet. Tap <strong>Add</strong> to track a loan or debt.</div>`
    : '';

  const typeOptions = LIABILITY_TYPES.map((t) => `<option value="${t}">${LIABILITY_TYPE_LABELS[t]}</option>`).join('');
  const currencyOptions = CURRENCIES.map((c) => `<option value="${c}"${c === currency ? ' selected' : ''}>${c}</option>`).join('');

  const addPanel = `
    <div class="panel-overlay" id="add-overlay" onclick="document.getElementById('add-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Add Liability</div>
          <button type="button" onclick="document.getElementById('add-overlay').classList.remove('open')"
            style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/liabilities">
          <div class="form-group">
            <label>Name</label>
            <input name="name" type="text" required maxlength="100" placeholder="e.g. Home Loan">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Type</label>
              <select name="type" required>${typeOptions}</select>
            </div>
            <div class="form-group">
              <label>Currency</label>
              <select name="currency" required>${currencyOptions}</select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Original amount</label>
              <input name="originalAmount" type="number" step="0.01" min="0.01" required placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Outstanding <span style="font-weight:400;color:var(--color-text-muted)">(optional)</span></label>
              <input name="outstandingAmount" type="number" step="0.01" min="0" placeholder="Same as original">
            </div>
          </div>
          <button type="submit" class="btn-primary" style="width:100%">Add</button>
        </form>
      </div>
    </div>`;

  const editPanel = `
    <div class="panel-overlay" id="edit-overlay" onclick="document.getElementById('edit-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem" id="edit-title">Update Balance</div>
          <button type="button" onclick="document.getElementById('edit-overlay').classList.remove('open')"
            style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" id="edit-form">
          <div class="form-group">
            <label>Outstanding amount</label>
            <input name="outstandingAmount" id="edit-outstanding" type="number" step="0.01" min="0" required placeholder="0.00">
          </div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:1rem">Enter 0 to mark as settled.</div>
          <button type="submit" class="btn-primary" style="width:100%">Save</button>
        </form>
      </div>
    </div>`;

  const deletePanel = `
    <div class="panel-overlay" id="delete-overlay" onclick="document.getElementById('delete-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="font-weight:600;font-size:1rem;margin-bottom:0.5rem">Delete liability?</div>
        <div style="font-size:0.875rem;color:var(--color-text-muted);margin-bottom:1.25rem" id="delete-name"></div>
        <form method="POST" id="delete-form">
          <div style="display:flex;gap:0.75rem">
            <button type="button" class="btn-ghost" style="flex:1"
              onclick="document.getElementById('delete-overlay').classList.remove('open')">Cancel</button>
            <button type="submit" class="btn-primary" style="flex:1;background:var(--color-error)">Delete</button>
          </div>
        </form>
      </div>
    </div>`;

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem">Liabilities</h2>
        <button type="button" class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem"
          onclick="document.getElementById('add-overlay').classList.add('open')">Add</button>
      </div>
      ${errorBanner}
      <div class="card" style="margin-bottom:1.25rem">
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.25rem">Total Outstanding (active)</div>
        <div style="font-size:1.75rem;font-weight:700;color:var(--color-error)">${totalDisplay}</div>
      </div>
      ${emptyState}
      ${liabilityCards}
    </div>
    ${addPanel}
    ${editPanel}
    ${deletePanel}
    <script>
      function openEdit(id, name, outstanding) {
        document.getElementById('edit-title').textContent = 'Update — ' + name;
        document.getElementById('edit-form').action = '/liabilities/' + id;
        document.getElementById('edit-outstanding').value = outstanding;
        document.getElementById('edit-overlay').classList.add('open');
      }
      function openDelete(id, name) {
        document.getElementById('delete-name').textContent = name;
        document.getElementById('delete-form').action = '/liabilities/' + id + '/delete';
        document.getElementById('delete-overlay').classList.add('open');
      }
    </script>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Liabilities — kopi-wealth',
      body,
      page: 'liabilities',
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
