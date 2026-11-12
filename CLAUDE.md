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
│   ├── lib/             # ddb.ts, auth.ts, auth-middleware.ts, provision-user.ts, secrets.ts, session.ts, layout.ts, feature-flags.ts
│   ├── handlers/        # Lambda handlers (one file per route; v1/auth/ = mobile sign-in)
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
