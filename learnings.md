# Learnings

## API Gateway HTTP API — multiple Set-Cookie headers

**Problem:** Setting `Set-Cookie` in both `headers` and `multiValueHeaders` on the same Lambda response causes API Gateway to drop cookies unpredictably. In the auth login handler, `oauth_state` was being silently dropped, causing an "invalid state" error on the callback.

**Rule:** For multiple `Set-Cookie` headers, use `multiValueHeaders['Set-Cookie']` exclusively. Put `Location` and other single-value headers in `headers`. Never duplicate a header across both objects.

```ts
// correct
return {
  statusCode: 302,
  headers: { Location: authorizeUrl },
  multiValueHeaders: {
    'Set-Cookie': [cookie1, cookie2, cookie3],
  },
};

// wrong — Set-Cookie in both drops cookies
return {
  headers: { Location: authorizeUrl, 'Set-Cookie': cookie1 },
  multiValueHeaders: { 'Set-Cookie': [cookie1, cookie2, cookie3] },
};
```

## kopi-sso OIDC endpoints are under `/oauth2/`

Authorization and token endpoints are not at the issuer root — always read from the OIDC discovery document (`/.well-known/openid-configuration`) rather than assuming path conventions.

- Authorize: `{issuer}/oauth2/authorize`
- Token: `{issuer}/oauth2/token`
- JWKS: `{issuer}/.well-known/jwks.json` (standard path, no `/oauth2/` prefix)
