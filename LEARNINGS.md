# kopi-wealth — Learnings & Patterns

Accumulated learnings from M1+. Apply to all future milestones.

---

## API Gateway HTTP API v2 — use `cookies` array, not `multiValueHeaders`

**Problem:** `multiValueHeaders` is the **REST API (v1)** response format. Serverless Framework `httpApi` deploys an **HTTP API (v2)**, which uses a top-level `cookies` array. Using `multiValueHeaders` means cookies are silently ignored — they never reach the browser, causing state/PKCE validation to fail on callback.

**Rule:** For HTTP API v2 (i.e. `httpApi` in serverless.yml), set cookies via the `cookies` array. Never use `multiValueHeaders` for cookies with HTTP API v2.

```ts
// correct — HTTP API v2 format
return {
  statusCode: 302,
  headers: { Location: authorizeUrl },
  cookies: [cookie1, cookie2, cookie3],
  body: '',
};

// wrong — multiValueHeaders is v1 (REST API) format; cookies silently dropped on v2
return {
  headers: { Location: authorizeUrl },
  multiValueHeaders: { 'Set-Cookie': [cookie1, cookie2, cookie3] },
  body: '',
};
```

## GitHub Actions — consolidate CI and deploy into one workflow with two jobs

**Problem:** Using two separate workflow files (`ci.yml` and `deploy.yml`) with `workflow_run` to chain them introduces unnecessary complexity: branch detection requires `github.event.workflow_run.head_branch` instead of `github.ref`, checkout needs an explicit `head_sha`, and the overall flow is harder to follow in the Actions UI.

**Rule:** Put CI and deploy as two jobs in the same workflow file. Use `needs: ci` on the deploy job so deploy only runs after CI passes. `github.ref` works naturally and both jobs appear in the same workflow run.

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - # typecheck + test

  deploy:
    needs: ci          # only runs if ci succeeds
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - # AWS deploy steps only
```

## Fix `<select>` contrast in dark mode with `color-scheme`

**Problem:** Native `<select>` and `<option>` elements use system-default colours regardless of CSS custom properties. In dark mode the dropdown list renders with browser defaults (dark text on white background), which clashes with the custom dark theme.

**Fix:** Add `color-scheme: dark` / `color-scheme: light` to the corresponding `:root[data-theme]` blocks. This tells the browser to render all native form controls in dark or light mode to match the page theme.

```css
:root[data-theme="dark"]  { color-scheme: dark; ... }
:root[data-theme="light"] { color-scheme: light; ... }
```

## Hide unbuilt navigation items until the feature is ready

**Rule:** Only add a nav item (bottom nav, drawer, sidebar) when the destination page actually exists. Placeholder nav items that 404 erode trust and clutter the UI. Remove them from the template; re-add each item in the milestone that builds the corresponding page.

## FX rate fetching — on-demand with DynamoDB 24h cache

**Approach:** Fetch exchange rates on-demand at dashboard load time, cached in DynamoDB for 24 hours. No scheduler, no cron.

**Provider: `frankfurter.app`** (primary)
- No API key, no account, no rate limit stated, ECB rates updated once per day
- One call per base currency returns all target rates: `GET https://api.frankfurter.app/latest?from=SGD`
- Response: `{ "base": "SGD", "date": "2026-06-28", "rates": { "MYR": 3.45, "USD": 0.74, ... } }`

**Alternative provider: Wise API**
- Requires a Wise account and API key (stored in Secrets Manager as `wealth/{stage}/wise-api-key`)
- Endpoint: `GET https://api.wise.com/v1/rates?source=SGD` with `Authorization: Bearer {key}`
- Drop-in replacement — same caching strategy applies

**DynamoDB cache record**
- `PK: FXRATE#{baseCurrency}`, `SK: FXRATE#{date}` (e.g. `FXRATE#SGD#2026-06-28`)
- `rates`: map of target currency → rate
- TTL: 48 hours

