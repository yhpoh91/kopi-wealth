# Learnings

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

**Rule:** Only add a nav item (bottom nav, drawer, sidebar) when the destination page actually exists. Placeholder nav items that 404 erode trust and clutter the UI. Remove them from the template; re-add each item in the milestone that builds the corresponding page. This also keeps `NavPage` type and template placeholders lean — only pages with routes are listed.

## FX rate fetching — on-demand with DynamoDB 24h cache

**Approach:** Fetch exchange rates on-demand at dashboard load time, cached in DynamoDB for 24 hours. No scheduler, no cron.

**Provider: `frankfurter.app`** (primary)
- No API key, no account, no rate limit stated, ECB rates updated once per day
- One call per base currency returns all target rates: `GET https://api.frankfurter.app/latest?from=SGD`
- Response: `{ "base": "SGD", "date": "2026-06-28", "rates": { "MYR": 3.45, "USD": 0.74, ... } }`
- One call covers all foreign-currency accounts regardless of how many target currencies the user has

**Alternative provider: Wise API**
- Requires a Wise account and API key (stored in Secrets Manager as `wealth/{stage}/wise-api-key`)
- Endpoint: `GET https://api.wise.com/v1/rates?source=SGD` with `Authorization: Bearer {key}`
- Returns real mid-market rates, more accurate than ECB for practical use
- Free tier available; rate limits depend on account type
- Drop-in replacement — same caching strategy applies; swap the HTTP call and parse the response shape

**DynamoDB cache record**
- `PK: FXRATE#{baseCurrency}`, `SK: FXRATE#{date}` (e.g. `FXRATE#SGD#2026-06-28`)
- `rates`: map of target currency → rate (e.g. `{ MYR: 3.45, USD: 0.74 }`)
- TTL: 48 hours (one extra day buffer; ECB rates only change once per day so 24h cache is lossless)
- Not excluded from coverage — repository and fetch logic are unit-tested with mocked HTTP

**Dashboard load flow**
1. Fetch all user accounts → identify unique account currencies ≠ settings currency
2. If none differ → no FX needed, sum directly
3. Read `FXRATE#{settingsCurrency}#{today}` from DDB
4. Cache hit → convert using cached rates, sum
5. Cache miss → call `frankfurter.app?from={settingsCurrency}` → write full rates map to DDB → convert and sum

**Result:** at most 1 DDB read + 1 HTTP call per dashboard load per day, regardless of user count or number of foreign-currency accounts.

## kopi-sso OIDC endpoints are under `/oauth2/`

Authorization and token endpoints are not at the issuer root — always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json` (standard path, no `/oauth2/` prefix)
