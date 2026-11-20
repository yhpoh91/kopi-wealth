# kopi-wealth

Personal wealth OS: net worth tracker, savings accounts, CPF, investments, liabilities, receivables, expenses, goals, reserved funds, FIRE dashboard. Multi-user. Feature set mirrors DuitKopi. Auth via kopi-sso (PKCE). Server-rendered HTML UI following kopi-health conventions.

## Stack

- TypeScript · Node.js 22 · AWS Lambda · DynamoDB · API Gateway HTTP API
- Serverless Framework v3 · GitHub Actions (OIDC)
- PWA — service worker, offline support
- `jose` for JWT · `vitest` + `aws-sdk-client-mock`
- Server-rendered HTML + minimal vanilla JS

## Two Stages

| Stage | Branch | Domain | DynamoDB table | SSO issuer |
|-------|--------|--------|----------------|------------|
| `prod` | `main` | wealth.kopi.life | `wealth-prod-data` | https://sso.kopi.life |
| `preview` | any other | wealth-preview.kopi.life | `wealth-preview-data` | https://sso-preview.kopi.life |

Secrets Manager prefix: `wealth/{stage}/<secret-name>`.

## Commands

```bash
npm run build                  # typecheck
npm test                       # run all tests with coverage (95% threshold)
npm run test:watch             # watch mode
npm run migrate:preview        # run pending migrations against preview
npm run migrate:prod           # run pending migrations against prod
npm run migrate:check:preview  # fail if pending migrations exist (used in CI)
npm run migrate:check:prod
```

## Key Rules

- **Never `ScanCommand`**. All reads are `GetCommand` (PK+SK) or `QueryCommand` (PK or GSI1PK).
- **Coverage ≥ 95%** (lines/functions/branches). Excludes `src/templates/**`.
- **No hard deletes** — soft delete only (`deletedAt`, `deletedBy`). DDB TTL for ephemeral records (sessions).
- **Branch discipline** — `main` is the default and production branch. After the initial commit, never push directly to `main`. All work goes on `claude/<short-description>-<id>` (AI-assisted) or `feature/<name>` (human-led) branches and merges via PR. PRs are merged by the repo owner only — never by Claude.
- **Scope out milestones** — exact handlers, routes, DDB key patterns, templates, and tests are agreed before starting each milestone.

## Architecture Rules

- **Single-table DynamoDB** — all entities in one table, key patterns in `src/repositories/`.
- **Never use DynamoDB Scan** — `GetItem` by PK or `Query` by PK/GSI hash key only.
- **Key cache** — `src/lib/secrets.ts` caches Secrets Manager values for 5 min per cold start.
- **Admin access** — `role: 'admin'` on `UserRecord`. Set manually via migration; never via app.
- **Feature flags** — DDB items `FEATURE#{name}`; evaluated per-user with allowedSubs/blockedSubs/rolloutPercent.
- **S3** — `wealth-{stage}-receipts` bucket for receipt images and statement files. Presigned PUTs from browser; presigned GETs (short TTL) for display. Never proxy file bytes through Lambda.
- **AI extraction** — `src/lib/anthropic.ts` wraps Claude API calls. API key via Secrets Manager (`wealth/{stage}/anthropic-api-key`). Always degrade gracefully on failure.

## Security Invariants

- Web sessions use HttpOnly cookies (`sid`); DDB records with `ttl` for auto-expiry (24 h).
- Mobile sessions use `Authorization: Bearer <opaque token>`; same `SESSION#` record with `platform: 'mobile'`, 60-day `ttl` renewed (at most daily) while in use, expiry also checked on read. The SSO refresh token is stored only so `POST /v1/auth/logout` can revoke it, and is removed on soft delete.
- Every authenticated handler calls `requireSessionOrBearer()` (`src/lib/auth-middleware.ts`): Bearer first, then the `sid` cookie. A failed Bearer gets a JSON 401; a failed cookie gets the login redirect.
- The mobile app never receives the SSO issuer, client id, client secret or SSO tokens. Allowed app redirect URIs: `kopiwealth://callback`, `kopiwealthpreview://callback` (`ALLOWED_APP_REDIRECT_URIS` in `src/lib/auth.ts`); each must be registered on the stage's kopi-sso client.
- Secrets Manager paths: `wealth/${stage}/<secret-name>`.
- No stack traces in error responses.
- Admin role checked server-side on every admin request.
- PKCE S256 only; no plain challenge method accepted.