**Dashboard load flow**
1. Fetch all user accounts → identify unique account currencies ≠ settings currency
2. If none differ → no FX needed, sum directly
3. Read `FXRATE#{settingsCurrency}#{today}` from DDB
4. Cache hit → convert using cached rates, sum
5. Cache miss → call `frankfurter.app?from={settingsCurrency}` → write to DDB → convert and sum

## kopi-sso OIDC endpoints are under `/oauth2/`

Always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json`

---

## UI Patterns (M6+)

Reusable patterns discovered during M6 (Accounts). Apply these to M7+ (CPF, Investments, Liabilities, etc.).

---

## Pattern 1 — Resource List Page Layout

### Structure

```
<div style="max-width:900px;margin:0 auto">
  <!-- Page header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
    <h2 style="font-size:1.3rem">Resource Name</h2>
    <button type="button" onclick="document.getElementById('add-overlay').classList.add('open')"
      class="btn-primary" style="padding:0.45rem 1rem;font-size:0.875rem">+ Add</button>
  </div>

  <!-- Optional error/info banner -->
  <!-- (render only when query param signals an error) -->

  <!-- Card grid -->
  <style>@media(min-width:600px){.res-grid{grid-template-columns:repeat(3,1fr)!important}}</style>
  <div class="res-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem">
    <!-- card + edit panel per item (see below) -->
    <!-- empty state spans full width: <div style="grid-column:1/-1">…</div> -->
  </div>
</div>
```

- `max-width:900px` container, centred.
- Header: title left, `+ Add` primary button right. Button opens the Add bottom sheet.
- Grid: 2 columns by default, 3 columns at ≥ 600 px. Use a short per-page class (`.res-grid`) and an inline `<style>` block with the media query — avoids polluting global CSS.
- Empty state: single `.card` spanning `grid-column:1/-1`, centred muted text.
- Error banner: only rendered when `?error=` query param is present (redirect after failed validation). Escaped with `escapeHtml`.

### Card Layout

```html
<div class="card" style="cursor:default">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
    <!-- Left: name + subtitle + notes -->
    <div style="min-width:0;flex:1">
      <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        NAME
      </div>
      <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.15rem">
        TYPE · INSTITUTION
      </div>
      <!-- notes — only if set -->
      <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.1rem;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        NOTES
      </div>
    </div>
    <!-- Right: subtle edit (pencil) button -->
    <button type="button" onclick="openResPanel('ID')" title="Edit"
      style="flex-shrink:0;padding:0.2rem 0.3rem;background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:0.9rem;opacity:0.5;line-height:1;transition:opacity 0.12s"
      onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">✏️</button>
  </div>
  <!-- Primary value (balance, amount, etc.) -->
  <div style="font-size:1.1rem;font-weight:700;color:var(--color-accent);margin-top:0.5rem">
    CURRENCY VALUE
  </div>
</div>
```

- `min-width:0;flex:1` on the left column prevents overflow from long names.
- Name and notes truncate with `text-overflow:ellipsis`.
- Pencil button: `opacity:0.5` at rest, `1` on hover. Pure CSS transition.
- Primary value uses `--color-accent` and larger font weight to stand out.

---

## Pattern 2 — Bottom Sheet Panels (Add & Edit)

The `.panel-overlay` and `.panel-sheet` CSS classes are already defined in `src/templates/layout.html`. **No additional CSS is needed** — just add the markup and JS.

### How it works

- `.panel-overlay` is `display:none` by default; becomes `display:block` when `.open` is added.
- `.panel-sheet` starts `transform:translateY(100%)` (off-screen below); `.open` transitions it to `translateY(0)` (visible).
- Clicking the overlay backdrop closes the panel; `event.stopPropagation()` on the sheet prevents the click from reaching the overlay.

### Add Panel (single, no ID needed)

```html
<div class="panel-overlay" id="add-overlay"
  onclick="document.getElementById('add-overlay').classList.remove('open')">
  <div class="panel-sheet" onclick="event.stopPropagation()">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
      <div style="font-weight:600;font-size:1rem">Add Resource</div>
      <button type="button"
        onclick="document.getElementById('add-overlay').classList.remove('open')"
        style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
    </div>

    <!-- Form -->
    <form method="POST" action="/resources">
      <!-- fields... -->
      <button type="submit" class="btn-primary" style="width:100%">Add Resource</button>
    </form>

  </div>
