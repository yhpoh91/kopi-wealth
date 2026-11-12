# M-Mobile.1 — Mobile Sign-in (Bearer Sessions)

Issue: yhpoh91/kopi-wealth#23 · MVP ticket 1 of kopitech-lab/kopi-wealth-mobile (order in kopi-wealth-mobile#22).
Standard: kopi-app `docs/06-auth-and-access.md`, "Mobile sign-in (proxied through the app's backend)". Reference implementation: kopi-health `src/handlers/auth/{authorize,token,logout-v1}.ts` and `requireSessionOrBearer()`.

## Flow

1. The app generates its own PKCE verifier + `state`, and opens
   `GET /v1/auth/authorize?code_challenge=…&code_challenge_method=S256&state=…&redirect_uri=kopiwealth://callback[&prompt=login|select_account]`
   in a browser session.
2. The backend validates and 302s to `{issuer}/oauth2/authorize` with its own `client_id`. Nothing is stored server-side.
3. kopi-sso redirects to the app's custom scheme with `code` + `state`; the app checks `state`.
4. The app calls `POST /v1/auth/token` with JSON `{ "code", "codeVerifier", "redirectUri" }`.
5. The backend exchanges the code (client secret from `wealth/{stage}/sso-client-secret`), verifies the ID token, runs the same JIT provisioning as `/auth/callback`, and creates a mobile session.
   Response `200`: `{ "token": "<opaque>", "expiresAt": "<ISO>", "user": { "sub", "email", "name?", "picture?", "role?" } }`.
6. The app sends `Authorization: Bearer <token>` on every request.
7. `POST /v1/auth/logout` with the Bearer ends that session only.

## Validation and errors

| Route | Condition | Response |
|---|---|---|
| authorize | missing `code_challenge` / `state` / `redirect_uri` | 400 JSON |
| authorize | `code_challenge_method` present and not `S256` | 400 JSON |
| authorize / token | redirect URI not `kopiwealth://callback` or `kopiwealthpreview://callback` | 400 JSON |
| authorize | `prompt` other than `login` / `select_account` | silently dropped |
| token | missing / non-string fields, bad JSON | 400 JSON |
| token | secret read or code exchange fails | 502 `{"error":"Token exchange failed"}` |
| token | ID token fails verification | 401 `{"error":"Invalid ID token"}` |
| logout | anything (no token, unknown, ended, DDB or SSO failure) | 200 `{"ok":true}` |
| any authenticated route | Bearer present but unknown / ended / expired | 401 JSON, `WWW-Authenticate: Bearer` |

## Session record

Same entity and keys as web sessions: `SESSION#{token}` / `SESSION#{token}`.

| Field | Web | Mobile |
|---|---|---|
| `sessionId` | `randomUUID()` | 32 random bytes, base64url (the Bearer token) |
| `platform` | absent | `'mobile'` |
| `ttl` | now + 24 h, fixed | now + 60 d; renewed to now + 60 d when more than a day has passed since the last renewal |
| `refreshToken` | absent | SSO refresh token, if returned; used only for revocation at logout; `REMOVE`d on soft delete |

Mobile expiry is also checked on read (`ttl <= now` → rejected), since DynamoDB TTL deletion can lag.

## requireSessionOrBearer()

Replaces `requireSession()` in every authenticated handler. Reads `Authorization: Bearer` first; if absent (or not a Bearer header), reads the `sid` cookie exactly as before. The result's failure field is now `response` (was `redirect`): the login 302 for cookies, a JSON 401 for Bearer.

## Owner step

Register both redirect URIs on the Kopi Wealth kopi-sso client for preview and prod (kopi-app `docs/setup/kopi-sso-client.md`).

## Tests

- `test/lib/auth-middleware.test.ts` — cookie path unchanged; Bearer precedence, 401, expiry, sliding renewal, header parsing.
- `test/handlers/v1/auth/{authorize,token,logout}.test.ts` — validation, allowlist, prompt forwarding, S256-only, no leakage, always-200 logout.
- `test/handlers/v1/auth/bearer-flow.test.ts` — end to end over real repositories: token → authenticated route → logout → 401, while a web cookie session keeps working.
- `test/handlers/auth/callback.test.ts` — web callback unchanged after provisioning moved to `src/lib/provision-user.ts`.