## DynamoDB Key Patterns

Table: `wealth-{stage}-data` | GSI: `GSI1` (GSI1PK + GSI1SK) | TTL attribute: `ttl`

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| User | `USER#{sub}` | `USER#{sub}` | `ALL_USERS` | `USER#{sub}` |
| Session (web + mobile) | `SESSION#{id}` | `SESSION#{id}` | — | — |
| FinancialSettings | `SETTINGS#{sub}` | `SETTINGS` | — | — |
| Account | `ACCOUNT#{sub}` | `ACCOUNT#{id}` | `USER#{sub}` | `ACCOUNT#{createdAt}` |
| AccountSnapshot | `ACCT_SNAP#{accountId}` | `SNAP#{recordedAt}#{uuid}` | — | — |
| CPFAccount | `CPF#{sub}` | `CPF` | — | — |
| CPFSnapshot | `CPF_SNAP#{sub}` | `SNAP#{recordedAt}` | — | — |
| Investment | `INVEST#{sub}` | `INVEST#{id}` | `USER#{sub}` | `INVEST#{createdAt}` |
| InvestmentSnapshot | `INVEST_SNAP#{investId}` | `SNAP#{recordedAt}#{uuid}` | — | — |
| Liability | `LIAB#{sub}` | `LIAB#{id}` | `USER#{sub}` | `LIAB#{updatedAt}` |
| LiabilitySnapshot | `LIAB_SNAP#{liabId}` | `SNAP#{recordedAt}#{uuid}` | — | — |
| Receivable | `RECV#{sub}` | `RECV#{id}` | `USER#{sub}` | `RECV#{createdAt}` |
| ReceivableSnapshot | `RECV_SNAP#{recvId}` | `SNAP#{recordedAt}#{uuid}` | — | — |
| IncomeSource | `INCOME#{sub}` | `INCOME#{id}` | `USER#{sub}` | `INCOME#{createdAt}` |
| ExpenseCategory | `EXPENSE#{sub}` | `CAT#{id}` | `USER#{sub}` | `EXPENSE_CAT#{sortOrder}#{id}` |
| ExpenseSnapshot | `EXPENSE_SNAP#{catId}` | `SNAP#{period}` (YYYY-MM) | — | — |
| ExpenseItem | `EXPENSE_ITEM#{sub}` | `ITEM#{date}#{id}` | — | — |
| StatementImport | `STMT_IMPORT#{sub}` | `IMPORT#{createdAt}#{id}` | — | — |
| StatementItem | `STMT_ITEM#{importId}` | `ITEM#{date}#{id}` | — | — |
| Goal | `GOAL#{sub}` | `GOAL#{id}` | `USER#{sub}` | `GOAL#{sortOrder}#{id}` |
| GoalSnapshot | `GOAL_SNAP#{goalId}` | `SNAP#{date}` (YYYY-MM-DD) | — | — |
| FeatureFlag | `FEATURE#{name}` | `FEATURE#{name}` | — | — |
| Migration | `MIGRATION#{id}` | `MIGRATION#{id}` | — | — |

## Migrations

- Migration state stored in DynamoDB as `MIGRATION#{id}` items in the table.
- Run via `npm run migrate:preview` or `npm run migrate:prod` (needs AWS creds).
- In CI: use the `migrate.yml` dispatch workflow (Actions tab → Run Migrations).
- Deploy workflow checks for pending migrations and **fails** if any exist — run migrations first.

