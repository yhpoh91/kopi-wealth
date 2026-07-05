# M16 — Expense Items: Core CRUD

Manual text-only entry. No photo, no AI. Ships a working expense feed with add / edit / delete.

---

## Routes

| Method | Path | Handler |
|---|---|---|
| GET | `/expenses/items` | `src/handlers/expenseItems.ts` |
| POST | `/expenses/items` | `src/handlers/expenseItems.ts` |
| POST | `/expenses/items/{id}` | `src/handlers/expenseItems.ts` |
| POST | `/expenses/items/{id}/delete` | `src/handlers/expenseItems.ts` |
| GET | `/fx-rate` | `src/handlers/fxRate.ts` |

> All expense item routes are handled by a single file. `GET /fx-rate` is a shared authenticated endpoint for historical FX rates — the browser always calls this instead of contacting frankfurter.app directly.

---

## DynamoDB Entity — ExpenseItem

Table: `wealth-{stage}-data`

| Attribute | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| ExpenseItem | `EXPENSE_ITEM#{sub}` | `ITEM#{date}#{id}` | — | — |

> No GSI needed — list queries use the main-table PK (`EXPENSE_ITEM#{sub}`) with `begins_with(SK, 'ITEM#')`, which is strongly consistent and avoids GSI eventual-consistency issues after a create/redirect.

### Fields

```ts
interface ExpenseItemRecord {
  PK: string;                // EXPENSE_ITEM#{sub}
  SK: string;                // ITEM#{date}#{id}
  id: string;                // uuid
  sub: string;               // owner
  amount: number;            // positive, 2dp
  currency: string;          // ISO 4217 (e.g. "SGD")
  name: string;              // display label, auto-generated if blank
  date: string;              // YYYY-MM-DD (defaults to today; accepts any past date)
  notes?: string;            // optional freetext
  exchangeRate?: number;     // 1 unit of expense currency = X units of user's base currency
  receiptKey?: string;       // S3 key — populated in M17
  lineItems?: string;        // JSON string — populated in M17
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
```

### Auto-name generation

When the user submits no `name`, generate: `Expense at HH:MM` using the current time in the user's local timezone (approximated via `clock.nowIso()` server-side). Short and identifiable.

---

## Repository — `src/repositories/expenseItem.ts`

```ts
queryByUser(sub, { limit?, before? })            // PK=EXPENSE_ITEM#{sub}, begins_with SK 'ITEM#', ScanIndexForward=false
getExpenseItem(sub, date, id)                    // GetCommand by PK+SK
putExpenseItem(item)                             // PutCommand
updateExpenseItem(sub, date, id, fields)         // UpdateCommand: name, amount, notes, exchangeRate, updatedAt
softDeleteExpenseItem(sub, date, id, deletedBy)  // UpdateCommand: deletedAt, deletedBy
```

`queryByUser` returns items in reverse-date order (most recent first). **Important:** no `FilterExpression` is used on the DynamoDB query — filtering is done in JavaScript after fetching, because `FilterExpression` is applied after `Limit` in DynamoDB, causing soft-deleted items to consume limit slots without appearing. Over-fetches with `Limit: Math.max((limit + 1) * 2, 50)` to compensate.

---

## FX Rate — `src/lib/fx.ts`

```ts
getOrFetchHistoricalRate(from, to, date)  // returns rate or null; cached in DDB with 30-day TTL
```

DDB cache key: `PK: FXRATE#{from}`, `SK: FXRATE#{date}`. The browser never calls frankfurter.app — all FX fetches go through `GET /fx-rate` which calls `getOrFetchHistoricalRate` server-side.

---

## UI Design

### `/expenses/items` — Feed View

```
┌─────────────────────────────────────┐
│ ☕ Kopi Wealth                  👤  │  ← header (layout.ts)
├─────────────────────────────────────┤
│  Expenses                  [+ Add]  │  ← page title + CTA
│                                     │
│  ── Today, 3 Jul 2026 ──────────── │  ← date group header
│  ┌───────────────────────────────┐  │
│  │ Lunch at Lau Pa Sat       ✏️  │  │  ← item card
│  │ SGD 12.50                     │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Grab ride                 ✏️  │  │
│  │ USD 8.00  ≈ SGD 10.80         │  │  ← base equivalent when exchangeRate set
│  └───────────────────────────────┘  │
│                                     │
│  ── Yesterday, 2 Jul 2026 ──────── │
│  ┌───────────────────────────────┐  │
│  │ Expense at 08:30          ✏️  │  │  ← auto-named
│  │ SGD 45.00                     │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Load more]                        │  ← JS button that appends next page
├─────────────────────────────────────┤
│  🏠   💰   🎯   💸   ···          │  ← bottom nav (Expenses active)
└─────────────────────────────────────┘
```

