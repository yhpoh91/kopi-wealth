# kopi-wealth

Personal wealth OS: net worth tracker, savings accounts, CPF, investments, liabilities, receivables, goals, reserved funds, and FIRE dashboard. Multi-user. Auth via kopi-sso (PKCE). Server-rendered HTML UI.

## Stack

- TypeScript · Node.js 22 · AWS Lambda · DynamoDB · API Gateway HTTP API
- Serverless Framework v3 · GitHub Actions (OIDC)
- PWA — service worker, offline support
- `jose` for JWT · `vitest` + `aws-sdk-client-mock`
- Server-rendered HTML + minimal vanilla JS

## Two Environments

| | Preview | Production |
|---|---|---|
| Branch | any non-`main` | `main` |
| Domain | `wealth-preview.kopi.life` | `wealth.kopi.life` |
| DynamoDB | `wealth-preview-data` | `wealth-prod-data` |
| SSO issuer | `https://sso-preview.kopi.life` | `https://sso.kopi.life` |

## Commands

```bash
npm run build                  # typecheck
npm test                       # run all tests with coverage (95% threshold)
npm run test:watch             # watch mode
npm run migrate:preview        # run pending migrations against preview
npm run migrate:prod           # run pending migrations against prod
npm run migrate:check:preview  # fail if pending migrations exist (CI gate)
npm run migrate:check:prod
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture, key patterns, DynamoDB key table, AI assistant guidelines
- [`MILESTONES.md`](MILESTONES.md) — milestone list and status
- [`LEARNINGS.md`](LEARNINGS.md) — accumulated patterns and gotchas from each milestone
- [`RULES.md`](RULES.md) — mandatory non-negotiable rules for all development
- [`BACKLOG.md`](BACKLOG.md) — deferred ideas not yet assigned to a milestone
