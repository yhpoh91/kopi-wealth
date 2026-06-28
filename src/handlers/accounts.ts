import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getAccount, queryByUser, putAccount, updateAccount, softDelete, putSnapshot } from '../repositories/account';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import type { AccountType } from '../types/account';

const ACCOUNT_TYPES: AccountType[] = ['savings', 'checking', 'fixed_deposit', 'cash'];
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: 'Savings',
  checking: 'Checking',
  fixed_deposit: 'Fixed Deposit',
  cash: 'Cash',
};
const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const pathParts = event.rawPath.split('/').filter(Boolean);
  // /accounts → ['accounts']
  // /accounts/:id → ['accounts', id]
  // /accounts/:id/delete → ['accounts', id, 'delete']
  const accountId = pathParts[1];
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

    if (accountId && action === 'delete') {
      const now = new Date().toISOString();
      await softDelete(auth.session.sub, accountId, auth.session.sub, now);
      return redirect('/accounts');
    }

    if (accountId) {
      const name = (params.name ?? '').trim().slice(0, 100);
      const type = ACCOUNT_TYPES.includes(params.type as AccountType) ? (params.type as AccountType) : null;
      const balance = parseFloat(params.balance ?? '');
      const institution = (params.institution ?? '').trim().slice(0, 100) || undefined;
      const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
      if (!name || !type || isNaN(balance) || balance < 0) return redirect('/accounts?error=invalid_balance');
      const now = new Date().toISOString();
      const account = await getAccount(auth.session.sub, accountId);
      if (!account || account.deletedAt) return redirect('/accounts?error=not_found');
      await updateAccount(auth.session.sub, accountId, { name, type, balance, institution, notes }, now);
      await putSnapshot({
        PK: `ACCT_SNAP#${accountId}`,
        SK: `SNAP#${now}#${randomUUID()}`,
        accountId,
        balance,
        recordedAt: now,
        createdAt: now,
      });
      return redirect('/accounts');
    }

    // Create
    const name = (params.name ?? '').trim().slice(0, 100);
    const type = ACCOUNT_TYPES.includes(params.type as AccountType) ? (params.type as AccountType) : null;
    const currency = CURRENCIES.includes(params.currency) ? params.currency : null;
    const balance = parseFloat(params.balance ?? '');
    const institution = (params.institution ?? '').trim().slice(0, 100) || undefined;
    const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;

    if (!name || !type || !currency || isNaN(balance) || balance < 0) return redirect(`/accounts?error=invalid&name=${encodeURIComponent(params.name ?? '')}&type=${encodeURIComponent(params.type ?? '')}&currency=${encodeURIComponent(params.currency ?? '')}&balance=${encodeURIComponent(params.balance ?? '')}`);

    const id = randomUUID();
    const now = new Date().toISOString();
    await putAccount({
      PK: `ACCOUNT#${auth.session.sub}`,
      SK: `ACCOUNT#${id}`,
      GSI1PK: `USER#${auth.session.sub}`,
      GSI1SK: `ACCOUNT#${now}`,
      id,
      sub: auth.session.sub,
      name,
      type,
      balance,
      currency,
      institution,
      notes,
      createdAt: now,
      updatedAt: now,
    });
    await putSnapshot({
      PK: `ACCT_SNAP#${id}`,
      SK: `SNAP#${now}#${randomUUID()}`,
      accountId: id,
      balance,
      recordedAt: now,
      createdAt: now,
    });
    return redirect('/accounts');
  }

  // GET
  const accounts = await queryByUser(auth.session.sub);
  const currency = settings?.currency ?? 'SGD';
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorParam = qs.get('error');
  const errorBanner = errorParam
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">
        Validation failed (${escapeHtml(errorParam)}): name="${escapeHtml(qs.get('name') ?? '')}" type="${escapeHtml(qs.get('type') ?? '')}" currency="${escapeHtml(qs.get('currency') ?? '')}" balance="${escapeHtml(qs.get('balance') ?? '')}"
       </div>`
    : '';

  // FX conversion for summary
  let rates: Record<string, number> = {};
  let fxFailed = false;
  const foreignCurrencies = [...new Set(accounts.map((a) => a.currency).filter((c) => c !== currency))];
  if (foreignCurrencies.length > 0) {
    try { rates = await getOrFetchRates(currency); } catch { fxFailed = true; }
  }

  // Compute totals per type and grand total
  let grandTotal = 0;
  let grandPartial = false;
  const typeTotals: Partial<Record<AccountType, { total: number; partial: boolean }>> = {};
  for (const a of accounts) {
    const converted = convertAmount(a.balance, a.currency, currency, rates);
    const amount = converted ?? 0;
    const partial = converted === null || fxFailed;
    grandTotal += amount;
    if (partial) grandPartial = true;
    const prev = typeTotals[a.type] ?? { total: 0, partial: false };
    typeTotals[a.type] = { total: prev.total + amount, partial: prev.partial || partial };
  }

  const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partialNote = `<span style="font-size:0.7rem;color:var(--color-text-muted)"> (partial)</span>`;

  const typeBreakdown = ACCOUNT_TYPES
    .filter((t) => typeTotals[t])
    .map((t) => {
      const { total, partial } = typeTotals[t]!;
      return `<span style="white-space:nowrap">${escapeHtml(ACCOUNT_TYPE_LABELS[t])} ${escapeHtml(currency)} ${escapeHtml(fmt(total))}${partial ? partialNote : ''}</span>`;
    }).join('<span style="color:var(--color-border);margin:0 0.4rem">·</span>');

  const summaryBar = accounts.length === 0 ? '' : `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.25rem">Total Balance</div>
      <div style="font-size:1.5rem;font-weight:700;color:var(--color-accent)">${escapeHtml(currency)} ${escapeHtml(fmt(grandTotal))}${grandPartial ? partialNote : ''}</div>
      ${typeBreakdown ? `<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.25rem 0">${typeBreakdown}</div>` : ''}
    </div>`;

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  };

  const renderCard = (a: (typeof accounts)[0]) => {
    const typeOpts = ACCOUNT_TYPES.map(
      (t) => `<option value="${t}"${t === a.type ? ' selected' : ''}>${escapeHtml(ACCOUNT_TYPE_LABELS[t])}</option>`,
    ).join('');
    const isForeign = a.currency !== currency;
    const converted = isForeign ? convertAmount(a.balance, a.currency, currency, rates) : null;
    const convertedLine = isForeign
      ? converted !== null
        ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(converted))}</div>`
        : `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">≈ ${escapeHtml(currency)} —</div>`
      : '';

    return `
    <div class="card" style="cursor:default">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
          <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.15rem">
            ${escapeHtml(ACCOUNT_TYPE_LABELS[a.type])}${a.institution ? ' · ' + escapeHtml(a.institution) : ''}
          </div>
          ${a.notes ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.notes)}</div>` : ''}
        </div>
        <button type="button" onclick="openAcctPanel('${escapeHtml(a.id)}')" title="Edit account"
          style="flex-shrink:0;padding:0.2rem 0.3rem;background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:0.9rem;opacity:0.5;line-height:1;transition:opacity 0.12s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">✏️</button>
      </div>
      <div style="margin-top:0.5rem">
        <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent)">${escapeHtml(a.currency)} ${escapeHtml(fmt(a.balance))}</div>
        ${convertedLine}
      </div>
      <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.4rem">Updated ${escapeHtml(relativeTime(a.updatedAt))}</div>
    </div>

    <div class="panel-overlay" id="acct-overlay-${escapeHtml(a.id)}" onclick="closeAcctPanel('${escapeHtml(a.id)}')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">${escapeHtml(a.name)}</div>
          <button type="button" onclick="closeAcctPanel('${escapeHtml(a.id)}')" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/accounts/${escapeHtml(a.id)}">
          <div class="form-group">
            <label>Account Name</label>
            <input name="name" type="text" required value="${escapeHtml(a.name)}">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">${typeOpts}</select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Currency</label>
              <input type="text" value="${escapeHtml(a.currency)}" disabled style="opacity:0.6;cursor:not-allowed">
            </div>
            <div class="form-group">
              <label>Balance</label>
              <input name="balance" type="number" step="0.01" min="0" required value="${a.balance}">
            </div>
          </div>
          <div class="form-group">
            <label>Institution (optional)</label>
            <input name="institution" type="text" value="${escapeHtml(a.institution ?? '')}" placeholder="e.g. DBS">
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input name="notes" type="text" value="${escapeHtml(a.notes ?? '')}" placeholder="e.g. joint account">
          </div>
          <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.75rem">Save changes</button>
        </form>
        <form method="POST" action="/accounts/${escapeHtml(a.id)}/delete"
          onsubmit="return confirm('Delete ${escapeHtml(a.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}?')" style="text-align:center">
          <button type="submit" style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:0.85rem;padding:0.25rem 0">Delete account</button>
        </form>
      </div>
    </div>`;
  };

  const accountsContent = accounts.length === 0
    ? `<div style="grid-column:1/-1"><div class="card" style="text-align:center;color:var(--color-text-muted);padding:2rem 1rem">No accounts yet. Add your first account below.</div></div>`
    : ACCOUNT_TYPES
        .filter((t) => accounts.some((a) => a.type === t))
        .map((t) => {
          const group = accounts.filter((a) => a.type === t);
          const { total, partial } = typeTotals[t]!;
          return `
          <div style="grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;margin-top:0.75rem;margin-bottom:0.25rem">
            <div style="font-size:0.8rem;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(ACCOUNT_TYPE_LABELS[t])}</div>
            <div style="font-size:0.8rem;color:var(--color-text-muted)">${escapeHtml(currency)} ${escapeHtml(fmt(total))}${partial ? partialNote : ''}</div>
          </div>
          ${group.map(renderCard).join('')}`;
        }).join('');

  const typeOptions = ACCOUNT_TYPES.map(
    (t) => `<option value="${t}">${escapeHtml(ACCOUNT_TYPE_LABELS[t])}</option>`,
  ).join('');
  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}"${c === currency ? ' selected' : ''}>${escapeHtml(c)}</option>`,
  ).join('');

  const body = `
    <style>@media(min-width:600px){.acct-grid{grid-template-columns:repeat(2,1fr)!important}}</style>
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem">Accounts</h2>
        <button type="button" onclick="document.getElementById('add-overlay').classList.add('open')"
          class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">+ Add</button>
      </div>

      ${errorBanner}
      ${summaryBar}
      <div class="acct-grid" style="display:grid;grid-template-columns:1fr;gap:0.75rem">
        ${accountsContent}
      </div>
    </div>

    <!-- Add account panel -->
    <div class="panel-overlay" id="add-overlay" onclick="document.getElementById('add-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Add Account</div>
          <button type="button" onclick="document.getElementById('add-overlay').classList.remove('open')" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/accounts">
          <div class="form-group">
            <label>Account Name</label>
            <input name="name" type="text" required placeholder="e.g. DBS Multiplier">
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
              <label>Balance</label>
              <input name="balance" type="number" step="0.01" min="0" required placeholder="0.00">
            </div>
          </div>
          <div class="form-group">
            <label>Institution (optional)</label>
            <input name="institution" type="text" placeholder="e.g. DBS">
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input name="notes" type="text" placeholder="e.g. joint account">
          </div>
          <button type="submit" class="btn-primary" style="width:100%">Add Account</button>
        </form>
      </div>
    </div>

    <script>
      function openAcctPanel(id){document.getElementById('acct-overlay-'+id).classList.add('open');}
      function closeAcctPanel(id){document.getElementById('acct-overlay-'+id).classList.remove('open');}
    </script>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Accounts — kopi-wealth',
      body,
      page: 'accounts',
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
