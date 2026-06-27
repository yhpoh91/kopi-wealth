# kopi-wealth

Personal wealth OS: net worth tracker, investment portfolio, CPF projections, savings goals, FIRE dashboard.

## Stack

- TypeScript · Node.js 22 · AWS Lambda · DynamoDB · API Gateway HTTP API
- Serverless Framework v3 · GitHub Actions (OIDC)
- PWA — service worker, offline support
- `jose` for JWT · `vitest` + `aws-sdk-client-mock`
- Server-rendered HTML + minimal vanilla JS

## Commands

```bash
npm run build       # typecheck
npm test            # run all tests with coverage (90% threshold)
npm run test:watch  # watch mode
```
