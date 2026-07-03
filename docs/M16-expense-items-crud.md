# M16 — Expense Items: Core CRUD

Manual text-only entry. No photo, no AI. Ships a working expense feed with add / edit / delete.

---

## Routes

| Method | Path | Handler |
|---|---|---|
| GET | `/expenses/items` | `src/handlers/expenseItems/list.ts` |
| POST | `/expenses/items` | `src/handlers/expenseItems/create.ts` |
| POST | `/expenses/items/{id}` | `src/handlers/expenseItems/update.ts` |
| POST | `/expenses/items/{id}/delete` | `src/handlers/expenseItems/delete.ts` |

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
queryByUser(sub, { limit?, before? })  // PK=EXPENSE_ITEM#{sub}, begins_with SK 'ITEM#', ScanIndexForward=false
getExpenseItem(sub, date, id)          // GetCommand by PK+SK
putExpenseItem(item)                   // PutCommand
softDeleteExpenseItem(sub, date, id, deletedBy)  // UpdateCommand: deletedAt, deletedBy
```

`queryByUser` returns items in reverse-date order (most recent first). Excludes soft-deleted (`deletedAt` absent in filter expression). Pagination cursor: last evaluated SK.

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
│  │ SGD 8.00                      │  │
│  └───────────────────────────────┘  │
│                                     │
│  ── Yesterday, 2 Jul 2026 ──────── │
│  ┌───────────────────────────────┐  │
│  │ Expense at 08:30          ✏️  │  │  ← auto-named
│  │ SGD 45.00                     │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Load more]                        │  ← pagination link
├─────────────────────────────────────┤
│  🏠   💰   🎯   💸   ···          │  ← bottom nav (Expenses active)
└─────────────────────────────────────┘
```

- Items grouped under sticky date group headers: `Today, D MMM YYYY` / `Yesterday, D MMM YYYY` / `D MMM YYYY`
- Each item card: name (truncated), amount+currency in accent colour, pencil ✏️ edit trigger
- `[+ Add]` button top-right opens Add bottom sheet
- `[Load more]` link if > 30 items returned (cursor-based pagination, appends to page via GET `?before=SK`)
- Empty state: centred card with "No expenses yet. Tap + Add to log your first one."
- Error banner rendered when `?error=` query param is present

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
- `POST /expenses/items/{id}` to save; `POST /expenses/items/{id}/delete` to soft-delete
- Delete: confirm dialog "Delete {name}?"

---

## Navigation

Add **Expenses** as a bottom-nav item (💸 icon, label "Expenses"), replacing or alongside the current nav. Follow RULES.md: only add the nav item in this milestone (the page now exists).

---

## Handlers

### `GET /expenses/items`

1. Verify session → get user + financialSettings
2. `queryByUser(sub, { limit: 31 })` — fetches up to 31; if 31 returned, there are more (show Load more)
3. Group by date into sections
4. Render page

### `POST /expenses/items`

1. Verify session
2. Decode body (`isBase64Encoded` check)
3. Validate: `amount` must be positive number; `currency` must be 3-char uppercase
4. `name`: trim; if empty, generate `Expense at HH:MM`
5. `date`: default to `clock.today()` if blank; reject future dates
6. `id = uuidv4()`, `createdAt = clock.nowIso()`
7. `putExpenseItem(item)`
8. Redirect to `/expenses/items`

### `POST /expenses/items/{id}`

1. Verify session
2. Decode body
3. Fetch existing item by id → 404 if not found or deleted
4. Validate updated fields (same rules; currency cannot change — ignored if submitted)
5. Update fields, `updatedAt = clock.nowIso()`
6. `putExpenseItem(updatedItem)`
7. Redirect to `/expenses/items`

### `POST /expenses/items/{id}/delete`

1. Verify session
2. Fetch item → 404 guard
3. `softDeleteExpenseItem(sub, date, id, session.sub)`
4. Redirect to `/expenses/items`

---

## Tests

File: `test/handlers/expenseItems/`

| Test | Covers |
|---|---|
| GET returns 200 with date-grouped items | happy path |
| GET shows empty state when no items | empty state |
| GET shows 'Load more' when 31 items returned | pagination |
| POST creates item and redirects | create |
| POST auto-generates name when blank | name generation |
| POST defaults date to today | date default |
| POST rejects future date | validation |
| POST rejects negative amount | validation |
| POST /{id} updates item and redirects | update |
| POST /{id} ignores currency change attempt | currency lock |
| POST /{id}/delete soft-deletes and redirects | soft delete |
| GET excludes soft-deleted items | filter |

Repository file: `test/repositories/expenseItem.test.ts`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/types/expenseItem.ts` | New — `ExpenseItemRecord` interface |
| `src/repositories/expenseItem.ts` | New — CRUD + query |
| `src/handlers/expenseItems/list.ts` | New |
| `src/handlers/expenseItems/create.ts` | New |
| `src/handlers/expenseItems/update.ts` | New |
| `src/handlers/expenseItems/delete.ts` | New |
| `src/templates/layout.html` | Add Expenses nav item |
| `serverless.yml` | Wire 4 new httpApi routes |
| `CLAUDE.md` | Add ExpenseItem to DDB key table |
| `MILESTONES.md` | M16 → In progress / Done |

---

## DynamoDB Key Table Addition

```
| ExpenseItem | EXPENSE_ITEM#{sub} | ITEM#{date}#{id} | — | — |
```