</div>
```

Open: `document.getElementById('add-overlay').classList.add('open')`

### Edit Panel (one per item, keyed by ID)

```html
<div class="panel-overlay" id="res-overlay-ID" onclick="closeResPanel('ID')">
  <div class="panel-sheet" onclick="event.stopPropagation()">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
      <div style="font-weight:600;font-size:1rem">ITEM NAME</div>
      <button type="button" onclick="closeResPanel('ID')"
        style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:1.1rem;padding:0.25rem">✕</button>
    </div>

    <!-- Edit form -->
    <form method="POST" action="/resources/ID">
      <!-- fields... -->
      <button type="submit" class="btn-primary" style="width:100%;margin-bottom:0.75rem">Save changes</button>
    </form>

    <!-- Delete link (centred, error colour) -->
    <form method="POST" action="/resources/ID/delete"
      onsubmit="return confirm('Delete ITEM_NAME?')" style="text-align:center">
      <button type="submit"
        style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:0.85rem;padding:0.25rem 0">
        Delete resource
      </button>
    </form>

  </div>
</div>
```

JS (one block per page, at the bottom of the body HTML):

```html
<script>
  function openResPanel(id) { document.getElementById('res-overlay-' + id).classList.add('open'); }
  function closeResPanel(id) { document.getElementById('res-overlay-' + id).classList.remove('open'); }
</script>
```

### Currency and amount always on the same row

**Rule:** Currency and its corresponding amount/balance field must always appear side-by-side in the same two-column grid row. Never put them on separate rows — the currency label is meaningless without the value next to it.

- **Add forms**: Type alone (full width), then Currency + Balance on one row.
- **Edit forms**: Currency can't be changed after creation — render it as a read-only disabled input next to Balance so the user sees the context. Type goes on its own full-width row above.

```html
<!-- Type: full width -->
<div class="form-group">
  <label>Type</label>
  <select name="type">…</select>
</div>
<!-- Currency + Amount: always paired -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
  <div class="form-group">
    <label>Currency</label>
    <!-- add form: <select name="currency">…</select> -->
    <!-- edit form: <input type="text" value="SGD" disabled style="opacity:0.6;cursor:not-allowed"> -->
  </div>
  <div class="form-group">
    <label>Balance</label>
    <input name="balance" type="number" step="0.01" min="0" required>
  </div>
</div>
```

### Two-column form row (for other pairs)

```html
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
  <div class="form-group">
    <label>Type</label>
    <select name="type">…</select>
  </div>
  <div class="form-group">
    <label>Balance</label>
    <input name="balance" type="number" step="0.01" min="0" required>
  </div>
</div>
```

---

## DynamoDB Gotchas

### GSI eventual consistency — use main-table PK query for list pages

After creating an item, redirecting immediately to the list page may show a stale result if the list query uses a GSI (eventual consistency). For entities where the PK embeds the user sub (e.g. `ACCOUNT#{sub}`), query the main table instead:

```ts
// ✅ Main table — strongly consistent
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
ExpressionAttributeValues: { ':pk': `ACCOUNT#${sub}`, ':prefix': 'ACCOUNT#' },

// ❌ GSI — eventual consistency; new items may not appear immediately
IndexName: 'GSI1',
KeyConditionExpression: 'GSI1PK = :pk',
ExpressionAttributeValues: { ':pk': `USER#${sub}` },
```

Only use GSI1 when you need to query across entity types or when the PK doesn't contain the user sub.

### Reserved words in UpdateExpression

`name` and `type` are DynamoDB reserved words. Always use `ExpressionAttributeNames`:

```ts
UpdateExpression: 'SET #name = :name, #type = :type, …',
ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
```

### Base64-encoded POST bodies

API Gateway HTTP API v2 may base64-encode POST bodies. Always check `event.isBase64Encoded`:

```ts
const rawBody = event.isBase64Encoded
  ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
  : (event.body ?? '');
