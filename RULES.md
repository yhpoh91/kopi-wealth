# kopi-wealth — Rules

Mandatory rules for all development. These are non-negotiable and apply to every milestone.

---

## Git & Branch Discipline

- **Never push to `main` directly.** All work goes on `claude/<short-description>-<id>` (AI) or `feature/<name>` (human) branches.
- **PRs are merged by the repo owner only.** Never merge your own PR.
- **One logical change per commit.** Each commit must pass CI (typecheck + tests).
- **Update CLAUDE.md** in the same commit as any change that makes a section inaccurate.
- **Update MILESTONES.md** whenever a milestone status changes.

---

## DynamoDB

- **Never use `ScanCommand`.** All reads must be `GetCommand` (PK + SK) or `QueryCommand` (PK or GSI1PK).
- **No hard deletes.** Soft delete only — set `deletedAt` and `deletedBy`. Use DDB TTL (`ttl` attribute) for ephemeral records (sessions, FX rate cache).
- **Main-table PK query for list pages.** After a create/redirect, a GSI query may show stale data (eventual consistency). When the PK embeds the user sub (e.g. `ACCOUNT#{sub}`), use `begins_with(SK, 'ACCOUNT#')` on the main table instead of GSI1.
- **Quote reserved words.** `name` and `type` are DynamoDB reserved words — always use `ExpressionAttributeNames`.
- **Base64 POST bodies.** API Gateway HTTP API v2 may base64-encode bodies. Always check `event.isBase64Encoded` before parsing.

---

## Security

- **Never hardcode secrets.** All secrets via AWS Secrets Manager; paths follow `wealth/{stage}/<secret-name>`.
- **No stack traces in responses.** Catch errors and return generic messages.
- **Sessions use HttpOnly cookies.** Cookie name `sid`; `HttpOnly; Secure; SameSite=Lax; Max-Age=86400`.
- **PKCE S256 only.** Reject `plain` challenge method at the authorize step.
- **Admin role checked server-side** on every admin request. Never trust client-supplied role claims.
- **Escape all user input** with `escapeHtml()` before inserting into HTML.

---

## Testing

- **Coverage ≥ 95%** (lines / functions / branches). The `src/templates/**` directory is excluded.
- **Mock non-deterministic dependencies.** Never call `new Date()`, `Date.now()`, or `Math.random()` directly in handler/lib/repository code — use the `clock` abstraction (see below) or inject the value.
- **Use `aws-sdk-client-mock`** for DynamoDB. Never make real AWS calls in unit tests.
- **Tests must initially fail** when doing TDD. Verify red before green.

---

## Time — Clock Abstraction

- **Never call `new Date()` or `Date.now()` directly** in handlers, repositories, or lib modules. Use `clock` from `src/lib/clock.ts`.
- `new Date(isoString)` (parsing a fixed string) is fine — only capturing "now" is non-deterministic.
- Exception: `src/lib/secrets.ts` (in-memory TTL cache) and migration scripts.

```ts
import { clock } from '../lib/clock';
const now   = clock.nowIso();  // ISO 8601 string
const today = clock.today();   // YYYY-MM-DD
const ttl   = Math.floor(clock.nowMs() / 1000) + 86400;
```

Mock in tests:
```ts
vi.mock('../../src/lib/clock', () => ({
  clock: {
    nowMs:  vi.fn(() => new Date('2026-06-28T12:00:00.000Z').getTime()),
    nowIso: vi.fn(() => '2026-06-28T12:00:00.000Z'),
    today:  vi.fn(() => '2026-06-28'),
  },
}));
```

---

## HTTP API (API Gateway v2)

- **Use the `cookies` array** for Set-Cookie headers — not `multiValueHeaders`. The latter is REST API (v1) format and is silently ignored by HTTP API v2.
- **Check `event.isBase64Encoded`** before decoding POST bodies.

---

## UI / HTML

- **`color-scheme: inherit` on `input, select`** so native dropdown lists respect the page's `data-theme` in dark mode.
- **Never add a nav item** (bottom nav, drawer) until the destination page exists. Placeholder nav items that 404 erode trust.
- **Currency and amount always on the same row.** In add/edit forms, the currency selector/label and its corresponding balance/amount field must be in a two-column grid row together — never on separate rows.
- **Edit forms: currency is read-only.** Currency cannot be changed after creation. Render it as a disabled text input next to the balance field so the user has context.
- **Only add to nav in the milestone that ships the page.** Don't wire the route before the handler exists.
- **Escape all interpolated values** with `escapeHtml()` in every HTML template string.
- **JSON in `<script type="application/json">`: never `escapeHtml`, always place before the reading script.** `escapeHtml` corrupts JSON (`"` → `&quot;`); `JSON.parse` throws on the result. The data script must also appear before the script that calls `getElementById` on it — scripts execute in document order.
- **Stage-aware UI**: the header always shows a `PREVIEW` pill badge on non-prod; the PWA manifest uses `"Kopi Wealth"` on prod and `"Kopi Wealth Preview"` on preview. Drive both from `config.stage`.

---

## Auth / SSO

- **Sync `picture` from ID token on every login.** Extract `picture` from the OIDC ID token in `verifyIdToken`, store it in `UserRecord`, and overwrite it unconditionally in the callback (both new-user provision and existing-user update paths). Removing a photo in SSO is reflected on next login without any extra endpoint.
- **`escapeHtml` the picture URL** before interpolating it into an `<img src="...">` attribute — the URL comes from an external claim and must be escaped to prevent attribute injection.

---

## FX Rates

