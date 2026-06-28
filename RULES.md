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

---

## FX Rates

- **Fetch once per request.** Call `getOrFetchRates(baseCurrency)` once at the top of the GET handler; pass `rates` and `ratesDate` down to card renderers. Never call it inside a loop or per-card render.
- **`getOrFetchRates` returns `{ rates, date }`** — use `date` for tooltip display without an extra DDB call.
- **Show rate and retrieval date** on foreign-currency cards: `(1 USD = 1.35 SGD)` with an ℹ️ hover tooltip showing `Rate as of YYYY-MM-DD`.
- **Gracefully degrade** when FX fetch fails — show `≈ SGD —` and mark totals as `(partial)`.

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