const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
```

---

## Clock Abstraction — never use `new Date()` or `Date.now()` directly

**Problem:** `new Date()` and `Date.now()` are non-deterministic. Any code that calls them directly is untestable without patching globals (`vi.spyOn(Date, 'now')`), which is global mutation that bleeds between tests.

**Rule:** Import and use the `clock` singleton from `src/lib/clock.ts` everywhere business or handler code needs the current time. Never call `new Date()` or `Date.now()` directly in handlers, repositories, or lib modules.

Exceptions: `src/lib/secrets.ts` (in-memory TTL cache — infrastructure, not business logic) and migration scripts.

```ts
// ✅ correct
import { clock } from '../lib/clock';
const now = clock.nowIso();           // ISO 8601 string
const today = clock.today();          // YYYY-MM-DD
const ttl = Math.floor(clock.nowMs() / 1000) + 86400; // unix seconds

// ❌ wrong — untestable
const now = new Date().toISOString();
const today = new Date().toISOString().slice(0, 10);
const ttl = Math.floor(Date.now() / 1000) + 86400;
```

In tests, mock the entire module so all three methods return fixed values:

```ts
vi.mock('../../src/lib/clock', () => ({
  clock: {
    nowMs: vi.fn(() => new Date('2026-06-28T12:00:00.000Z').getTime()),
    nowIso: vi.fn(() => '2026-06-28T12:00:00.000Z'),
    today: vi.fn(() => '2026-06-28'),
  },
}));
```

This keeps `new Date(isoString)` (parsing a known string) acceptable — only capturing "now" is non-deterministic.

---

## FX Conversion Line on Cards

For accounts whose currency differs from the user's base currency, show:
1. The converted amount: `≈ SGD 1,351.35`
2. The conversion rate: `(1 USD = 1.35 SGD)`
3. An ℹ️ icon with hover tooltip showing when the rate was fetched: `Rate as of 2026-06-28`

The rates are fetched **once per GET request** at the top of the handler before any card rendering — no race conditions are possible (SSR, single Lambda invocation). `getOrFetchRates` returns `{ rates, date }` so the retrieval date is available without an extra DDB call.

```ts
const rate = isForeign && !fxFailed ? rates[a.currency] : undefined;
const rateLabel = rate !== undefined
  ? `1 ${a.currency} = ${fmt(1 / rate)} ${currency}`
  : '';
const tooltipText = ratesDate ? `Rate as of ${ratesDate}` : 'Rate unavailable';
```

Use CSS `position:relative` wrapper with an absolutely-positioned tooltip `<span>` hidden by default, shown on `mouseenter`/`focus` via JS. The tooltip text is rendered server-side; only the show/hide is client JS.

**Critical: the JS event wiring must be included in the page's `<script>` block.** Without it, the tooltip element is in the DOM but never shown. Add this to every handler that renders `.fx-tip` tooltips:

```js
document.querySelectorAll('.fx-tip').forEach(function(tip){
  var el=tip.parentElement;
  el.addEventListener('mouseenter',function(){tip.style.display='block';});
  el.addEventListener('mouseleave',function(){tip.style.display='none';});
  el.addEventListener('focus',function(){tip.style.display='block';});
  el.addEventListener('blur',function(){tip.style.display='none';});
});
```

---

## JSON data in `<script type="application/json">` — ordering and escaping

When embedding server-side data for client JS to consume (e.g. option descriptions for a `<select>`), two rules are mandatory:

**1. Place the data `<script>` BEFORE the script that reads it.**

The browser executes scripts in document order. If the reading script runs first, `getElementById` returns `null` and the data is never loaded.

```ts
// ✅ Correct order
<script type="application/json" id="my-data">${jsonString}</script>
<script>
  var _data = JSON.parse(document.getElementById('my-data').textContent);
  // now _data is available