## Auth / User Record

`UserRecord` fields: `sub`, `email`, `name?`, `picture?`, `role?`, `lastSeenAt?`, `createdAt`, `updatedAt`, `deletedAt?`, `deletedBy?`.

`verifyIdToken` extracts `sub`, `email`, `name`, and `picture` from the SSO ID token. The callback handler saves all four and syncs them unconditionally on every login.

## Mobile Auth Routes (`src/handlers/v1/auth/`)

| Route | Purpose |
|---|---|
| `GET /v1/auth/authorize` | Stateless: validates `code_challenge` (S256 only), `state`, `redirect_uri` (allowlist); forwards `prompt` only for `login`/`select_account`; 302s to kopi-sso. |
| `POST /v1/auth/token` | JSON `{code, codeVerifier, redirectUri}` → code exchange with the secret from `wealth/{stage}/sso-client-secret`, same JIT provisioning as the web callback (`src/lib/provision-user.ts`) → `{token, expiresAt, user}`. |
| `POST /v1/auth/logout` | Soft-deletes the Bearer's own session and revokes its SSO refresh token (best effort). Always `200 {ok:true}`. |

## Overview Route (`src/handlers/v1/overview.ts`)

| Route | Purpose |
|---|---|
| `GET /v1/overview` | Bearer or cookie (`requireSessionOrBearer()`). JSON for the mobile Overview tab: `currency`, `asOf`, `netWorth`/`have`/`owe`/`available` (each `{value, partial, reason}`; `value` null with `reason` `no_data` or `fx_unavailable`), `topGoal` (`{name, tracks, percent, amountToGo}` or null), `flags` (`isAdmin` from a live `getUser`, plus `debugPanel`/`accountSelfService`; absent = off), `due` (items not updated in more than 30 days, see "Due rule" below; `[]` when nothing is due). Errors are `{error}` JSON, no stack traces. |

All the maths lives in `buildOverview(sub, settings)` (`src/lib/finance/overview.ts`), shared by the web dashboard handler and this route so they cannot drift. Change figures there, not in either handler. The dashboard still computes expenses itself.

## Profile Route (`src/handlers/v1/me.ts`)

| Route | Purpose |
|---|---|
| `GET /v1/me` | `requireSessionOrBearer()`. `{user:{sub, email, name?}, accountManagementUrl}`. `user` is the caller's own `USER#{sub}` record only (`GetItem`); `name` is omitted when absent; never `picture` or `role`. `accountManagementUrl` is `getAccountManagementUrl(returnUrl?)` (kopi-sso discovery `account_management_uri` + `client_id` + `return_url`, cached per return URL; default `${appUrl}/`), `""` when discovery fails or has none. Missing user record = `404 {error:'not_found'}`; failures `500 {error:'internal_error'}`. No log line carries the name or email. |

