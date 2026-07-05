# M-Nav.A — 3-Tab Nav + Accounts Hub + Route Restructure

## Goal

Replace the current multi-item bottom nav with a 3-tab nav. Introduce an **Accounts hub** page that serves as the landing page for the middle tab. Rename the existing "Accounts" section (cash & savings) to "Cash & Bank" to free up the "Accounts" label for the hub.

---

## Bottom Navigation — Final Shape

| Tab | Icon | Label | Route | Active when |
|---|---|---|---|---|
| 1 | 🏠 | Dashboard | `/` | `page === 'dashboard'` |
| 2 | 🗂️ | Accounts | `/accounts` | `page === 'accounts-hub' \| accounts-section` |
| 3 | 💸 | Cash Flow | `/cash-flow` | `page === 'cash-flow'` |

The current More drawer is removed entirely. Settings stays in the avatar panel only.

---

## Route Restructure

| Before | After | Why |
|---|---|---|
| `GET /accounts` — Cash & Bank list | `GET /cash-bank` | Frees `/accounts` for hub |
| `POST /accounts` | `POST /cash-bank` | |
| `POST /accounts/{id}` | `POST /cash-bank/{id}` | |
| `POST /accounts/{id}/delete` | `POST /cash-bank/{id}/delete` | |
| *(new)* | `GET /accounts` | Accounts hub |
| *(new)* | `GET /cash-flow` | Cash Flow hub (stub, expanded in M-CashFlow) |

All internal redirect targets in the Cash & Bank handler must be updated from `/accounts` → `/cash-bank`.

---

## Accounts Hub — `GET /accounts`

A read-only overview page. Every card taps to its respective section. No management happens here.

### Data fetched (one FX call at top, passed to all renderers)

| Section | Source | Shows |
|---|---|---|
| Cash & Bank | `queryAccountsByUser` | total balance (FX-converted) |
| Investments | `queryInvestmentsByUser` | total value (FX-converted) |
| CPF | `getCpf` | OA + SA + MA + RA total |
| Receivables | `queryReceivablesByUser` (active only) | total outstanding (FX-converted) |
| Liabilities | `queryLiabilitiesByUser` (non-settled) | total outstanding (FX-converted) |
| Goals | `queryGoalsByUser` (active) | count of active goals |
| Reserved Funds | `getSettings` | config status (configured / not configured) |
| Income | `queryIncomeByUser` (active) | est. monthly total — shown only after M-Income.B ships |

### Layout

```
┌─────────────────────────────────────┐
│ ☕ Kopi Wealth                  👤  │
├─────────────────────────────────────┤
│  Accounts                           │
│                                     │
│  ── Assets ──────────────────────  │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ 🏦 Cash &   │  │ 📈 Invest.  │  │
│  │    Bank     │  │ SGD 81,200  │  │
│  │ SGD 24,500  │  │             │  │
│  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ 🏛️ CPF      │  │ 📥 Receivab.│  │
│  │ SGD 45,000  │  │ SGD 2,000   │  │
│  └─────────────┘  └─────────────┘  │
│                                     │
│  ── Liabilities ─────────────────  │
│  ┌─────────────────────────────┐    │
│  │ 💳 Liabilities   SGD 8,500 >│    │
│  └─────────────────────────────┘    │
│                                     │
│  ── Planning ────────────────────  │
│  ┌─────────────────────────────┐    │
│  │ 🎯 Goals            3 active│ > │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ 🛡️ Reserved Funds    set up │ > │
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│  🏠      🗂️       💸              │
│  Dash  Accounts  Cash Flow          │
└─────────────────────────────────────┘
```

Partial FX indicator shown on cards with foreign-currency items (same pattern as current dashboard).

---

## Cash & Bank Section — Rename Only

- URL: `/accounts` → `/cash-bank`
- Page title: "Accounts" → "Cash & Bank"
- Card icon: keep existing (💰 or 🏦)
- Section label in Accounts hub: "Cash & Bank"
- All redirects inside the handler updated to `/cash-bank`
- No data model changes — `ACCOUNT#{sub}` / `ACCOUNT#{id}` key pattern unchanged

