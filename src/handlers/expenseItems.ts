import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getExpenseItem, queryByUser, putExpenseItem, updateExpenseItem, softDeleteExpenseItem } from '../repositories/expenseItem';
import { clock } from '../lib/clock';
import type { ExpenseItem } from '../types/expenseItem';
import { getAccountManagementUrl } from '../lib/account-management';

const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];

const fmt = (n: number) =>
  n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: '' };
}

function autoName(): string {
  const iso = clock.nowIso();
  const timePart = iso.slice(11, 16); // HH:MM from ISO string
  return `Expense at ${timePart}`;
}

function groupByDate(items: ExpenseItem[]): Array<{ date: string; label: string; items: ExpenseItem[] }> {
  const today = clock.today();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const groups: Record<string, ExpenseItem[]> = {};
  for (const item of items) {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, groupItems]) => {
      const d = new Date(date + 'T00:00:00');
      const formatted = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
      const label = date === today ? `Today, ${formatted}` : date === yStr ? `Yesterday, ${formatted}` : formatted;
      return { date, label, items: groupItems };
    });
}

function renderAddPanel(defaultCurrency: string, today: string, errorParam: string | null): string {
  const prefillName = '';
  return `
  <div class="panel-overlay" id="add-overlay" onclick="document.getElementById('add-overlay').classList.remove('open')">
    <div class="panel-sheet" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <div style="font-weight:600;font-size:1rem">Add Expense</div>
        <button type="button" onclick="document.getElementById('add-overlay').classList.remove('open')"
          style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
      </div>
      ${errorParam === 'invalid' ? `<div style="background:var(--color-error);color:#fff;padding:0.6rem 0.9rem;border-radius:0.4rem;margin-bottom:1rem;font-size:0.85rem">Please check the amount and date.</div>` : ''}
      <form method="POST" action="/expenses/items">
        <div class="form-group">
          <label>Name <span style="color:var(--color-text-muted);font-weight:400">(optional)</span></label>
          <input name="name" type="text" maxlength="100" placeholder="e.g. Lunch at hawker centre" value="${escapeHtml(prefillName)}">
          <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.25rem">Leave blank to auto-generate</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:0.75rem">
          <div class="form-group">
            <label>Currency</label>
            <select name="currency" style="color-scheme:inherit">
              ${CURRENCIES.map((c) => `<option value="${c}"${c === defaultCurrency ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Amount</label>
            <input name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00">
          </div>
        </div>
        <div class="form-group">
          <label>Date</label>
          <input name="date" type="date" value="${escapeHtml(today)}" max="${escapeHtml(today)}" required>
        </div>
        <div class="form-group" id="add-fx-group" style="display:none">
          <label>Exchange rate <span style="color:var(--color-text-muted);font-weight:400">(1 unit = X ${escapeHtml(defaultCurrency)})</span>
            <button type="button" id="add-fx-refresh" onclick="addFetchRate()"
              style="margin-left:0.4rem;background:none;border:none;color:var(--color-accent);cursor:pointer;font-size:0.8rem;padding:0">↻ Refresh</button>
          </label>
          <input name="exchangeRate" id="add-fx-input" type="number" step="0.000001" min="0.000001" placeholder="Auto-fetched">
          <div id="add-fx-status" style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.2rem"></div>
        </div>
        <div class="form-group">
          <label>Notes <span style="color:var(--color-text-muted);font-weight:400">(optional)</span></label>
          <input name="notes" type="text" maxlength="500" placeholder="">
        </div>
        <button type="submit" class="btn-primary" style="width:100%">Add Expense</button>
      </form>
    </div>
  </div>`;
}

function renderEditPanel(item: { id: string; name: string; amount: number; currency: string; date: string; notes?: string; exchangeRate?: number }, defaultCurrency: string): string {
  return `
  <div class="panel-overlay" id="edit-overlay-${escapeHtml(item.id)}" onclick="closeEditPanel('${escapeHtml(item.id)}')">
    <div class="panel-sheet" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <div style="font-weight:600;font-size:1rem">${escapeHtml(item.name)}</div>
        <button type="button" onclick="closeEditPanel('${escapeHtml(item.id)}')"
          style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
      </div>
      <form method="POST" action="/expenses/items/${escapeHtml(item.id)}">
        <input type="hidden" name="date" value="${escapeHtml(item.date)}">
        <div class="form-group">
          <label>Name</label>
          <input name="name" type="text" maxlength="100" required value="${escapeHtml(item.name)}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:0.75rem">
          <div class="form-group">
            <label>Currency</label>
            <input type="text" value="${escapeHtml(item.currency)}" disabled style="opacity:0.6;cursor:not-allowed">
          </div>
          <div class="form-group">
            <label>Amount</label>
            <input name="amount" type="number" step="0.01" min="0.01" required value="${escapeHtml(String(item.amount))}">
          </div>
        </div>
        <div class="form-group">
          <label>Date</label>
          <input name="editDate" type="date" value="${escapeHtml(item.date)}" max="${escapeHtml(clock.today())}">
        </div>
        ${item.currency !== defaultCurrency ? `
        <div class="form-group">
          <label>Exchange rate <span style="color:var(--color-text-muted);font-weight:400">(1 ${escapeHtml(item.currency)} = X ${escapeHtml(defaultCurrency)})</span>
            <button type="button" onclick="editFetchRate('${escapeHtml(item.id)}')"
              style="margin-left:0.4rem;background:none;border:none;color:var(--color-accent);cursor:pointer;font-size:0.8rem;padding:0">↻ Refresh</button>
          </label>
          <input name="exchangeRate" id="edit-fx-${escapeHtml(item.id)}" type="number" step="0.000001" min="0.000001"
            placeholder="Auto-fetched" value="${escapeHtml(String(item.exchangeRate ?? ''))}">
          <div id="edit-fx-status-${escapeHtml(item.id)}" style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.2rem"></div>
        </div>` : ''}
        <div class="form-group">
          <label>Notes</label>
          <input name="notes" type="text" maxlength="500" value="${escapeHtml(item.notes ?? '')}">
        </div>
        <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.75rem">Save changes</button>
      </form>
      <form method="POST" action="/expenses/items/${escapeHtml(item.id)}/delete"
        onsubmit="return confirm('Delete ${escapeHtml(item.name)}?')" style="text-align:center">
        <button type="submit"
          style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:0.85rem;padding:0.25rem 0">
          Delete expense
        </button>
      </form>
    </div>
  </div>`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const pathParts = event.rawPath.split('/').filter(Boolean);
  // /expenses/items → ['expenses', 'items']
  // /expenses/items/:id → ['expenses', 'items', id]
  // /expenses/items/:id/delete → ['expenses', 'items', id, 'delete']
  const itemId = pathParts[2];
  const action = pathParts[3];

  const [user, settings, accountManagementUrl] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
    getAccountManagementUrl(),
  ]);

  const currency = settings?.currency ?? 'SGD';

  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    if (itemId && action === 'delete') {
      // Need the item to find its date for the SK
      // We scan the PK for matching id since we don't have the date in the URL
      const { items: allItems } = await queryByUser(auth.session.sub, { limit: 1000 });
      const target = allItems.find((i) => i.id === itemId);
      if (target) {
        const now = clock.nowIso();
        await softDeleteExpenseItem(auth.session.sub, target.date, itemId, auth.session.sub, now);
      }
      return redirect('/expenses/items');
    }

    if (itemId) {
      // Update
      const name = (params.name ?? '').trim().slice(0, 100);
      const amount = parseFloat(params.amount ?? '');
      const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
      const rawExchangeRate = parseFloat(params.exchangeRate ?? '');
      const exchangeRate = !isNaN(rawExchangeRate) && rawExchangeRate > 0 ? rawExchangeRate : undefined;
      // date can be edited; but currency cannot change
      const editDate = (params.editDate ?? params.date ?? '').trim();
      if (!name || isNaN(amount) || amount <= 0) return redirect('/expenses/items?error=invalid');
      // Validate date: must not be in the future
      const today = clock.today();
      const dateToUse = editDate && editDate <= today ? editDate : today;

      // Find existing item
      const { items: allItems } = await queryByUser(auth.session.sub, { limit: 1000 });
      const existing = allItems.find((i) => i.id === itemId);
      if (!existing || existing.deletedAt) return redirect('/expenses/items?error=not_found');

      const now = clock.nowIso();

      // If date changed, we need to move the item (delete + recreate with new SK)
      if (dateToUse !== existing.date) {
        await softDeleteExpenseItem(auth.session.sub, existing.date, itemId, auth.session.sub, now);
        await putExpenseItem({
          ...existing,
          SK: `ITEM#${dateToUse}#${itemId}`,
          date: dateToUse,
          name,
          amount,
          exchangeRate,
          notes,
          updatedAt: now,
          deletedAt: undefined,
          deletedBy: undefined,
        });
      } else {
        await updateExpenseItem(auth.session.sub, existing.date, itemId, { name, amount, notes, exchangeRate }, now);
      }
      return redirect('/expenses/items');
    }

    // Create
    const name = (params.name ?? '').trim().slice(0, 100) || autoName();
    const amount = parseFloat(params.amount || '');
    const rawCurrency = (params.currency || '').toUpperCase();
    const itemCurrency = CURRENCIES.includes(rawCurrency) ? rawCurrency : currency;
    const today = clock.today();
    const rawDate = (params.date ?? '').trim();
    const date = rawDate && rawDate <= today ? rawDate : rawDate > today ? null : today;
    const notes = (params.notes ?? '').trim().slice(0, 500) || undefined;
    const rawExchangeRateCreate = parseFloat(params.exchangeRate ?? '');
    const exchangeRateCreate = !isNaN(rawExchangeRateCreate) && rawExchangeRateCreate > 0 ? rawExchangeRateCreate : undefined;

    if (isNaN(amount) || amount <= 0 || !date) {
      return redirect('/expenses/items?error=invalid');
    }

    const now = clock.nowIso();
    const id = randomUUID();
    await putExpenseItem({
      PK: `EXPENSE_ITEM#${auth.session.sub}`,
      SK: `ITEM#${date}#${id}`,
      id,
      sub: auth.session.sub,
      amount,
      currency: itemCurrency,
      name,
      date,
      notes,
      exchangeRate: exchangeRateCreate,
      createdAt: now,
      updatedAt: now,
    });
    return redirect('/expenses/items');
  }

  // GET
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const beforeCursor = qs.get('before') || undefined;
  const errorParam = qs.get('error');
  const partial = qs.get('partial') === '1';
  const today = clock.today();

  const { items, lastSK } = await queryByUser(auth.session.sub, { limit: 30, before: beforeCursor });
  const groups = groupByDate(items);

  const errorBanner = errorParam
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">
        ${escapeHtml(errorParam === 'invalid' ? 'Please check the amount and date.' : 'Something went wrong. Please try again.')}
      </div>`
    : '';

  const renderGroups = (grps: ReturnType<typeof groupByDate>) =>
    grps.map(({ label, items: groupItems }) => `
      <div style="grid-column:1/-1;font-size:0.75rem;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:0.75rem;margin-bottom:0.25rem">
        ${escapeHtml(label)}
      </div>
      ${groupItems.map((item) => `
        <div class="card" style="cursor:default">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
            <div style="min-width:0;flex:1">
              <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.name)}</div>
              ${item.notes ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.notes)}</div>` : ''}
            </div>
            <button type="button" onclick="openEditPanel('${escapeHtml(item.id)}')" title="Edit"
              style="flex-shrink:0;padding:0.2rem 0.3rem;background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:0.9rem;opacity:0.5;line-height:1;transition:opacity 0.12s"
              onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">✏️</button>
          </div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent);margin-top:0.5rem">${escapeHtml(item.currency)} ${escapeHtml(fmt(item.amount))}${item.exchangeRate && item.currency !== currency ? ` <span style="font-size:0.75rem;font-weight:400;color:var(--color-text-muted)">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(item.amount * item.exchangeRate))}</span>` : ''}</div>
        </div>
        ${renderEditPanel(item, currency)}
      `).join('')}
    `).join('');

  // Partial mode: return JSON fragment for JS-driven "Load more" appending
  if (partial) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemsHtml: renderGroups(groups),
        nextCursor: lastSK ?? null,
      }),
    };
  }

  const itemCards = groups.length === 0
    ? `<div class="card" style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:2rem 1rem">
        <div style="font-size:2rem;margin-bottom:0.5rem">💸</div>
        <div style="font-weight:600;margin-bottom:0.25rem">No expenses yet</div>
        <div style="font-size:0.875rem">Tap + Add to log your first one.</div>
      </div>`
    : renderGroups(groups);

  const loadMore = lastSK
    ? `<div id="exp-more-wrap" style="text-align:center;margin-top:1rem">
        <button type="button" onclick="loadNextPage('${escapeHtml(lastSK)}')"
          style="background:none;border:none;color:var(--color-accent);font-size:0.875rem;cursor:pointer;padding:0.5rem 1rem">
          Load more
        </button>
      </div>`
    : '';

  const body = `
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem;font-weight:700">Expenses</h2>
        <button type="button" onclick="document.getElementById('add-overlay').classList.add('open')"
          class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">+ Add</button>
      </div>
      ${errorBanner}
      <style>@media(min-width:600px){.exp-grid{grid-template-columns:repeat(2,1fr)!important}}</style>
      <div class="exp-grid" style="display:grid;grid-template-columns:1fr;gap:0.5rem">
        ${itemCards}
      </div>
      ${loadMore}
    </div>
    ${renderAddPanel(currency, today, errorParam)}
    <script>
      var _baseCurrency = '${escapeHtml(currency)}';
      function openEditPanel(id){document.getElementById('edit-overlay-'+id).classList.add('open');}
      function closeEditPanel(id){document.getElementById('edit-overlay-'+id).classList.remove('open');}

      // FX rate helpers
      function _setFxStatus(el, msg){ if(el) el.textContent = msg; }
      function _fetchRate(fromCurrency, date, inputEl, statusEl) {
        if(!fromCurrency || fromCurrency === _baseCurrency) return;
        _setFxStatus(statusEl, 'Fetching rate…');
        fetch('/fx-rate?from=' + fromCurrency + '&to=' + _baseCurrency + '&date=' + date)
          .then(function(r){ return r.json(); })
          .then(function(d){
            if(d && d.rate){ inputEl.value = d.rate; _setFxStatus(statusEl, 'Rate fetched for ' + date); }
            else { _setFxStatus(statusEl, d.error || 'Rate not available'); }
          })
          .catch(function(){ _setFxStatus(statusEl, 'Could not fetch rate'); });
      }

      // Add form: show/hide FX group and auto-fetch on currency or date change
      function _addFormOnChange() {
        var sel = document.querySelector('#add-overlay [name="currency"]');
        var dateEl = document.querySelector('#add-overlay [name="date"]');
        var grp = document.getElementById('add-fx-group');
        var inp = document.getElementById('add-fx-input');
        var sta = document.getElementById('add-fx-status');
        if(!sel || !dateEl || !grp) return;
        var cur = sel.value;
        if(cur && cur !== _baseCurrency){ grp.style.display=''; _fetchRate(cur, dateEl.value || '${escapeHtml(today)}', inp, sta); }
        else { grp.style.display='none'; if(inp) inp.value=''; }
      }
      function addFetchRate() {
        var sel = document.querySelector('#add-overlay [name="currency"]');
        var dateEl = document.querySelector('#add-overlay [name="date"]');
        var inp = document.getElementById('add-fx-input');
        var sta = document.getElementById('add-fx-status');
        if(sel && dateEl) _fetchRate(sel.value, dateEl.value, inp, sta);
      }
      (function(){
        var sel = document.querySelector('#add-overlay [name="currency"]');
        var dateEl = document.querySelector('#add-overlay [name="date"]');
        if(sel) sel.addEventListener('change', _addFormOnChange);
        if(dateEl) dateEl.addEventListener('change', _addFormOnChange);
        _addFormOnChange();
      })();

      // Append next page of items without navigating away
      function loadNextPage(cursor) {
        var wrap = document.getElementById('exp-more-wrap');
        var btn = wrap ? wrap.querySelector('button') : null;
        var grid = document.querySelector('.exp-grid');
        if(btn) btn.textContent = 'Loading…';
        fetch('/expenses/items?partial=1&before=' + encodeURIComponent(cursor))
          .then(function(r){ return r.json(); })
          .then(function(d){
            if(d.itemsHtml) {
              var tmp = document.createElement('template');
              tmp.innerHTML = d.itemsHtml;
              grid.appendChild(tmp.content);
            }
            if(d.nextCursor && wrap) {
              btn.textContent = 'Load more';
              btn.onclick = function(){ loadNextPage(d.nextCursor); };
            } else if(wrap) {
              wrap.remove();
            }
          })
          .catch(function(){
            if(btn) btn.textContent = 'Load more';
          });
      }

      // Edit form: auto-fetch on open
      function editFetchRate(id) {
        var inp = document.getElementById('edit-fx-' + id);
        var sta = document.getElementById('edit-fx-status-' + id);
        var dateEl = document.querySelector('#edit-overlay-' + id + ' [name="editDate"]');
        var cur = document.querySelector('#edit-overlay-' + id + ' input[disabled]');
        if(inp && dateEl && cur) _fetchRate(cur.value, dateEl.value, inp, sta);
      }
    </script>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: renderPage({
      title: 'Expenses',
      body,
      page: 'cash-flow',
      accountManagementUrl,
      user: {
        sub: user?.sub ?? auth.session.sub,
        displayName: user?.name,
        email: user?.email,
        picture: user?.picture,
        role: auth.session.role,
      },
    }),
  };
};
