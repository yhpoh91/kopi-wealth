# kopi-wealth

Personal wealth OS: net worth tracker, investment portfolio, CPF projections, savings goals, FIRE dashboard.

## Stack

- TypeScript · Node.js 22 · AWS Lambda · DynamoDB · API Gateway HTTP API
- Serverless Framework v3 · GitHub Actions (OIDC)
- PWA — service worker, offline support
- `jose` for JWT · `vitest` + `aws-sdk-client-mock`
- Server-rendered HTML + minimal vanilla JS

## Two Stages

| Stage | Branch | Domain | DynamoDB |
|-------|--------|--------|---------|
| `prod` | `main` | wealth.kopi.life | `wealth_prod_data` |
| `preview` | any other | wealth-preview.kopi.life | `wealth_preview_data` |

## Commands

```bash
npm run build              # typecheck
npm test                   # run all tests with coverage (90% threshold)
npm run test:watch         # watch mode
npm run migrate:preview    # run pending migrations against preview
npm run migrate:prod       # run pending migrations against prod
npm run migrate:check:preview  # fail if pending migrations exist (used in CI)
npm run migrate:check:prod
```

## Key Rules

- **Never `ScanCommand`**. All reads are `GetCommand` (PK+SK) or `QueryCommand` (PK or GSI1PK).
- **Coverage ≥ 90%** (lines/functions/branches). Excludes `src/templates/**`.
- **No hard deletes** — soft delete only (`deletedAt`, `deletedBy`). DDB TTL for ephemeral records.
- **No deploy in CI until M2 is merged.** Deploy job is a stub in `deploy.yml`.
- **Branch discipline** — `main` is the default and production branch. After the initial commit, never push directly to `main`. All work goes on a feature branch (`claude/<short-description>-<id>` for AI-assisted, `feature/<name>` for human-led) and merges via PR. PRs are merged by the repo owner, not by Claude.

## Architecture Rules

- **Single-table DynamoDB** — all entities in one table, key patterns in `src/repositories/`.
- **Never use DynamoDB Scan** — `GetItem` by PK or `Query` by PK/GSI hash key only.
- **Key cache** — `src/lib/secrets.ts` caches Secrets Manager values for 5 min per cold start.
- **Admin access** — `isAdmin?: boolean` on `UserRecord`. Absent/falsy = not admin. Set manually in DynamoDB.

## Security Invariants

- Sessions use HttpOnly cookies; session records stored in DDB with TTL.
- Secrets Manager paths: `wealth/${stage}/<secret-name>`.
- No stack traces in error responses.
- `isAdmin` must be verified server-side on every admin request.

## Migrations

- Migration state stored in DynamoDB as `MIGRATIONS` PK + `{id}` SK items.
- Run via `npm run migrate:preview` or `npm run migrate:prod` (needs AWS creds).
- In CI: use the `migrate.yml` dispatch workflow (Actions tab → Run Migrations).
- Deploy workflow checks for pending migrations and **fails** if any exist — run migrations first.

## Theming

HTML pages default to dark mode. Theme toggled via `data-theme` on `<html>`, persisted to `localStorage`.

Palette: bg `#1A3026`, surface `#2B2118`, accent `#C7A052`, error `#CC5500` (inherits from kopi-health/kopi-sso).

## Project Structure

```
kopi-wealth/
├── src/
│   ├── config/          # Stage-aware config + secret name helper
│   ├── types/           # Shared DynamoDB record types
│   ├── lib/             # ddb.ts, auth.ts, secrets.ts
│   ├── handlers/        # Lambda handlers (one file per route)
│   │   ├── health.ts
│   │   ├── dashboard.ts
│   │   └── auth/        # login.ts, callback.ts, logout.ts
│   ├── repositories/    # DynamoDB access (added per milestone)
│   ├── templates/       # Server-rendered HTML (excluded from coverage)
│   ├── migrations/      # Migration scripts
│   └── migrate.ts       # Migration runner CLI
├── test/                # Vitest tests (mirrors src/ structure)
├── serverless.yml
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md            # This file
├── MILESTONES.md
└── .github/workflows/
    ├── ci.yml           # CI: typecheck + test (all branches)
    ├── deploy.yml       # CI + deploy (deploy job stub until M2)
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