</script>

// ❌ Wrong — reading script comes first; getElementById returns null
<script>
  var _data = JSON.parse(document.getElementById('my-data').textContent); // null → throws
</script>
<script type="application/json" id="my-data">${jsonString}</script>
```

**2. Never `escapeHtml()` JSON content.**

`escapeHtml` converts `"` to `&quot;`, `<` to `&lt;`, etc. JSON inside a `<script>` tag is not parsed as HTML — the browser reads it as raw text. `JSON.parse('&quot;hello&quot;')` throws a `SyntaxError` because `&quot;` is not valid JSON.

```ts
// ✅ Correct — raw JSON string
const descJson = JSON.stringify(descriptions);
// → {"key":"value"}   ← valid JSON

// ❌ Wrong — HTML-escaped JSON
const descJson = escapeHtml(JSON.stringify(descriptions));
// → {&quot;key&quot;:&quot;value&quot;}   ← SyntaxError in JSON.parse
```

The `escapeHtml` rule still applies to everything else in the template — only the contents of `<script type="application/json">` are exempt.

---

## Stage-aware PWA manifest and header badge

The web app manifest (`/manifest.json`) and the HTML page header should reflect the environment to avoid confusion when switching between preview and production.

**Manifest (`src/handlers/static/manifest.ts`):** import `config` and set `name` / `short_name` based on `config.stage`:

```ts
const isProd = config.stage === 'prod';
const manifest = JSON.stringify({
  name: isProd ? 'Kopi Wealth' : 'Kopi Wealth Preview',
  short_name: isProd ? 'Kopi Wealth' : 'KW Preview',
  ...
});
```

**Header badge (`src/lib/layout.ts`):** show a small pill badge next to the logo text when not prod:

```ts
const stageBadge = config.stage !== 'prod'
  ? ' <span style="...">PREVIEW</span>'
  : '';
```

**Test strategy:** use `vi.resetModules()` + `vi.doMock('../config', () => ({ config: { stage: 'prod' } }))` then dynamic `import()` to cover both branches in unit tests.

---

## SSO `picture` claim — extract, store, and sync on every login

kopi-sso emits a `picture` claim in the ID token when the user has uploaded a profile photo. To surface this in the app:

1. **`verifyIdToken`** — add `picture: payload.picture as string | undefined` to the return value.
2. **`UserRecord`** — add `picture?: string` to the type.
3. **Callback handler** — set `picture: claims.picture` on both new-user provision and existing-user update paths. Always overwrite (not just when changed) so removing a photo is reflected on next login.
4. **Layout** — accept `picture?: string` in the `LayoutOptions.user` object. When set, render `<img src="...">` in the avatar button instead of text initials. `escapeHtml()` the URL to prevent attribute injection.
5. **All page handlers** — pass `picture: user?.picture` when constructing the `user` object for `renderPage`.

Syncing unconditionally on login means the avatar is always current without needing a separate "refresh profile" endpoint.

---

## DynamoDB FilterExpression + Limit interaction — over-fetch and filter in JS

**Problem:** `FilterExpression` is applied **after** `Limit` in DynamoDB. If you set `Limit: 31` and some items match the filter, DynamoDB first reads 31 items from storage, then filters — meaning soft-deleted items consume limit slots without appearing in results. `all.length` can be ≤ 30 even when more active items exist, so `hasMore` never triggers and "Load more" never appears.

**Fix:** Remove `FilterExpression` from `QueryCommand`. Over-fetch (e.g. `Limit: Math.max((limit + 1) * 2, 50)`) to compensate for deleted items. Filter soft-deleted items in JavaScript after the response:

