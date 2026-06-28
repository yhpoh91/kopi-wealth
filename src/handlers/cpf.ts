import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { escapeHtml } from '../lib/html';
import { getUser } from '../repositories/user';
import { getSettings } from '../repositories/financialSettings';
import { getCpf, upsertCpf, putCpfSnapshot } from '../repositories/cpf';
import { getOrFetchRates, convertAmount } from '../lib/fx';
import { clock } from '../lib/clock';

// CPF base interest rates (p.a.). Extra 1% on first $60k combined (capped $20k for OA):
// under 55 → up to 5% p.a.; 55+ → up to 6% p.a. on first $30k, up to 5% on next $30k.
const INTEREST_RATES = { oa: 2.5, sa: 4.0, ma: 4.0, ra: 4.0 };

// CPF reference figures for members turning 55 in 2026 (updated annually by CPF Board).
// BHS is the 2025 figure ($75,500); 2026 figure to be confirmed when CPF Board publishes.
const CPF_REF = {
  brs: 110_200,
  frs: 220_400,
  ers: 440_800,
  bhs: 75_500,
};

const fmt = (n: number) =>
  n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const method = event.requestContext.http.method;
  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
  ]);

  if (method === 'POST') {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    const oa = parseFloat(params.oa ?? '');
    const sa = parseFloat(params.sa ?? '');
    const ma = parseFloat(params.ma ?? '');
    const raRaw = params.ra;
    const ra = raRaw === undefined || raRaw === '' ? 0 : parseFloat(raRaw);

    if ([oa, sa, ma, ra].some((v) => isNaN(v) || v < 0)) {
      return redirect('/cpf?error=invalid');
    }

    const now = clock.nowIso();
    const existing = await getCpf(auth.session.sub);

    await upsertCpf({
      PK: `CPF#${auth.session.sub}`,
      SK: 'CPF',
      sub: auth.session.sub,
      oa,
      sa,
      ma,
      ra,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await putCpfSnapshot({
      PK: `CPF_SNAP#${auth.session.sub}`,
      SK: `SNAP#${now}`,
      sub: auth.session.sub,
      oa,
      sa,
      ma,
      ra,
      recordedAt: now,
      createdAt: now,
    });

    return redirect('/cpf');
  }

  // GET
  const currency = settings?.currency ?? 'SGD';
  const cpf = await getCpf(auth.session.sub);
  const qs = new URLSearchParams(event.rawQueryString ?? '');
  const errorBanner = qs.get('error')
    ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">Please enter valid amounts (≥ 0) for all fields.</div>`
    : '';

  // FX: CPF is always SGD; convert total to user's base currency if different
  let convertedTotal: number | null = null;
  let rates: Record<string, number> = {};
  let ratesDate = '';
  let fxFailed = false;
  if (cpf && currency !== 'SGD') {
    try {
      ({ rates, date: ratesDate } = await getOrFetchRates(currency));
      const total = cpf.oa + cpf.sa + cpf.ma + cpf.ra;
      convertedTotal = convertAmount(total, 'SGD', currency, rates);
    } catch {
      fxFailed = true;
    }
  }

  const total = cpf ? cpf.oa + cpf.sa + cpf.ma + cpf.ra : 0;
  const sgdRate = rates['SGD'];
  const rateLabel = !fxFailed && sgdRate !== undefined && currency !== 'SGD'
    ? `1 SGD = ${(1 / sgdRate).toLocaleString('en-SG', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${escapeHtml(currency)}`
    : '';
  const tooltipText = ratesDate ? `Rate as of ${escapeHtml(ratesDate)}` : 'Rate unavailable';
  const rateInfo = rateLabel
    ? ` <span style="position:relative;display:inline-block;cursor:help" tabindex="0">ℹ️<span style="display:none;position:absolute;bottom:calc(100%+4px);left:50%;transform:translateX(-50%);background:#333;color:#fff;font-size:0.65rem;white-space:nowrap;padding:0.2rem 0.4rem;border-radius:0.3rem;pointer-events:none" class="fx-tip">${tooltipText}</span></span>`
    : '';

  const fxLine = currency !== 'SGD' && cpf
    ? convertedTotal !== null
      ? `<div style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.25rem">≈ ${escapeHtml(currency)} ${escapeHtml(fmt(convertedTotal))} <span style="opacity:0.7">(${escapeHtml(rateLabel)})</span>${rateInfo}</div>`
      : `<div style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.25rem">≈ ${escapeHtml(currency)} — <span style="font-size:0.7rem">(rate unavailable)</span></div>`
    : '';

  const summaryCard = `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.25rem">Total CPF${cpf ? ' · as of ' + escapeHtml(fmtDate(cpf.updatedAt)) : ''}</div>
      <div style="font-size:1.75rem;font-weight:700;color:var(--color-accent)">SGD ${cpf ? escapeHtml(fmt(total)) : '—'}</div>
      ${fxLine}
    </div>`;

  const accountCard = (
    label: string,
    key: 'oa' | 'sa' | 'ma' | 'ra',
    rate: number,
    purpose: string,
    note?: string,
  ) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem">
        <div style="font-weight:600;font-size:0.9rem">${label}</div>
        <div style="font-size:0.7rem;color:var(--color-accent);white-space:nowrap;margin-top:0.1rem">${rate.toFixed(2)}% p.a.</div>
      </div>
      <div style="font-size:1.15rem;font-weight:700;color:var(--color-accent)">SGD ${cpf ? escapeHtml(fmt(cpf[key])) : '—'}</div>
      <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.3rem">${purpose}</div>
      ${note ? `<div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.15rem;font-style:italic">${note}</div>` : ''}
    </div>`;

  const accountsGrid = `
    <style>@media(min-width:500px){.cpf-grid{grid-template-columns:repeat(2,1fr)!important}}</style>
    <div class="cpf-grid" style="display:grid;grid-template-columns:1fr;gap:0.75rem;margin-bottom:1.25rem">
      ${accountCard('Ordinary Account (OA)', 'oa', INTEREST_RATES.oa, 'Housing, education, insurance & investment', 'Up to 3.5% p.a. on first $20k of OA')}
      ${accountCard('Special Account (SA)', 'sa', INTEREST_RATES.sa, 'Long-term retirement savings', 'Closed at 55 — balance transfers to Retirement Account')}
      ${accountCard('MediSave Account (MA)', 'ma', INTEREST_RATES.ma, 'Hospitalisation, day surgery & approved outpatient', `BHS cap: SGD ${fmt(CPF_REF.bhs)} (est. 2025)`)}
      ${accountCard('Retirement Account (RA)', 'ra', INTEREST_RATES.ra, 'Monthly CPF LIFE payouts from age 65', 'Created at 55 from your OA + SA balances')}
    </div>`;

  const refCard = `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">CPF Reference (2026)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1rem">
        <div>
          <div style="font-size:0.7rem;color:var(--color-text-muted)">Basic Retirement Sum (BRS)</div>
          <div style="font-size:0.9rem;font-weight:600">SGD ${fmt(CPF_REF.brs)}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--color-text-muted)">Full Retirement Sum (FRS)</div>
          <div style="font-size:0.9rem;font-weight:600">SGD ${fmt(CPF_REF.frs)}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--color-text-muted)">Enhanced Retirement Sum (ERS)</div>
          <div style="font-size:0.9rem;font-weight:600">SGD ${fmt(CPF_REF.ers)}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--color-text-muted)">Basic Healthcare Sum (BHS)</div>
          <div style="font-size:0.9rem;font-weight:600">SGD ${fmt(CPF_REF.bhs)}</div>
        </div>
      </div>
      <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.75rem">Updated annually by CPF Board. Figures apply to members turning 55 in 2026.</div>
    </div>`;

  const retirementProgress = cpf
    ? (() => {
        const useRa = cpf.ra > 0;
        const value = useRa ? cpf.ra : cpf.sa;
        const title = useRa ? 'RA Progress vs FRS' : 'SA Progress vs FRS (target by age 55)';
        const pct = CPF_REF.frs > 0 ? Math.min(100, (value / CPF_REF.frs) * 100) : 0;
        const label = value >= CPF_REF.ers ? 'ERS met ✓' : value >= CPF_REF.frs ? 'FRS met ✓' : value >= CPF_REF.brs ? 'BRS met ✓' : 'Below BRS';
        return `
        <div class="card" style="margin-bottom:1.25rem">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(title)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
            <div style="font-size:0.85rem">SGD ${escapeHtml(fmt(value))} <span style="font-size:0.7rem;color:var(--color-text-muted)">of SGD ${fmt(CPF_REF.frs)}</span></div>
            <div style="font-size:0.75rem;color:var(--color-accent)">${escapeHtml(label)}</div>
          </div>
          <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
            <div style="background:var(--color-accent);height:100%;width:${escapeHtml(pct.toFixed(1))}%;border-radius:999px;transition:width 0.3s"></div>
          </div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:0.4rem">${escapeHtml(pct.toFixed(1))}% of FRS</div>
        </div>`;
      })()
    : '';

  // Update form (bottom sheet)
  const updatePanel = `
    <div class="panel-overlay" id="cpf-overlay" onclick="document.getElementById('cpf-overlay').classList.remove('open')">
      <div class="panel-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div style="font-weight:600;font-size:1rem">Update CPF Balances</div>
          <button type="button" onclick="document.getElementById('cpf-overlay').classList.remove('open')"
            style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
        </div>
        <form method="POST" action="/cpf">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label>Ordinary (OA)</label>
              <input name="oa" type="number" step="0.01" min="0" required value="${cpf ? cpf.oa : ''}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Special (SA)</label>
              <input name="sa" type="number" step="0.01" min="0" required value="${cpf ? cpf.sa : ''}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Medisave (MA)</label>
              <input name="ma" type="number" step="0.01" min="0" required value="${cpf ? cpf.ma : ''}" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Retirement (RA) <span style="font-weight:400;color:var(--color-text-muted)">— age 55+</span></label>
              <input name="ra" type="number" step="0.01" min="0" value="${cpf && cpf.ra ? cpf.ra : ''}" placeholder="0.00">
            </div>
          </div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:1rem">All amounts in SGD. RA is created at age 55 — leave blank if you haven't turned 55.</div>
          <button type="submit" class="btn-primary" style="width:100%">Save</button>
        </form>
      </div>
    </div>`;

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h2 style="font-size:1.3rem">CPF</h2>
        <button type="button" onclick="document.getElementById('cpf-overlay').classList.add('open')"
          class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">Update</button>
      </div>
      ${errorBanner}
      ${summaryCard}
      ${accountsGrid}
      ${cpf ? retirementProgress : ''}
      ${refCard}
      ${!cpf ? `<div class="card" style="text-align:center;color:var(--color-text-muted);padding:1.5rem 1rem;margin-bottom:1.25rem">No CPF data yet. Tap <strong>Update</strong> to enter your balances.</div>` : ''}
    </div>
    ${updatePanel}
    <script>
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
      title: 'CPF — kopi-wealth',
      body,
      page: 'cpf',
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
