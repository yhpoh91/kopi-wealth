import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { clock } from '../lib/clock';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { queryByUser as queryAccounts } from '../repositories/account';
import { queryByUser as queryInvestments } from '../repositories/investment';
import { getCpf } from '../repositories/cpf';
import { queryByUser as queryLiabilities } from '../repositories/liability';
import { queryByUser as queryReceivables } from '../repositories/receivable';
import { getGoal, queryByUser, putGoal, updateGoal, updateGoalStatus, softDelete, putSnapshot } from '../repositories/goal';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { calcReservedFunds, calcAvailableFunds } from '../lib/finance/reserved-funds';
import { resolveTrackedValue, calcGoalProgress } from '../lib/finance/goal';
import type { Goal, GoalType, GoalStatus, TracksAgainst } from '../types/goal';

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GOAL_TYPES: GoalType[] = ['lean_fire', 'full_fire', 'property', 'custom'];
const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  lean_fire: 'Lean FIRE',
  full_fire: 'Full FIRE',
  property: 'First Property',
  custom: 'Custom',
};

const TRACKS_AGAINST_OPTIONS: { value: TracksAgainst; label: string; description: string }[] = [
  { value: 'net_worth', label: 'Net Worth', description: 'Total assets (savings + investments + CPF + receivables) minus liabilities' },
  { value: 'current_assets', label: 'Current Assets', description: 'Savings + investments + CPF + receivables (before subtracting liabilities)' },
  { value: 'investable_assets', label: 'Investable Assets', description: 'Savings + investments only (excludes CPF and receivables)' },
  { value: 'total_savings', label: 'Total Savings', description: 'Cash and savings accounts only' },
  { value: 'total_investments', label: 'Total Investments', description: 'Investment portfolios only' },
  { value: 'cpf_total', label: 'CPF Total', description: 'CPF OA + SA + MA + RA balances' },
  { value: 'available_funds', label: 'Available Funds', description: 'Savings + investments after reserved funds are subtracted' },
];

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'achieved', label: 'Achieved' },
  { value: 'paused', label: 'Paused' },
];

const STATUS_COLORS: Record<GoalStatus, string> = {
  active: 'var(--color-accent)',
  achieved: '#4caf50',
  paused: 'var(--color-text-muted)',
};

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: '' };
}

