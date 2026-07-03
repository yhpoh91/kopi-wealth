# kopi-wealth Milestones

Status key: ✅ Done · 🚧 In progress · ⬜ Not started

---

## Standing Rules

- **No hard deletes** — every delete must be a soft delete. Set `deletedAt` (ISO timestamp) and `deletedBy` (user sub or system actor). Filter at the repository layer.
- **No `ScanCommand`** — all reads are `GetCommand` (PK+SK) or `QueryCommand` (PK or GSI1PK).
- **Coverage ≥ 95%** on lines/functions/branches (excludes `src/templates/**`).
- **Update `MILESTONES.md`** whenever a milestone status changes.
- **Scope out** exact handlers, routes, DDB key patterns, templates, and tests together before starting each milestone.

---

## M1 — Skeleton ✅

CI only. Typecheck + tests pass (95% coverage threshold). No deploy.

Files: `.gitignore`, `README.md`, `CLAUDE.md`, `MILESTONES.md`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (CI-only stub), `.github/workflows/migrate.yml`, `serverless.yml`, `src/config/`, `src/types/`, `src/lib/`, `src/handlers/`, `src/migrations/`, `src/migrate.ts`, `test/`.

---

## M2 — GHA Deploy + Custom Domain ✅

Full deploy job in `deploy.yml`: OIDC → AWS credentials → migration check → Secrets Manager bootstrap → custom domain (idempotent) → Serverless Framework deploy. All `httpApi` events wired; `GET /health` returns `{"status":"ok"}`. DNS CNAMEs must be added manually after first deploy (see API Gateway output).

---

## M3 — API Gateway + Health Endpoint ✅

Covered by M2 — `httpApi` events were already in `serverless.yml` and deploy together.

---

## M4 — SSO Auth ✅

Full OIDC PKCE login/callback/logout. Session management (DDB + HttpOnly cookie). JIT user provisioning via kopi-sso.

---

## M5 — UI Shell + Dashboard + Settings ✅

Base HTML layout, navigation, dark mode, PWA. Dashboard skeleton. Settings page (profile, currency, timezone). FinancialSettings record seeded at first login.

---

## M6 — Accounts (Cash & Savings) ✅

Add/update balance/delete savings and checking accounts. Account snapshots. Dashboard shows total savings.

---

## M7 — CPF ✅

Update OA/SA/MA/RA balances. CPF snapshots. Dashboard shows CPF total. RA is optional (only exists after age 55). 2026 CPF reference figures (BRS/FRS/ERS).

---

## M8 — Investments ✅

Add/update value/delete investment portfolios. Investment snapshots. Dashboard shows total investments. Type-grouped card grid with FX conversion. 10 extensible investment types.

---

## M9 — Reserved Funds + Emergency Fund ✅

Savings/investment capital reservation config (fixed + % of total, per savings/investments bucket). Budget-based emergency fund config (lean/fat monthly × months). Available funds calculation. GET/POST `/reserved-funds` page. Nav restructured: Goals tab replaces CPF; More drawer contains CPF, Reserved Funds, Liabilities, Receivables, Expenses, Reports.

---

## M10 — Liabilities ✅

Add/update outstanding balance/delete loans, mortgages, credit cards. Liability snapshots. Auto-status (outstanding → partially_returned → settled). Net worth = Assets − Liabilities on dashboard.

---

## M11 — Receivables ✅

Add/update outstanding/delete receivables (money owed to you). Receivable snapshots. Auto-status. Filter by status.

---

## M12 — Expenses ⬜

Expense categories (13 types, lean/fat budgets). Monthly expense logging (upsert by category + period). Budget vs. actual view.

> **Note:** M12 (budget/snapshot model) is deferred. Per-item expense tracking is delivered in M16–M20 below.

---

## M13 — Goals ✅

FIRE goals (Lean/Full), property goal, custom goals. Goal progress tracking. TracksAgainst live metrics. Default goals seeded at first login. Dashboard: top 4 active goals.

---

## M13.5 — Dashboard Metrics ✅