```ts
// ❌ Wrong — FilterExpression eats Limit slots; Load more never appears
const res = await ddb.send(new QueryCommand({
  Limit: limit + 1,
  FilterExpression: 'attribute_not_exists(deletedAt)',
}));

// ✅ Correct — over-fetch, filter in JS
const res = await ddb.send(new QueryCommand({
  Limit: Math.max((limit + 1) * 2, 50),
}));
const all = ((res.Items ?? []) as Item[]).filter(i => !i.deletedAt);
const hasMore = all.length > limit;
```

This works because historical delete rates are low. For entities with many deletions, increase the multiplier.

---

## JS-driven "Load more" — append without navigation

**Pattern:** Instead of an `<a href="?before=...">` that replaces the entire page, use a server-side `?partial=1` mode that returns a JSON fragment, and a JS button that fetches and appends.

**Server:** detect `qs.get('partial') === '1'` in the GET handler; return `{ itemsHtml: string, nextCursor: string | null }` instead of the full page. Reuses the exact same query and render logic.

**Client:**
```js
function loadNextPage(cursor) {
  var wrap = document.getElementById('exp-more-wrap');
  var btn = wrap ? wrap.querySelector('button') : null;
  if(btn) btn.textContent = 'Loading…';
  fetch('/expenses/items?partial=1&before=' + encodeURIComponent(cursor))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d.itemsHtml) {
        var tmp = document.createElement('template');
        tmp.innerHTML = d.itemsHtml;
        document.querySelector('.exp-grid').appendChild(tmp.content);
      }
      if(d.nextCursor) { btn.textContent = 'Load more'; btn.onclick = function(){ loadNextPage(d.nextCursor); }; }
      else if(wrap) { wrap.remove(); }
    })
    .catch(function(){ if(btn) btn.textContent = 'Load more'; });
}
```

Use `<template>` for safe HTML insertion (preserves scripts/custom elements, doesn't trigger early image loads).

**Test pitfall:** Don't test for element absence using strings that also appear in JS function bodies (e.g. `getElementById('exp-more-wrap')` is always in the script). Instead, check for the `onclick` attribute pattern that only exists in the conditional button: `expect(body).not.toMatch(/onclick="loadNextPage\(/)`.

---

## FX rates for per-item foreign-currency expenses

**Pattern:** Historical exchange rates (at the date of the expense, not today's rate) via `getOrFetchHistoricalRate(from, to, date)` in `src/lib/fx.ts`. Cached in DynamoDB (`FXRATE#{from}` / `FXRATE#{date}`) with a 30-day TTL — historical rates never change.

**Server endpoint:** `GET /fx-rate?from=USD&to=SGD&date=2026-07-03` — authenticated, validates params (must be known currencies + YYYY-MM-DD date), returns `{ from, to, date, rate }`. Delegates to `getOrFetchHistoricalRate` which uses the same DDB cache as `getOrFetchRates`.

**Client:** Auto-fetches on currency or date change in the Add form; available as ↻ Refresh in the Edit form. User can manually edit the field. Calling the server endpoint means the browser never touches frankfurter.app directly — all FX calls go through the server-side cache.

**Why historical:** The exchange rate should reflect the day the expense was incurred, not today. If the user's base currency changes later, the stored `exchangeRate` on the item preserves the original conversion without retroactive distortion.

---

## Validation Pattern (POST handlers)

Redirect back with error params on validation failure so the user sees what went wrong:

```ts
// Create — redirect with all params so the form can be pre-filled
if (!name || !type || !currency || isNaN(balance) || balance < 0) {
  return redirect(`/resources?error=invalid&name=${encodeURIComponent(params.name ?? '')}&type=…`);
}

// Update — simpler; just signal the error
if (!name || !type || isNaN(balance) || balance < 0) {
  return redirect('/resources?error=invalid_balance');
}
```

Render the banner on GET when `?error=` is present:

```ts
const errorParam = qs.get('error');
const errorBanner = errorParam
  ? `<div style="background:var(--color-error);color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.875rem">
      Validation failed (${escapeHtml(errorParam)}): …
     </div>`
  : '';
```
