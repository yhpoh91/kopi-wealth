import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getAccount, queryByUser, putAccount, updateBalance, softDelete, putSnapshot } from '../repositories/account';
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
  // /accounts → pathParts = ['accounts']
  // /accounts/:id → pathParts = ['accounts', id]
  // /accounts/:id/delete → pathParts = ['accounts', id, 'delete']
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
      const balance = parseFloat(params.balance ?? '');
      if (isNaN(balance) || balance < 0) return redirect('/accounts?error=invalid_balance');
      const now = new Date().toISOString();
      const account = await getAccount(auth.session.sub, accountId);
      if (!account || account.deletedAt) return redirect('/accounts?error=not_found');
      await updateBalance(auth.session.sub, accountId, balance, now);
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

  const accountCards = accounts.length === 0
    ? `<div class="card" style="text-align:center;color:var(--color-text-muted);padding:2rem 1rem">
        No accounts yet. Add your first account below.
       </div>`
    : accounts.map((a) => `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem">
          <div style="min-width:0;flex:1">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
            <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.1rem">
              ${escapeHtml(ACCOUNT_TYPE_LABELS[a.type])}${a.institution ? ' · ' + escapeHtml(a.institution) : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent)">${escapeHtml(a.currency)} ${a.balance.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        <div id="edit-${escapeHtml(a.id)}" style="display:none;margin-top:0.75rem">
          <form method="POST" action="/accounts/${escapeHtml(a.id)}" style="display:flex;gap:0.5rem;align-items:center">
            <input name="balance" type="number" step="0.01" min="0" value="${a.balance}" style="flex:1;min-width:0">
            <button type="submit" class="btn-primary" style="padding:0.4rem 0.9rem;white-space:nowrap">Save</button>
            <button type="button" onclick="document.getElementById('edit-${escapeHtml(a.id)}').style.display='none'" style="padding:0.4rem 0.6rem;background:var(--color-surface-2,rgba(255,255,255,.08));border:1px solid var(--color-border,rgba(255,255,255,.12));border-radius:0.375rem;color:var(--color-text-muted);cursor:pointer;font-size:0.8rem">✕</button>
          </form>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
          <button type="button"
            onclick="var el=document.getElementById('edit-${escapeHtml(a.id)}');el.style.display=el.style.display==='none'?'block':'none'"
            style="flex:1;padding:0.35rem 0.75rem;font-size:0.8rem;background:var(--color-surface-2,rgba(255,255,255,.08));border:1px solid var(--color-border,rgba(255,255,255,.12));border-radius:0.375rem;color:var(--color-text-muted);cursor:pointer">
            Edit balance
          </button>
          <form method="POST" action="/accounts/${escapeHtml(a.id)}/delete"
            onsubmit="return confirm('Delete ${escapeHtml(a.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}?')" style="margin:0">
            <button type="submit"
              style="padding:0.35rem 0.75rem;font-size:0.8rem;background:transparent;border:1px solid var(--color-error);border-radius:0.375rem;color:var(--color-error);cursor:pointer">
              Delete
            </button>
          </form>
        </div>
      </div>`).join('');

  const typeOptions = ACCOUNT_TYPES.map(
    (t) => `<option value="${t}">${escapeHtml(ACCOUNT_TYPE_LABELS[t])}</option>`,
  ).join('');
  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}"${c === currency ? ' selected' : ''}>${escapeHtml(c)}</option>`,
  ).join('');

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.3rem;margin-bottom:1.5rem">Accounts</h2>

      ${errorBanner}
      ${accountCards}

      <div class="card" style="margin-top:1.5rem">
        <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:1rem">Add Account</h3>
        <form method="POST" action="/accounts">
          <div class="form-group">
            <label for="name">Account Name</label>
            <input id="name" name="name" type="text" required placeholder="e.g. DBS Multiplier">
          </div>
          <div class="form-group">
            <label for="type">Type</label>
            <select id="type" name="type">${typeOptions}</select>
          </div>
          <div class="form-group">
            <label for="institution">Institution (optional)</label>
            <input id="institution" name="institution" type="text" placeholder="e.g. DBS">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label for="currency">Currency</label>
              <select id="currency" name="currency">${currencyOptions}</select>
            </div>
            <div class="form-group">
              <label for="balance">Balance</label>
              <input id="balance" name="balance" type="number" step="0.01" min="0" required placeholder="0.00">
            </div>
          </div>
          <div class="form-group">
            <label for="notes">Notes (optional)</label>
            <input id="notes" name="notes" type="text" placeholder="">
          </div>
          <button type="submit" class="btn-primary" style="width:100%">Add Account</button>
        </form>
      </div>
    </div>`;

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
