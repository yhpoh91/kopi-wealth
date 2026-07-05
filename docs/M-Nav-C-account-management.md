# M-Nav.C — Account Management in Avatar Panel

## Goal

Add a "Manage Account" link to the avatar dropdown panel. Clicking it opens the kopi-sso account management page in a new tab, with `return_url` set so the SSO portal knows where to redirect back after the user is done.

---

## How It Works

1. On each Lambda cold start, `getAccountManagementUrl()` is called once per page render that includes the avatar panel
2. It fetches `{ssoIssuer}/.well-known/openid-configuration` (live HTTP call, in-memory cached per cold start)
3. Reads `account_management_uri` from the OIDC discovery document
4. Appends `?client_id={ssoClientId}&return_url={appUrl}/` query params
5. Returns the full URL — empty string if the SSO server is unreachable or the field is absent
6. The avatar panel renders the "Manage Account" row only when the URL is non-empty

The URL is cached in a module-level variable (`cachedUrl`) — so the HTTP fetch only happens once per Lambda instance, not per request.

---

## Avatar Panel — Final Shape

```
┌─────────────────────────────────────┐
│  ┌──────┐                           │
│  │  YH  │  Yong Hao Poh            │  ← avatar + display name
│  └──────┘  yhpoh91@gmail.com        │
│                                     │
│  ☀️ / 🌙  Theme                    │  ← theme toggle
│  🔗  Manage Account                 │  ← opens SSO portal, target="_blank"
│  ⚙️  Settings                      │  ← /settings
│  🚪  Sign out                      │  ← POST /auth/logout
│                                     │
│  [Cancel]                           │
└─────────────────────────────────────┘
```

"Manage Account" row is omitted entirely if `accountManagementUrl` is empty (SSO unreachable, or `account_management_uri` not advertised).

---

## `return_url` Values

| Stage | `return_url` |
|---|---|
| prod | `https://wealth.kopi.life/` |
| preview | `https://wealth-preview.kopi.life/` |

Driven by `config.appUrl` — already defined in `src/config/index.ts`.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/lib/account-management.ts` | New — port verbatim from kopi-health |
| `src/lib/layout.ts` | Add `accountManagementUrl?: string` to `LayoutOptions`; render Manage Account row in `userPanel` |
| `src/handlers/dashboard.ts` | Call `getAccountManagementUrl()` and pass to `renderPage` |
| `src/handlers/accountsHub.ts` | Same |
| `src/handlers/cashFlowHub.ts` | Same |

> All other authenticated page handlers (accounts, investments, cpf, goals, etc.) also need `accountManagementUrl` passed through. Add to each in this sub-milestone.

---

## `src/lib/account-management.ts`

```ts
import { config } from '../config';

let cachedUrl: string | null = null;

export async function getAccountManagementUrl(): Promise<string> {
  if (cachedUrl !== null) return cachedUrl;
  if (!config.ssoIssuer) return (cachedUrl = '');
  try {
    const res = await fetch(`${config.ssoIssuer}/.well-known/openid-configuration`);
    if (!res.ok) return (cachedUrl = '');
    const doc = await res.json() as Record<string, unknown>;
    if (typeof doc.account_management_uri !== 'string' || !doc.account_management_uri) {
      return (cachedUrl = '');
    }
    const url = new URL(doc.account_management_uri);
    if (config.ssoClientId) url.searchParams.set('client_id', config.ssoClientId);
    url.searchParams.set('return_url', `${config.appUrl}/`);
    cachedUrl = url.toString();
  } catch {
    cachedUrl = '';
  }
  return cachedUrl;
}
```

---

## Tests

| Test | File |
|---|---|
| Returns full URL when discovery doc has `account_management_uri` | `test/lib/account-management.test.ts` |
| Returns empty string when SSO issuer not configured | same |
| Returns empty string when fetch fails | same |
| Returns empty string when field absent from discovery doc | same |
| Returns cached value on second call (fetch not called twice) | same |
| Dashboard renders Manage Account row when URL is set | `test/handlers/dashboard.test.ts` |
| Dashboard omits Manage Account row when URL is empty | same |

---

## Acceptance Criteria

- [ ] Avatar panel shows "Manage Account" link when SSO responds with `account_management_uri`
- [ ] Link opens `target="_blank" rel="noopener"`
- [ ] `return_url` is appended correctly for both stages
- [ ] Link is absent (not empty `href`) when URL cannot be resolved
- [ ] In-memory cache prevents repeated fetches within same Lambda instance
- [ ] 95% coverage maintained