Redesigned dashboard to prominently display 6 financial metrics. Hero card: Net Worth. 2-column grid: Total Assets (accounts + investments + CPF + receivables), Current Assets (accounts + investments + receivables), Total Liabilities, Total Funds (accounts + investments), Available Funds (accounts + investments − reserved funds). Partial FX indicators on each card. Mobile-first responsive grid.

---

## M14 — Reports ⬜

6-month snapshot trend charts. Net worth trend. Per-entity breakdowns (accounts, CPF, investments, liabilities, receivables).

---

## M15 — Admin Panel ⬜

User list + promote/demote. Feature flag editor (enabled, rolloutPercent, per-user overrides). Admin access: `role === 'admin'`.

---

## M16 — Expense Items: Core CRUD ⬜

Per-item expense tracking. Manual text entry: amount, optional name (auto-generated from timestamp if blank), date (defaults to today, accepts past dates for backfill), currency, notes. Feed-style list grouped by date. Soft delete. No photo yet.

Design: [`docs/M16-expense-items-crud.md`](docs/M16-expense-items-crud.md)

**New entity:** `ExpenseItem` (`EXPENSE_ITEM#{sub}` / `ITEM#{date}#{id}`)
**Routes:** `GET /expenses/items`, `POST /expenses/items`, `POST /expenses/items/{id}`, `POST /expenses/items/{id}/delete`

---

## M17 — Expense Items: Receipt Photo Upload ⬜

Attach a photo or PDF to any expense item. Browser uploads directly to S3 via presigned URL. Receipt stored permanently. Shown as image in expense detail view. No AI extraction yet — user still fills in fields manually.

Design: [`docs/M17-expense-receipt-upload.md`](docs/M17-expense-receipt-upload.md)

**New infrastructure:** S3 bucket `wealth-{stage}-receipts`
**New routes:** `POST /expenses/items/upload-url`, `GET /expenses/items/{id}`

---

## M18 — Expense Items: AI Receipt Extraction ⬜

After upload, user triggers "Extract details". Lambda fetches image from S3, sends to Claude vision API (Haiku), receives structured JSON: merchant, date, total, currency, line items. Form pre-fills from extracted data. User reviews and edits before saving. Gracefully degrades if extraction fails.

Design: [`docs/M18-expense-ai-extraction.md`](docs/M18-expense-ai-extraction.md)

**New secret:** `wealth/{stage}/anthropic-api-key`
**New route:** `POST /expenses/items/extract`
**New lib:** `src/lib/anthropic.ts`

---

## M19 — Statement Import: Upload & Parse ⬜

User uploads a bank or credit card statement (PDF or CSV). Lambda calls Claude (Sonnet) to parse and extract debit transactions. Results stored as `StatementItem` records. Read-only review table showing extracted rows. No accept/reject yet.

Design: [`docs/M19-statement-import-parse.md`](docs/M19-statement-import-parse.md)

**New entities:** `StatementImport` (`STMT_IMPORT#{sub}` / `IMPORT#{createdAt}#{id}`), `StatementItem` (`STMT_ITEM#{importId}` / `ITEM#{date}#{id}`)
**Routes:** `GET /expenses/reconcile`, `POST /expenses/reconcile/upload-url`, `POST /expenses/reconcile/parse`, `GET /expenses/reconcile/{importId}`

---

## M20 — Statement Reconciliation: Match & Backfill ⬜

Auto-matches statement items against existing expense items (same date ± 0.01 amount). User reviews matched/unmatched rows, selects unmatched rows to backfill as new expense items, or explicitly rejects rows (transfers, duplicates). Accepted items create `ExpenseItem` records; `linkedExpenseItemId` links them back. Idempotent: re-accepting is a no-op.

Design: [`docs/M20-statement-reconcile.md`](docs/M20-statement-reconcile.md)

**Extended route:** `GET /expenses/reconcile/{importId}` (adds checkboxes + badges)
**New route:** `POST /expenses/reconcile/{importId}/review`