`return_url` depends on the caller (#48): a mobile session (`SessionContext.platform === 'mobile'`) gets `kopiwealthpreview://account` on preview and `kopiwealth://account` on prod, so kopi-sso's back link reopens the app; a web session keeps `${appUrl}/`. kopi-sso accepts a non-http(s) `return_url` when its scheme matches the scheme of one of the client's registered redirect URIs (kopi-sso#47); earlier it checked only origins, and a custom scheme's origin is `"null"`. Ship order: the app must handle `…://account` first (preview app before the preview backend, prod app before the prod backend).

## Cash & Bank and Assets Routes (`src/handlers/v1/accounts.ts`, `assets.ts`, `fxRate.ts`)

All use `requireSessionOrBearer()`; errors are `{error}` JSON (`invalid_json`, `invalid_name`, `invalid_type`, `invalid_currency`, `invalid_balance`, `invalid_field`, `no_changes`, `not_found`, `internal_error`), no stack traces. An account id owned by another user, unknown, or soft-deleted is `404 {error:'not_found'}` (reads are `GetItem` on `ACCOUNT#{sub}`, so another user's id can never match).

| Route | Purpose |
|---|---|
| `GET /v1/accounts` | One `Query`. `{currency, total, accounts[]}`, oldest first. `total` is a `{value, partial, reason}` of the Cash & Bank total in base currency: the sum of the amounts that could be converted, `partial: true` when any could not (as the web `/cash-bank` page); `no_data` with no accounts. |
| `POST /v1/accounts` | JSON `{name, type, currency, balance, institution?, notes?}` → `201 {account}`. Writes the account and its first `AccountSnapshot`. |
| `PATCH /v1/accounts/{id}` | Details only (`name`, `type`, `institution`, `notes`; absent = kept, empty institution/notes = cleared). `balance`/`currency` → `400 invalid_field`. No snapshot. Bumps `updatedAt`, as the web edit does. → `{account}`. |
| `POST /v1/accounts/{id}/balance` | `{balance}` → writes an `AccountSnapshot` → `{account, previous:{balance, updatedAt}}` (`previous` is the values before this update). |
| `DELETE /v1/accounts/{id}` | Soft delete (`deletedAt`, `deletedBy`) → `200 {ok:true}`; already deleted = 404, no second write. |
| `GET /v1/assets` | Assets tab summary: `{currency, asOf, have, groups:{cashBank, investments, cpf, owedToYou}, available}`. Each group is `{total:{value,partial,reason}, share, dueCount}`; `share` = percent of `have`, 1 decimal, null when unknown; `dueCount` is the number of due items in the group (see "Due rule"). `have`/`available` come from `toOverviewResponse`, group totals from `buildOverview().groups`. |
| `GET /v1/fx-rate?from=&to=[&date=]` | `{from, to, date, rate}`; date defaults to today; same currency → rate 1. Shares `lookupFxRate` (`src/lib/fx-rate.ts`) with web `/fx-rate`. 400 `Invalid parameters`, 404 `Rate not available`, 502 `Failed to fetch rate`. |

Account response: `{id, name, type, institution|null, notes|null, currency, balance, converted:{value,partial,reason}, updatedAt}`. `converted` equals `balance` (no FX) in the base currency; a foreign amount with no rate or FX down is `{value:null, partial:true, reason:'fx_unavailable'}`. `/v1/assets` group totals and `have` follow the dashboard instead: incomplete = `value: null`, `partial: true`, `reason: 'fx_unavailable'`.

Validation and writes live in `src/lib/accounts.ts` (`parseNewAccount`, `parseAccountDetails`, `parseBalance`, `createAccount`, `saveAccountWithSnapshot`), shared by the web `/cash-bank` handler and these routes so records are identical (tested). Name ≤ 100, institution ≤ 100, notes ≤ 500 are truncated (not rejected), as the web always did; balance must be a number ≥ 0 (as the web; `Infinity` cannot be stored and gives `500 internal_error`); currencies `SGD USD MYR AUD GBP EUR JPY HKD`. `metric()` (`finance/metric.ts`) and `sumConverted()` (`finance/convert.ts`) are the shared `{value, partial, reason}` and base-currency-sum helpers.

Feature flags: `isFeatureEnabled(name, sub)` (`src/lib/feature-flags.ts`) reads `FEATURE#{name}` (`GetItem`) and evaluates blockedSubs → allowedSubs → rolloutPercent (stable sha256 bucket per flag+sub; no `rolloutPercent` = everyone). Missing, deleted or unreadable = off. No admin UI yet (M15); items are written by migration.

## Investments Routes (`src/handlers/v1/investments.ts`, #27)

Same shape of work as Cash & Bank. All use `requireSessionOrBearer()`; errors are `{error}` JSON (`invalid_json`, `invalid_name`, `invalid_type`, `invalid_currency`, `invalid_value`, `invalid_field`, `no_changes`, `not_found`, `internal_error`), no stack traces. An id owned by another user, unknown, or soft-deleted is `404 {error:'not_found'}` (reads are `GetItem` on `INVEST#{sub}`).

| Route | Purpose |
|---|---|
| `GET /v1/investments` | `{currency, total, groups[]}`. One `Query` for the holdings plus one `Query` per holding on `INVEST_SNAP#{id}` (newest first, limit 2, in parallel) for `changeSinceLast`. `total` is a `{value, partial, reason}` of the Investments total in base currency, the same as `groups.investments.total` in `GET /v1/assets` (null + `partial` + `fx_unavailable` when any amount cannot be converted; `no_data` with no holdings). `groups` has one entry per type present, in web order: `{type, label, total, share, holdings[]}`; `total` follows the same rule; `share` = percent of the Investments total, 1 decimal, null when either figure is unknown or the total is 0. Holdings oldest first. |
| `POST /v1/investments` | JSON `{name, type, currency, value, institution?, notes?}` → `201 {investment}`. Writes the holding and its first `InvestmentSnapshot`. |
| `PATCH /v1/investments/{id}` | Details only (`name`, `type`, `institution`, `notes`; absent = kept, empty institution/notes = cleared). `value`/`currency` → `400 invalid_field`. No snapshot. Bumps `updatedAt`. → `{investment}`. |
| `POST /v1/investments/{id}/value` | `{value}` → writes an `InvestmentSnapshot` → `{investment, previous:{value, updatedAt}}`. |
| `DELETE /v1/investments/{id}` | Soft delete → `200 {ok:true}`; already deleted = 404, no second write. |

Holding: `{id, name, type, institution|null, notes|null, currency, value, converted:{value,partial,reason}, updatedAt, changeSinceLast, due, daysSince}`. `converted` is `convertedMetric()` (`finance/convert.ts`, shared with `/v1/accounts`). `changeSinceLast` = `{amount, percent, since}`: current value minus the value before the latest update, from the two newest snapshots, in the holding's own currency; `percent` is 1 decimal, null when the earlier value was 0; `since` is when the earlier value was recorded; the whole field is `null` with fewer than two snapshots (never 0). `due`/`daysSince` use the Due rule below (so they agree with `/v1/overview` `due[]` and `/v1/assets` `dueCount`). Create returns `changeSinceLast: null`; the value route reads the newest snapshot before writing (a Query right after a write can miss it).

Validation and writes live in `src/lib/investments.ts` (`parseInvestmentDetails`, `parseNewInvestment`, `parseValue`, `createInvestment`, `saveInvestmentWithSnapshot`), shared by the web `/investments` handler and these routes so records are identical (tested). Name/institution/notes rules and currencies are those of Cash & Bank (`src/lib/accounts.ts`); value must be a number ≥ 0; types are the 10 in `INVESTMENT_TYPES`. `groupMetric()` (`finance/overview.ts`) is the group-total `{value, partial, reason}` shared with `/v1/assets`.

## Due rule (`src/lib/finance/due.ts`, #26)

An item is **due when its latest update is MORE than 30 days ago**, the same for every kind (cash account, investment, CPF, liability, receivable): 29 and 30 days are not due, 31 is. "Latest update" is the record's `updatedAt` (owner decision: no snapshot reads, so no extra queries; a rename in `PATCH /v1/accounts/{id}` also bumps `updatedAt` and resets the clock). Days are whole **calendar days in the user's `FinancialSettings.timezone`** (`Asia/Singapore` when there are no settings, UTC if the zone is unknown), between the local date of `updatedAt` and the local date of now. `Overview.asOf` is still the UTC date; only the due maths uses the user's zone. Settled liabilities/receivables and soft-deleted items are never due; only the signed-in user's own items are read.

`buildOverview` returns `due: DueItem[]` (`buildDueItems`), oldest first (largest `daysSince` first; ties by kind order account, investment, cpf, liability, receivable, then `id`). `GET /v1/overview` returns it as `due`. A due item is a statement of fact (`daysSince: 41`), never advice.

```
due[]: { kind: 'account'|'investment'|'cpf'|'liability'|'receivable', id, name, daysSince, lastValue }
lastValue (account, investment, liability, receivable): { amount, currency }   // balance / value / outstandingAmount, in the item's own currency
lastValue (cpf):                                        { oa, sa, ma, ra, currency: 'SGD' }
```

The CPF entry has `id: "cpf"` and `name: "CPF"`. `GET /v1/assets` group `dueCount` = due items of the matching kind: `cashBank` = account, `investments` = investment, `cpf` = cpf, `owedToYou` = receivable. Liabilities are not an asset group, so they appear only in `due[]`.

## Layout / Rendering

`renderPage(opts: LayoutOptions)` — all authenticated page handlers must pass:
- `user.sub`, `user.displayName`, `user.email`, `user.picture`, `user.role`

The header shows `☕ Kopi Wealth` on prod, `☕ Kopi Wealth [PREVIEW]` on all other stages. The `picture` field renders as an `<img>` in the avatar button (HTML-escaped URL); falls back to text initials when absent.

## Theming

HTML pages default to dark mode. Theme toggled via `data-theme` on `<html>`, persisted to `localStorage`. Inline script before paint avoids flash.

Palette: bg `#1A3026`, surface `#2B2118`, accent `#C7A052`, error `#CC5500`.

## Project Structure

```
kopi-wealth/
├── src/
│   ├── config/          # Stage-aware config + secretName() helper
│   ├── types/           # Shared DynamoDB record types (one file per entity)
│   ├── lib/             # ddb.ts, auth.ts, auth-middleware.ts, provision-user.ts, secrets.ts, session.ts, layout.ts, feature-flags.ts; finance/overview.ts (shared dashboard + /v1/overview maths); accounts.ts (shared Cash & Bank validation + writes); investments.ts (shared Investments validation + writes); fx-rate.ts; finance/metric.ts, finance/convert.ts, finance/due.ts (due-for-update rule)
│   ├── handlers/        # Lambda handlers (one file per route; v1/auth/ = mobile sign-in; v1/overview.ts, v1/me.ts, v1/accounts.ts, v1/assets.ts, v1/fxRate.ts, v1/investments.ts)
│   ├── repositories/    # DynamoDB access layers (one file per entity)
│   ├── templates/       # Server-rendered HTML (excluded from coverage)
│   ├── migrations/      # Migration scripts (ordered, idempotent)
│   └── migrate.ts       # Migration runner CLI
├── test/                # Vitest tests (mirrors src/ structure)
├── serverless.yml
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md            # This file
├── MILESTONES.md
├── docs/                # Per-milestone scope + design documents
└── .github/workflows/
    ├── deploy.yml       # ci job (typecheck + test) → deploy job (AWS deploy); deploy needs ci
    └── migrate.yml      # Manual migration dispatch
```

## AI Assistant Guidelines

1. **Read before editing.** Always read a file before modifying it.
2. **Minimal changes.** Only change what is necessary; never refactor surrounding code unprompted.
3. **No speculative features.** No abstractions or config for hypothetical requirements.
4. **No dead code.** Remove unused imports and variables.
5. **Security first.** Never hardcode secrets. Always validate at system boundaries.
6. **Update this file.** Any change that makes a section inaccurate must update CLAUDE.md in the same commit.
7. **Branch discipline.** Work on `claude/<short-description>-<id>` branches. Never push to `main` after the initial commit. PRs are merged by the repo owner only.
8. **Atomic commits.** One logical change per commit; must pass CI.
9. **Update MILESTONES.md** whenever a milestone status changes.
10. **Scope before implementing.** Agree on exact scope (handlers, routes, DDB patterns, templates, tests) before starting each milestone.
