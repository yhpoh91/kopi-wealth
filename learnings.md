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

## kopi-sso OIDC endpoints are under `/oauth2/`

Authorization and token endpoints are not at the issuer root — always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json` (standard path, no `/oauth2/` prefix)
