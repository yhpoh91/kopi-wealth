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

## M5 — UI Shell + Dashboard + Settings ⬜

Base HTML layout, navigation, dark mode, PWA. Dashboard skeleton. Settings page (profile, currency, timezone). FinancialSettings record seeded at first login.

---

## M6 — Accounts (Cash & Savings) ⬜

Add/update balance/delete savings and checking accounts. Account snapshots. Dashboard shows total savings.

---

## M7 — CPF ⬜

Update OA/SA/MA/RA balances. CPF snapshots. Dashboard shows CPF total.

---

## M8 — Investments ⬜

Add/update value/delete investment portfolios. Investment snapshots. Dashboard shows total investments and current assets.

---

## M9 — Reserved Funds + Emergency Fund ⬜

Savings/investment capital reservation config. Budget-based emergency fund config. Available funds calculation. Dashboard: EF status card and available funds.

---

## M10 — Liabilities ⬜

Add/update outstanding balance/delete loans, mortgages, credit cards. Liability snapshots. Auto-status (outstanding → partially_returned → settled). Net worth = Assets − Liabilities on dashboard.

---

## M11 — Receivables ⬜

Add/update outstanding/delete receivables (money owed to you). Receivable snapshots. Auto-status. Filter by status.

---

## M12 — Expenses ⬜

Expense categories (13 types, lean/fat budgets). Monthly expense logging (upsert by category + period). Budget vs. actual view.

---

## M13 — Goals ⬜

FIRE goals (Lean/Full), property goal, custom goals. Goal progress tracking. TracksAgainst live metrics. Default goals seeded at first login. Dashboard: top 4 active goals.

---

## M14 — Reports ⬜

6-month snapshot trend charts. Net worth trend. Per-entity breakdowns (accounts, CPF, investments, liabilities, receivables).

---

## M15 — Admin Panel ⬜

User list + promote/demote. Feature flag editor (enabled, rolloutPercent, per-user overrides). Admin access: `role === 'admin'`.
