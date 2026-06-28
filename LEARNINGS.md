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