---

## Cash Flow Hub — `GET /cash-flow` (stub)

A minimal page for now: title "Cash Flow", links to `/expenses/items` and (once built) `/income`. Expanded in M-CashFlow.A.

---

## `src/lib/layout.ts` Changes

### `NavPage` type

```ts
export type NavPage =
  | 'dashboard'
  | 'accounts-hub'     // Accounts tab active (hub page)
  | 'accounts-section' // Accounts tab active (any section: cash-bank, investments, cpf, etc.)
  | 'cash-flow'        // Cash Flow tab active
  | 'admin';
```

### `renderPage` bottom nav template

3 `<a>` elements only. `accounts-hub` and `accounts-section` both set the Accounts tab to active.

### `LayoutOptions`

Add `accountManagementUrl?: string` (used by M-Nav.C).

---

## `src/lib/nav.ts` (new helper)

Extract nav rendering to a small helper so the template stays clean:

```ts
export function isAccountsActive(page?: NavPage): boolean {
  return page === 'accounts-hub' || page === 'accounts-section';
}
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/handlers/accountsHub.ts` | New — `GET /accounts` hub page |
| `src/handlers/cashFlowHub.ts` | New — `GET /cash-flow` stub |
| `src/handlers/accounts.ts` | Rename routes: `/accounts*` → `/cash-bank*` |
| `src/lib/layout.ts` | 3-tab nav, updated `NavPage` type |
| `src/templates/layout.html` | 3-tab nav HTML |
| `serverless.yml` | `/accounts` → `/cash-bank`, add `/accounts`, add `/cash-flow` |
| `CLAUDE.md` | Update nav description |
| `MILESTONES.md` | M-Nav.A → In progress / Done |

All existing section handlers (`investments`, `cpf`, `goals`, etc.) have their `page` value updated to `'accounts-section'` so the Accounts tab stays highlighted when browsing sections.

---

## Tests

| Test | File |
|---|---|
| Accounts hub renders all 6 section cards | `test/handlers/accountsHub.test.ts` |
| Accounts hub cards link to correct routes | same |
| Cash Flow hub renders with expense link | `test/handlers/cashFlowHub.test.ts` |
| Cash & Bank handler redirects to `/cash-bank` after create | `test/handlers/accounts.test.ts` (update existing) |
| Nav renders 3 tabs | `test/lib/layout.test.ts` |
| Accounts tab active for `accounts-hub` and `accounts-section` | same |

---

## Route Migration Risk Assessment

The `/accounts` → `/cash-bank` rename was assessed and deemed **not a risk** for this app. Reasons:

- **`/accounts` is not a dead link after deploy** — it becomes the Accounts hub, so bookmarks still land somewhere useful.
- **Server-rendered HTML** — no external API consumers. All links are rendered fresh per request; there are no stale client-side route references that persist independently.
- **PWA cache** — service worker cache is busted on each deploy (new asset hashes). First load after deploy fetches fresh HTML with updated links.
- **`POST /accounts` (create)** is the only truly broken path. If a user has the Add form open at the exact moment of deploy and submits, they get a 404. Acceptable on a personal app; not worth a permanent redirect handler.
- **301 redirect for POST is incorrect HTTP** — browsers don't follow redirects as POSTs. A redirect shim would not actually solve the edge case anyway.

Conclusion: hard cutover at deploy time, no redirect or deprecation window needed.

---

## Acceptance Criteria

- [ ] Bottom nav shows exactly 3 tabs: Dashboard, Accounts, Cash Flow
- [ ] Tapping Accounts tab goes to `/accounts` hub
- [ ] Every hub card taps to correct section page
- [ ] `/cash-bank` serves all 4 cash & bank routes
- [ ] No old `/accounts` CRUD routes remain in `serverless.yml`
- [ ] All section handlers pass `page: 'accounts-section'` → Accounts tab stays active
- [ ] 95% coverage maintained