- Items grouped under sticky date group headers: `Today, D MMM YYYY` / `Yesterday, D MMM YYYY` / `D MMM YYYY`
- Each item card: name (truncated), amount+currency in accent colour, base equivalent `≈ SGD X.XX` when `exchangeRate` is set and currency differs from base, pencil ✏️ edit trigger
- `[+ Add]` button top-right opens Add bottom sheet
- `[Load more]` is a **button** (not a link) that JS-fetches `?partial=1&before=<cursor>` and appends returned HTML via `<template>` — no page navigation
- Empty state: centred card with "No expenses yet. Tap + Add to log your first one."
- Error banner rendered when `?error=` query param is present

### Partial Mode (`?partial=1`)

Same GET handler returns JSON instead of a full page:

```json
{ "itemsHtml": "<div>...</div>", "nextCursor": "ITEM#2026-07-01#abc" }
```

`nextCursor` is `null` when no more items exist. The JS `loadNextPage(cursor)` function appends `itemsHtml` into the feed grid and updates the Load more button's cursor or removes the button when done.

### Add Bottom Sheet

```
┌─────────────────────────────────────┐
│  Add Expense                    [✕] │
│                                     │
│  Name (optional)                    │
│  ┌─────────────────────────────┐    │
│  │ e.g. Lunch at hawker centre │    │
│  └─────────────────────────────┘    │
│  Leave blank to auto-generate       │
│                                     │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ Currency     │ │ Amount       │  │  ← always same row
│  │ [SGD ▼]     │ │ 0.00         │  │
│  └──────────────┘ └──────────────┘  │
│                                     │
│  Exchange Rate (shown if non-base)  │
│  ┌─────────────────────────────┐    │
│  │ 1.35  [Fetch rate]          │    │  ← auto-populated via /fx-rate
│  └─────────────────────────────┘    │
│                                     │
│  Date                               │
│  ┌─────────────────────────────┐    │
│  │ 2026-07-03   [calendar]     │    │  ← defaults to today; accepts past
│  └─────────────────────────────┘    │
│                                     │
│  Notes (optional)                   │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │        Add Expense          │    │  ← btn-primary, full width
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

- Currency defaults to user's `financialSettings.currency`
- Exchange Rate field hidden by default (`display:none`); shown when currency ≠ base currency. "Fetch rate" button calls `GET /fx-rate?from=<currency>&to=<base>&date=<date>` to auto-populate
- Date input: `<input type="date">` with `max` set to today (no future dates)
- On submit: `POST /expenses/items`; redirect back to `/expenses/items`

### Edit Bottom Sheet

```
┌─────────────────────────────────────┐
│  Lunch at Lau Pa Sat            [✕] │
│                                     │
│  Name                               │
│  ┌─────────────────────────────┐    │
│  │ Lunch at Lau Pa Sat         │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ Currency     │ │ Amount       │  │
│  │ SGD (locked) │ │ 12.50        │  │  ← currency: disabled input
│  └──────────────┘ └──────────────┘  │
│                                     │
│  Exchange Rate (if non-base)        │
│  ┌─────────────────────────────┐    │
│  │ 1.35                        │    │  ← shown only when currency ≠ base
│  └─────────────────────────────┘    │
│                                     │
│  Date                               │
│  ┌─────────────────────────────┐    │
│  │ 2026-07-03                  │    │
│  └─────────────────────────────┘    │
│                                     │
│  Notes                              │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │        Save changes         │    │
│  └─────────────────────────────┘    │
│                                     │
│          Delete expense             │  ← error colour, centered
└─────────────────────────────────────┘
```

- Currency is read-only after creation (disabled input, `opacity:0.6`)
- Exchange Rate field shown when `item.currency !== defaultCurrency`; user-editable
- `POST /expenses/items/{id}` to save; `POST /expenses/items/{id}/delete` to soft-delete
- Delete: confirm dialog "Delete {name}?"

---

## Navigation

**Expenses** is a bottom-nav item (💸 icon, label "Expenses").

---

## Handlers — `src/handlers/expenseItems.ts`

### `GET /expenses/items`

1. Verify session → get user + financialSettings
2. Parse `?partial=1` and `?before=<cursor>` query params
3. `queryByUser(sub, { limit: 30, before })` — over-fetches to compensate for in-JS filtering
4. Group by date into sections
5. If `?partial=1`: return `{ itemsHtml, nextCursor }` JSON
6. Otherwise: render full page

### `POST /expenses/items`

1. Verify session
2. Decode body (`isBase64Encoded` check)
3. Validate: `amount` must be positive number; `currency` must be in CURRENCIES list
4. `name`: trim; if empty, generate `Expense at HH:MM`
5. `date`: default to `clock.today()` if blank; reject future dates
6. `exchangeRate`: optional; if provided must be > 0; ignored if same currency as base
7. `id = uuidv4()`, `createdAt = clock.nowIso()`
8. `putExpenseItem(item)`
9. Redirect to `/expenses/items`

### `POST /expenses/items/{id}`

1. Verify session
2. Decode body
3. Fetch existing item by id → 404 if not found or deleted
4. Validate updated fields (same rules; currency cannot change)
5. `exchangeRate`: if provided and > 0, stored; if invalid, omitted
6. `updateExpenseItem(sub, date, id, { name, amount, notes, exchangeRate })`
7. Redirect to `/expenses/items`

### `POST /expenses/items/{id}/delete`

1. Verify session
2. Fetch item → 404 guard
3. `softDeleteExpenseItem(sub, date, id, session.sub)`
4. Redirect to `/expenses/items`

### `GET /fx-rate` — `src/handlers/fxRate.ts`

1. Verify session → 401 if not authenticated
2. Parse `?from=`, `?to=`, `?date=` query params → 400 if missing or invalid
3. Validate `from` and `to` are in CURRENCIES list → 400 if not
4. Validate `date` matches `^\d{4}-\d{2}-\d{2}$` → 400 if not
5. `getOrFetchHistoricalRate(from, to, date)` → 404 if null, 502 on fetch error
6. Return `{ from, to, date, rate }` JSON

---

## Tests

Files: `test/handlers/expenseItems.test.ts`, `test/handlers/fxRate.test.ts`, `test/repositories/expenseItem.test.ts`, `test/lib/fx.test.ts`

### expenseItems handler tests

| Test | Covers |
|---|---|
| GET returns 200 with date-grouped items | happy path |
| GET shows empty state when no items | empty state |
| GET shows Load more button when more items exist | pagination (conditional button) |
| GET does not show Load more when all items fit | no-more-items path |
| GET shows base equivalent for non-base-currency item with exchangeRate | FX display |
| GET partial=1 returns JSON with itemsHtml and nextCursor | append mode |
| GET partial=1 returns JSON with null nextCursor when no more | append mode end |
| GET undefined rawQueryString handled | edge case |
| POST creates item and redirects | create |
| POST auto-generates name when blank | name generation |
| POST defaults date to today | date default |
| POST rejects future date | validation |
| POST rejects negative amount | validation |
| POST stores exchangeRate when provided | FX create |
| POST omits exchangeRate when not provided | FX omit |
| POST /{id} updates item and redirects | update |
| POST /{id} stores exchangeRate on update | FX update |
| POST /{id} omits invalid exchangeRate on update | FX validation |
| POST /{id}/delete soft-deletes and redirects | soft delete |

### fxRate handler tests

| Test | Covers |
|---|---|
| GET returns rate for valid params | happy path |
| GET 401 when unauthenticated | auth |
| GET 400 when currency not in list | invalid currency |
| GET 400 when date format invalid | invalid date |
| GET 400 when params missing | missing params |
| GET 404 when rate not found | null rate |
| GET 502 when fetch throws | upstream error |
| GET undefined rawQueryString handled | edge case |

---

## Files Created / Modified

| File | Action |
|---|---|
| `src/types/expenseItem.ts` | New — `ExpenseItem` interface (includes `exchangeRate?`) |
| `src/repositories/expenseItem.ts` | New — CRUD + query (no FilterExpression; in-JS filter) |
| `src/handlers/expenseItems.ts` | New — single file handles all 4 routes + partial mode |
| `src/handlers/fxRate.ts` | New — `GET /fx-rate` authenticated endpoint |
| `src/lib/fx.ts` | Modified — added `getOrFetchHistoricalRate` |
| `serverless.yml` | Modified — 4 expense routes + `/fx-rate` route |
| `CLAUDE.md` | Modified — ExpenseItem added to DDB key table |
| `MILESTONES.md` | Modified — M16 → ✅ Done |
| `LEARNINGS.md` | Modified — DDB filter bug, Load more pattern, FX per-item |
| `RULES.md` | Modified — FX historical rates + pagination rules |
