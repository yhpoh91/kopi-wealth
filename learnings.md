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

## kopi-sso OIDC endpoints are under `/oauth2/`

Authorization and token endpoints are not at the issuer root — always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json` (standard path, no `/oauth2/` prefix)
