# kopi-wealth Milestones

Status key: ✅ Done · 🚧 In progress · ⬜ Not started

---

## Standing Rules

- **No hard deletes** — every delete must be a soft delete. Set `deletedAt` (ISO timestamp) and `deletedBy` (user sub or system actor). Filter at the repository layer.
- **No `ScanCommand`** — all reads are `GetCommand` (PK+SK) or `QueryCommand` (PK or GSI1PK).
- **Coverage ≥ 90%** on lines/functions/branches (excludes `src/templates/**`).
- **Update `MILESTONES.md`** whenever a milestone status changes.

---

## M1 — Skeleton ✅

CI only. Typecheck + tests pass (90% coverage threshold). No deploy.

Files: `.gitignore`, `README.md`, `CLAUDE.md`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (CI-only), `.github/workflows/migrate.yml` (skeleton), `serverless.yml`, `src/config/`, `src/types/`, `src/lib/`, `src/handlers/`, `src/migrations/`, `src/migrate.ts`, `test/`.

---

## M2 — Lambda Stubs + GHA Deploy ⬜

All stub handlers deployed (no httpApi events). Proves OIDC + Serverless Framework.
Add deploy job to `deploy.yml`. Requires `AWS_DEPLOY_ROLE_ARN` GitHub secret.

---

## M3 — API Gateway ⬜

All `httpApi` events wired. `GET /health` returns `{"status":"ok"}`.

---

## M4 — DynamoDB + Repositories + Migration Gate ⬜

Full repository layer. Migration check gate in GHA.

---

## M5 — Custom Domain ⬜

`wealth.kopi.life` and `wealth-preview.kopi.life` live via serverless-domain-manager.

---

## M6 — SSO Auth ⬜

Full OIDC PKCE login/callback/logout. Session management (DDB + HttpOnly cookie). JIT user provisioning via kopi-sso.

---

## M7 — Net Worth Dashboard ⬜

Snapshot-based net worth tracking. Accounts, investments, liabilities entered manually. Dashboard shows current total and trend chart.

---

## M8 — CPF Projections ⬜

CPF OA/SA/MA/RA balances. Projection to retirement based on contribution rate and interest rates.

---

## M9 — FIRE Calculator ⬜

FIRE number, years to FIRE, safe withdrawal rate simulation.