async function buildMetrics(sub: string, currency: string) {
  const [accounts, investments, cpf, liabilities, receivables, settings] = await Promise.all([
    queryAccounts(sub),
    queryInvestments(sub),
    getCpf(sub),
    queryLiabilities(sub),
    queryReceivables(sub),
    getSettings(sub),
  ]);

  const foreignCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...investments.map((i) => i.currency),
    ...(cpf && currency !== 'SGD' ? ['SGD'] : []),
  ].filter((c) => c !== currency))];

  let rates: Record<string, number> = {};
  let fxFailed = false;
  if (foreignCurrencies.length > 0) {
    try {
      ({ rates } = await getOrFetchRates(currency));
    } catch {
      fxFailed = true;
    }
  }

  function sumWithFx(items: { currency: string; balance?: number; value?: number; outstandingAmount?: number }[], field: 'balance' | 'value' | 'outstandingAmount'): number | null {
    let total = 0;
    for (const item of items) {
      const amt = item[field] ?? 0;
      if (item.currency === currency) {
        total += amt;
      } else {
        const converted = convertAmount(amt, item.currency, currency, rates);
        if (converted === null || fxFailed) return null;
        total += converted;
      }
    }
    return total;
  }

  const totalSavings = accounts.length > 0 ? sumWithFx(accounts as never, 'balance') : 0;
  const totalInvestments = investments.length > 0 ? sumWithFx(investments as never, 'value') : 0;

  let cpfTotal: number | null = 0;
  if (cpf) {
    const cpfSgd = cpf.oa + cpf.sa + cpf.ma + cpf.ra;
    if (currency === 'SGD') {
      cpfTotal = cpfSgd;
    } else {
      const converted = fxFailed ? null : convertAmount(cpfSgd, 'SGD', currency, rates);
      cpfTotal = converted !== null ? converted : cpfSgd;
    }
  }

  const activeLibs = liabilities.filter((l) => l.status !== 'settled');
  let liabTotal: number | null = 0;
  for (const l of activeLibs) {
    if (l.currency === currency) {
      liabTotal = (liabTotal ?? 0) + l.outstandingAmount;
    } else {
      const converted = fxFailed ? null : convertAmount(l.outstandingAmount, l.currency, currency, rates);
      if (converted === null) { liabTotal = null; break; }
      liabTotal = liabTotal! + converted;
    }
  }

  const activeRecvs = receivables.filter((r) => r.status !== 'settled');
  let recvTotal: number | null = 0;
  for (const r of activeRecvs) {
    if (r.currency === currency) {
      recvTotal = (recvTotal ?? 0) + r.outstandingAmount;
    } else {
      const converted = fxFailed ? null : convertAmount(r.outstandingAmount, r.currency, currency, rates);
      if (converted === null) { recvTotal = null; break; }
      recvTotal = recvTotal! + converted;
    }
  }

  const s = totalSavings ?? 0;
  const inv = totalInvestments ?? 0;
  const c = cpfTotal ?? 0;
  const recv = recvTotal ?? 0;
  const liab = liabTotal ?? 0;

  const currentAssets = totalSavings !== null && totalInvestments !== null && cpfTotal !== null && recvTotal !== null
    ? s + inv + c + recv
    : null;

  const netWorth = currentAssets !== null && liabTotal !== null
    ? currentAssets - liab
    : null;

  const investableAssets = totalSavings !== null && totalInvestments !== null
    ? s + inv
    : null;

  let availableFunds: number | null = null;
  if (settings && totalSavings !== null && totalInvestments !== null) {
    const { reservedSavings, reservedInvestments } = calcReservedFunds(totalSavings, totalInvestments, settings);
    const { availableSavings, availableInvestments } = calcAvailableFunds(totalSavings, totalInvestments, reservedSavings, reservedInvestments);
    if (availableSavings !== null && availableInvestments !== null) {
      availableFunds = availableSavings + availableInvestments;
    }
  }

  return { netWorth, currentAssets, investableAssets, totalSavings, totalInvestments, cpfTotal, availableFunds };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;
  const sub = auth.session.sub;
  const now = clock.nowIso();

  // POST /goals/:id/delete
  const deleteMatch = rawPath.match(/^\/goals\/([^/]+)\/delete$/);
  if (method === 'POST' && deleteMatch) {
    await softDelete(sub, deleteMatch[1], sub, now);
    return redirect('/goals');
  }

  // POST /goals/:id — update
  const updateMatch = rawPath.match(/^\/goals\/([^/]+)$/);
  if (method === 'POST' && updateMatch) {
    const goalId = updateMatch[1];
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    const existing = await getGoal(sub, goalId);
    if (!existing || existing.deletedAt) return redirect('/goals?error=not_found');

    // Status-only update
    if (params.action === 'status') {
      const status = params.status as GoalStatus;
      if (!['active', 'achieved', 'paused'].includes(status)) return redirect('/goals?error=invalid');
      await updateGoalStatus(sub, goalId, { status, updatedAt: now });
      return redirect('/goals');
    }

    // Full update
    const name = params.name?.trim();
    const targetAmount = parseFloat(params.targetAmount);
    const sortOrder = parseInt(params.sortOrder, 10);
    const tracksAgainst = params.tracksAgainst as TracksAgainst;
    if (!name || isNaN(targetAmount) || targetAmount < 0 || isNaN(sortOrder) ||
        !TRACKS_AGAINST_OPTIONS.some((o) => o.value === tracksAgainst)) {
      return redirect('/goals?error=invalid');
    }
    await updateGoal(sub, goalId, {
      name, targetAmount, sortOrder, tracksAgainst,
      updatedAt: now, GSI1SK: `GOAL#${String(sortOrder).padStart(10, '0')}#${goalId}`,
    });
    return redirect('/goals');
  }

  // POST /goals — create
  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    const name = params.name?.trim();
    const type = params.type as GoalType;
    const tracksAgainst = params.tracksAgainst as TracksAgainst;
    const targetAmount = parseFloat(params.targetAmount);
    const sortOrder = parseInt(params.sortOrder, 10);

    if (!name || !GOAL_TYPES.includes(type) ||
        !TRACKS_AGAINST_OPTIONS.some((o) => o.value === tracksAgainst) ||
        isNaN(targetAmount) || targetAmount < 0 || isNaN(sortOrder)) {
      return redirect('/goals?error=invalid');
    }

    const id = randomUUID();
    const goal: Goal = {
      PK: `GOAL#${sub}`,
      SK: `GOAL#${id}`,
      GSI1PK: `USER#${sub}`,
      GSI1SK: `GOAL#${String(sortOrder).padStart(10, '0')}#${id}`,
      id, sub, name, type, tracksAgainst, targetAmount, sortOrder,
      status: 'active',
      createdAt: now, updatedAt: now,
    };
    await putGoal(goal);
    return redirect('/goals');
  }

  // GET /goals
  const [user, settings] = await Promise.all([getUser(sub), getSettings(sub)]);
  const currency = settings?.currency ?? 'SGD';

  const goals = await queryByUser(sub);
  const sorted = [...goals].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  const metrics = await buildMetrics(sub, currency);
  const today = clock.today();

  // Upsert snapshot for each active goal
  await Promise.all(
    sorted
      .filter((g) => g.status === 'active')
      .map((g) => {
        const value = resolveTrackedValue(g.tracksAgainst, metrics) ?? 0;
        return putSnapshot({
          PK: `GOAL_SNAP#${g.id}`,
          SK: `SNAP#${today}`,
          goalId: g.id,
          date: today,
          value,
          createdAt: now,
        });
      }),
  );

  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorParam = qs.get('error');
  const errorBanner = errorParam
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">
        Invalid input — please check all fields and try again.
       </div>`
    : '';

  const tracksDescriptions = Object.fromEntries(TRACKS_AGAINST_OPTIONS.map((o) => [o.value, o.description]));
  const tracksDescJson = escapeHtml(JSON.stringify(tracksDescriptions));

  const typeOptions = GOAL_TYPES.map((t) => `<option value="${t}">${GOAL_TYPE_LABELS[t]}</option>`).join('');
  const tracksOptions = TRACKS_AGAINST_OPTIONS.map((o) =>
    `<option value="${o.value}">${escapeHtml(o.label)}</option>`
  ).join('');

  const goalCards = sorted.map((g) => {
    const currentValue = resolveTrackedValue(g.tracksAgainst, metrics);
    const progress = currentValue !== null ? calcGoalProgress(currentValue, g.targetAmount) : null;
    const tracksLabel = TRACKS_AGAINST_OPTIONS.find((o) => o.value === g.tracksAgainst)!.label;
    const isActive = g.status === 'active';

    const progressBar = progress !== null && isActive && g.targetAmount > 0 ? `
      <div style="background:var(--color-border);border-radius:999px;height:4px;overflow:hidden;margin:0.5rem 0">
        <div style="background:var(--color-accent);height:100%;width:${escapeHtml(progress.toFixed(1))}%;border-radius:999px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--color-text-muted)">
        <span>${escapeHtml(currency)} ${escapeHtml(fmt(currentValue!))}</span>
        <span>${escapeHtml(progress.toFixed(1))}% of ${escapeHtml(currency)} ${escapeHtml(fmt(g.targetAmount))}</span>
      </div>` : g.targetAmount > 0 ? `
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.35rem">
        Target: ${escapeHtml(currency)} ${escapeHtml(fmt(g.targetAmount))}
      </div>` : `
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.35rem">No target set</div>`;

    const editTracksOptions = TRACKS_AGAINST_OPTIONS.map((o) =>
      `<option value="${o.value}"${o.value === g.tracksAgainst ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    const statusOptions = STATUS_OPTIONS.map((o) =>
      `<option value="${o.value}"${o.value === g.status ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');

    return `
    <div class="card" style="margin-bottom:0.75rem${g.status !== 'active' ? ';opacity:0.6' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.25rem">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.name)}</div>
          <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem">${escapeHtml(GOAL_TYPE_LABELS[g.type])} · ${escapeHtml(tracksLabel)}</div>
        </div>
        <span style="font-size:0.7rem;font-weight:600;color:${STATUS_COLORS[g.status]};white-space:nowrap;margin-top:0.15rem">${escapeHtml(g.status.charAt(0).toUpperCase() + g.status.slice(1))}</span>
      </div>
      ${progressBar}
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">
        <button class="btn-ghost" style="font-size:0.8rem;padding:0.3rem 0.75rem"
          onclick="openGoalPanel('${escapeHtml(g.id)}')">Edit</button>
        <button class="btn-ghost" style="font-size:0.8rem;padding:0.3rem 0.75rem;color:var(--color-error);border-color:var(--color-error)"
          onclick="openDeletePanel('${escapeHtml(g.id)}','${escapeHtml(g.name)}')">Delete</button>
      </div>
    </div>

    <div class="panel-overlay" id="goal-overlay-${escapeHtml(g.id)}" onclick="closeGoalPanel('${escapeHtml(g.id)}')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">${escapeHtml(g.name)}</div>
          <button type="button" onclick="closeGoalPanel('${escapeHtml(g.id)}')"
            style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/goals/${escapeHtml(g.id)}">
          <div class="form-group">
            <label>Name</label>
            <input name="name" type="text" value="${escapeHtml(g.name)}" required maxlength="100">
          </div>
          <div class="form-group">
            <label>Tracks Against</label>
            <select name="tracksAgainst" id="edit-tracks-${escapeHtml(g.id)}"
              onchange="updateTracksDesc('edit-desc-${escapeHtml(g.id)}', this.value)">${editTracksOptions}</select>
            <div id="edit-desc-${escapeHtml(g.id)}" style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.35rem">${escapeHtml(TRACKS_AGAINST_OPTIONS.find((o) => o.value === g.tracksAgainst)!.description)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Target Amount</label>
              <input name="targetAmount" type="number" step="0.01" min="0" value="${g.targetAmount}" required>
            </div>
            <div class="form-group">
              <label>Sort Order</label>
              <input name="sortOrder" type="number" step="1" min="1" value="${g.sortOrder}" required>
            </div>
          </div>
          <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.75rem">Save changes</button>
        </form>
        <form method="POST" action="/goals/${escapeHtml(g.id)}" style="margin-bottom:0.75rem">
          <input type="hidden" name="action" value="status">
          <div class="form-group">
            <label>Status</label>
            <select name="status">${statusOptions}</select>
          </div>
          <button type="submit" class="btn-ghost" style="width:100%">Update status</button>
        </form>
        <form method="POST" action="/goals/${escapeHtml(g.id)}/delete"
          onsubmit="return confirm('Delete ${escapeHtml(g.name)}?')" style="text-align:center">
          <button type="submit"
            style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:0.85rem;padding:0.25rem 0">
            Delete goal
          </button>
        </form>
      </div>
    </div>`;
  }).join('');

  const emptyState = goals.length === 0
    ? `<div class="card" style="text-align:center;color:var(--color-text-muted);padding:1.5rem 1rem;margin-bottom:1rem">No goals yet. Tap <strong>Add</strong> to set your first goal.</div>`
    : '';

  const addPanel = `
    <div class="panel-overlay" id="add-overlay" onclick="document.getElementById('add-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Add Goal</div>
          <button type="button" onclick="document.getElementById('add-overlay').classList.remove('open')"
            style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/goals">
          <div class="form-group">
            <label>Name</label>
            <input name="name" type="text" placeholder="e.g. Lean FIRE" required maxlength="100">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">${typeOptions}</select>
          </div>
          <div class="form-group">
            <label>Tracks Against</label>
            <select name="tracksAgainst" id="add-tracks" onchange="updateTracksDesc('add-desc', this.value)">${tracksOptions}</select>
            <div id="add-desc" style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.35rem">${escapeHtml(TRACKS_AGAINST_OPTIONS[0].description)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Target Amount</label>
              <input name="targetAmount" type="number" step="0.01" min="0" placeholder="0.00" required>
            </div>
            <div class="form-group">
              <label>Sort Order</label>
              <input name="sortOrder" type="number" step="1" min="1" value="${goals.length + 1}" required>
            </div>
          </div>
          <button type="submit" class="btn-primary" style="width:100%">Add Goal</button>
        </form>
      </div>
    </div>`;

  const deleteOverlay = `
    <div class="panel-overlay" id="delete-overlay" onclick="document.getElementById('delete-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="font-weight:600;font-size:1rem;margin-bottom:1rem">Delete Goal</div>
        <p style="font-size:0.9rem;color:var(--color-text-muted);margin-bottom:1.25rem">
          Delete <strong id="delete-name"></strong>? This cannot be undone.
        </p>
        <form id="delete-form" method="POST">
          <button type="submit" class="btn-primary" style="width:100%;background:var(--color-error);border-color:var(--color-error);margin-bottom:0.75rem">Delete</button>
        </form>
        <button type="button" class="btn-ghost" style="width:100%"
          onclick="document.getElementById('delete-overlay').classList.remove('open')">Cancel</button>
      </div>
    </div>`;

  const body = `
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem">Goals</h2>
        <button type="button" onclick="document.getElementById('add-overlay').classList.add('open')"
          class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">+ Add</button>
      </div>
      ${errorBanner}
      ${emptyState}
      ${goalCards}
      ${addPanel}
      ${deleteOverlay}
      <script type="application/json" id="tracks-desc-data">${tracksDescJson}</script>
      <script>
        var _tracksDesc = JSON.parse(document.getElementById('tracks-desc-data').textContent);
        function updateTracksDesc(descId, value) {
          var el = document.getElementById(descId);
          if (el) el.textContent = _tracksDesc[value] || '';
        }
        function openGoalPanel(id) { document.getElementById('goal-overlay-' + id).classList.add('open'); }
        function closeGoalPanel(id) { document.getElementById('goal-overlay-' + id).classList.remove('open'); }
        function openDeletePanel(id, name) {
          document.getElementById('delete-name').textContent = name;
          document.getElementById('delete-form').action = '/goals/' + id + '/delete';
          document.getElementById('delete-overlay').classList.add('open');
        }
      </script>
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Goals — kopi-wealth',
      body,
      page: 'goals',
      user: { sub, displayName: settings?.displayName, email: user?.email ?? '' },
    }),
  };
};

export async function seedDefaultGoals(sub: string, now: string): Promise<void> {
  const defaults: Array<{ name: string; type: GoalType; tracksAgainst: TracksAgainst; sortOrder: number }> = [
    { name: 'Lean FIRE', type: 'lean_fire', tracksAgainst: 'net_worth', sortOrder: 1 },
    { name: 'Full FIRE', type: 'full_fire', tracksAgainst: 'net_worth', sortOrder: 2 },
    { name: 'First Property', type: 'property', tracksAgainst: 'available_funds', sortOrder: 3 },
  ];
  await Promise.all(defaults.map((d) => {
    const id = randomUUID();
    return putGoal({
      PK: `GOAL#${sub}`,
      SK: `GOAL#${id}`,
      GSI1PK: `USER#${sub}`,
      GSI1SK: `GOAL#${String(d.sortOrder).padStart(10, '0')}#${id}`,
      id, sub, name: d.name, type: d.type, tracksAgainst: d.tracksAgainst,
      targetAmount: 0, sortOrder: d.sortOrder, status: 'active',
      createdAt: now, updatedAt: now,
    });
  }));
}
