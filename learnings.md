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

## kopi-sso OIDC endpoints are under `/oauth2/`

Authorization and token endpoints are not at the issuer root — always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json` (standard path, no `/oauth2/` prefix)