- **Fetch once per request (dashboard/list pages).** Call `getOrFetchRates(baseCurrency)` once at the top of the GET handler; pass `rates` and `ratesDate` down to card renderers. Never call it inside a loop or per-card render.
- **`getOrFetchRates` returns `{ rates, date }`** — use `date` for tooltip display without an extra DDB call.
- **Show rate and retrieval date** on foreign-currency cards: `(1 USD = 1.35 SGD)` with an ℹ️ hover tooltip showing `Rate as of YYYY-MM-DD`.
- **Gracefully degrade** when FX fetch fails — show `≈ SGD —` and mark totals as `(partial)`.
- **Historical rates (per-item expenses):** use `getOrFetchHistoricalRate(from, to, date)` from `src/lib/fx.ts`. Cached in DynamoDB (`FXRATE#{from}` / `FXRATE#{date}`) with a 30-day TTL. Exposed via `GET /fx-rate?from=&to=&date=` (authenticated) so the browser never calls frankfurter.app directly.
- **Never call frankfurter.app from the browser.** All FX fetches go through the server-side cache endpoint. The browser calls `/fx-rate`; the server calls `getOrFetchHistoricalRate` which handles caching.

---

## Pagination — JS-driven append, not full-page navigation

- **"Load more" must append, not replace.** A `<a href="?before=...">` link navigates away and discards the existing list. Use a `<button>` with JS that fetches `?partial=1&before=<cursor>` and appends the returned HTML into the grid.
- **`?partial=1` mode:** the same GET handler returns `{ itemsHtml: string, nextCursor: string | null }` JSON instead of a full page. Reuse the same auth, query, and render logic — no separate endpoint needed.
- **Use `<template>` for HTML insertion** (`document.createElement('template'); tmp.innerHTML = d.itemsHtml; grid.appendChild(tmp.content)`) — safe, doesn't trigger premature resource loads.
- **DynamoDB `FilterExpression` consumes `Limit` slots.** Never use `FilterExpression` with a `Limit` to exclude soft-deleted items — deleted items count against the limit before filtering, causing `hasMore` to never trigger. Over-fetch (`Limit: Math.max((limit + 1) * 2, 50)`) and filter in JavaScript instead.

---

## Navigation

- **Exactly 3 bottom-nav tabs:** Dashboard · Accounts · Cash Flow. No More drawer. No additional tabs without explicit approval.
- **Accounts tab = hub + sections.** The Accounts tab is active for both the hub page (`page: 'accounts-hub'`) and all section pages under it (`page: 'accounts-section'`). Every section handler (Cash & Bank, Investments, CPF, Goals, etc.) must pass `page: 'accounts-section'` to `renderPage`.
- **Cash Flow tab = Income + Expenses + Budget.** All money-movement features live under Cash Flow, not under Accounts.
- **Hub pages are read-only aggregations.** No create/edit/delete on hub pages. Management happens on section pages.
- **Cash & Bank route is `/cash-bank`.** The `/accounts` route is reserved for the Accounts hub. Do not use `/accounts` for the cash & bank section.

---

## Income

- **Income = known, predictable, recurring streams only.** Salary, rental income, fixed retainers. Not: bonuses, commissions, dividends, one-off windfalls. Ad-hoc income is recorded as an account balance update, not an IncomeSource.
- **Income is a standing record, not a transaction log.** One record per income stream. Updated when the amount changes; soft-closed with `endDate` when it ends. Not deleted.
- **`toMonthlyAmount` for normalisation.** Always normalise income to monthly before summing: quarterly ÷ 3, annual ÷ 12.
- **Label income totals as "(est.)"** in the UI — it is a standing budget estimate, not a confirmed bank credit.
- **Ended sources excluded from estimates.** Sources with `endDate < today` or `deletedAt` do not contribute to monthly income totals. They are shown greyed-out in an "Ended" group.

---

## Cash Flow

- **Never show "vs Budget" without budget data.** If M-Budget has not shipped, omit the Budget row and "vs Budget" net entirely. The greyed-out Budget card placeholder is acceptable; a calculated line with zero is not.
- **"vs Income" = Income − Expenses (positive is good).** "vs Budget" = Budget − Expenses (positive = under budget). Both green when positive, red when negative.
- **Cash Flow Income figure uses the monthly estimate from IncomeSources.** It does not pull from account transactions or account snapshots.

---

## GitHub Actions

- **One workflow file, two jobs.** Put CI (`typecheck + test`) and deploy as `ci` and `deploy` jobs in the same workflow file. Use `needs: ci` on the deploy job. Avoid `workflow_run` chaining between separate files.
- **Deploy only after CI passes.** The deploy job must declare `needs: ci`.
- **Migration check gate.** Deploy workflow checks for pending migrations and fails if any exist — run `migrate.yml` first.

---

## Code Style

- **No `ScanCommand`.** (listed here too because it's the single most important DynamoDB rule.)
- **No speculative abstractions.** Only add code that the current milestone requires.
- **No dead code.** Remove unused imports and variables immediately.
- **No comments on the obvious.** Only comment when the WHY is non-obvious (hidden constraint, subtle invariant, workaround).
- **`escapeHtml` on every user-supplied value** before HTML interpolation.
- **Validate at system boundaries** (user input, external APIs). Trust internal code.

---

## Migrations

- **All migrations are idempotent.** Re-running must be safe.
- **No destructive migrations without `--allow-destructive`** flag (enforced by the runner).
- **Migration state in DynamoDB** as `MIGRATION#{id}` items. Never in a separate table or file.

---

## Secrets

- **Secrets Manager path:** `wealth/{stage}/<secret-name>`.
- **`src/lib/secrets.ts` caches** values for 5 minutes per cold start. Do not bypass the cache.
- **Never log or return secret values.** No stack traces in error responses.
