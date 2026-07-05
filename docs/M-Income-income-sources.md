# M-Income — Income Sources

## Goal

Track known, recurring income streams. This is a standing record — not a transaction log. Each source represents a predictable income the user can rely on for budgeting (salary, rental). Ad-hoc and variable income (commissions, bonuses, dividends) are out of scope here — those can be recorded as account balance adjustments.

---

## What Income Is (and Is Not)

| Included | Excluded |
|---|---|
| Monthly salary (fixed) | Annual bonus |
| Rental income (fixed per lease) | Commission payments |
| Regular freelance retainer (fixed monthly) | Dividends |
| Any other predictable, fixed recurring payment | One-off windfalls |

The test: *"Can I confidently predict this amount will arrive next month?"* If yes, it belongs here. If not, it doesn't.

---

## Sub-milestones

### M-Income.A — Entity & Repository
### M-Income.B — CRUD Handler & UI
### M-Income.C — Cash Flow Hub Integration

Each is described below.

---

## M-Income.A — Entity & Repository

### DDB Key Pattern

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| IncomeSource | `INCOME#{sub}` | `INCOME#{id}` | `USER#{sub}` | `INCOME#{createdAt}` |

> Use main-table PK query (`begins_with(SK, 'INCOME#')`) for list pages — avoids GSI eventual consistency after create/redirect.

### TypeScript Interface

```ts
export type IncomeType = 'salary' | 'rental' | 'other';
export type IncomeFrequency = 'monthly' | 'quarterly' | 'annual';

export interface IncomeSource {
  PK: string;               // INCOME#{sub}
  SK: string;               // INCOME#{id}
  id: string;               // uuid
  sub: string;
  type: IncomeType;
  name?: string;            // optional — auto-generated if blank: "Salary income" etc.
  amount: number;           // per-period amount (always positive)
  currency: string;         // ISO 4217
  exchangeRate?: number;    // 1 unit of income currency = X units of user's base currency
  frequency: IncomeFrequency;
  startDate?: string;       // YYYY-MM-DD, optional — defaults to createdAt date
  endDate?: string;         // YYYY-MM-DD, when this income stream ended (soft-end, not delete)
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
```

> No `one_off` frequency — one-off income is not a standing source and belongs in account snapshots.

### Repository — `src/repositories/income.ts`

```ts
queryIncomeByUser(sub)                            // PK=INCOME#{sub}, begins_with SK 'INCOME#', ScanIndexForward=false
getIncome(sub, id)                                // GetCommand by PK+SK
putIncome(item)                                   // PutCommand
updateIncome(sub, id, fields)                     // UpdateCommand
softDeleteIncome(sub, id, deletedBy)              // UpdateCommand: deletedAt, deletedBy
```

- `queryIncomeByUser` returns all non-deleted income sources
- An income source with `endDate` set is still returned — it's historically closed, not deleted. UI shows it greyed out.

### Monthly Equivalent Calculation

```ts
export function toMonthlyAmount(source: IncomeSource): number {
  switch (source.frequency) {
    case 'monthly':   return source.amount;
    case 'quarterly': return source.amount / 3;
    case 'annual':    return source.amount / 12;
  }
}
```

Only active sources (no `deletedAt`, no `endDate` or `endDate >= today`) contribute to the monthly estimate.

### File

`src/types/income.ts` — `IncomeSource`, `IncomeType`, `IncomeFrequency`, `toMonthlyAmount`
`src/repositories/income.ts` — repository functions

### Tests — `test/repositories/income.test.ts`

| Test |
|---|
| `queryIncomeByUser` returns non-deleted sources |
| `queryIncomeByUser` excludes soft-deleted |
| `getIncome` returns item by PK+SK |
| `putIncome` writes item |
| `updateIncome` updates correct fields |
| `softDeleteIncome` sets deletedAt and deletedBy |
| `toMonthlyAmount` — monthly → amount as-is |
| `toMonthlyAmount` — quarterly → amount / 3 |
| `toMonthlyAmount` — annual → amount / 12 |

---

## M-Income.B — CRUD Handler & UI

### Routes

| Method | Path | Action |
|---|---|---|
| GET | `/income` | List all income sources, grouped by type |
| POST | `/income` | Create new income source |
| POST | `/income/{id}` | Update income source |
| POST | `/income/{id}/delete` | Soft-delete income source |

### UI — Feed grouped by type

```
┌─────────────────────────────────────┐
│  Income                    [+ Add]  │
│                                     │
│  Est. monthly income  SGD 7,280     │  ← normalised total (active sources only)
│                                     │
│  ── Salary ──────────────────────  │
│  ┌───────────────────────────────┐  │
│  │ Main job                  ✏️  │  │
│  │ SGD 5,000 / month             │  │
│  └───────────────────────────────┘  │
│                                     │
│  ── Rental ──────────────────────  │
│  ┌───────────────────────────────┐  │
│  │ Woodlands condo           ✏️  │  │
│  │ SGD 2,200 / month             │  │
│  └───────────────────────────────┘  │
│                                     │
│  ── Other ───────────────────────  │
│  ┌───────────────────────────────┐  │
│  │ Freelance retainer        ✏️  │  │
│  │ USD 80 / month                │  │
│  │ ≈ SGD 108                     │  │  ← base equivalent when exchangeRate set
│  └───────────────────────────────┘  │
│                                     │
│  ── Ended ───────────────────────  │  ← sources with endDate in the past
│  ┌───────────────────────────────┐  │
│  │ (greyed out)  Old rental  ✏️  │  │
│  │ SGD 1,800 / month  ended Mar  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Add Form (bottom sheet)

Minimal inputs:

| Field | Required | Default | Notes |
|---|---|---|---|
| Type | Yes | salary | Selector: Salary / Rental / Other |
| Name | No | auto-generated | e.g. "Salary income", "Rental income", "Other income" |
| Currency + Amount | Yes | base currency, blank | Same row (RULES.md) |
| Exchange Rate | No | auto-fetched | Hidden unless currency ≠ base; uses `/fx-rate` with today's date |
| Frequency | Yes | monthly | Selector: Monthly / Quarterly / Annual |
| Start Date | No | today | When this income started |
| Notes | No | blank | Freetext |

No end date on Add form. End date is set via Edit.

### Edit Form (bottom sheet)

Same fields as Add, plus:
- Currency: read-only (disabled input)
- End Date: optional — setting this marks the income as ended (greyed out in list, excluded from monthly estimate)
- Delete button: soft-delete with confirmation

### Handler logic — `src/handlers/income.ts`

**GET `/income`:**
1. Verify session → get financialSettings (for base currency)
2. `queryIncomeByUser(sub)`
3. Split into active vs. ended (endDate < today or deletedAt)
4. Calculate monthly total from active sources (with FX conversion if `exchangeRate` set)
5. Group active by type (salary, rental, other); append ended group if any
6. Render page

**POST `/income`:**
1. Verify session
2. Decode body (isBase64Encoded check)
3. Validate: amount > 0, currency in CURRENCIES, frequency valid
4. Name: trim; if blank, generate from type ("Salary income")
5. startDate: default to `clock.today()` if blank
6. exchangeRate: if provided and > 0, store; omit otherwise
7. `putIncome(item)`
8. Redirect to `/income`

**POST `/income/{id}`:**
1. Verify session
2. Fetch existing → 404 if not found or deleted
3. Validate updated fields (currency cannot change)
4. endDate: if provided and valid YYYY-MM-DD, store; if blank, clear
5. `updateIncome(sub, id, fields)`
6. Redirect to `/income`

**POST `/income/{id}/delete`:**
1. Verify session
2. Fetch → 404 guard
3. `softDeleteIncome(sub, id, session.sub)`
4. Redirect to `/income`

### File

`src/handlers/income.ts`

### Tests — `test/handlers/income.test.ts`

| Test |
|---|
| GET returns 200 with sources grouped by type |
| GET shows monthly estimate |
| GET shows ended group for ended sources |
| GET shows empty state when no sources |
| GET shows base equivalent for non-base-currency source |
| POST creates source and redirects |
| POST auto-generates name when blank |
| POST stores exchangeRate when provided |
| POST omits exchangeRate when not provided |
| POST rejects negative amount |
| POST rejects invalid frequency |
| POST /{id} updates source and redirects |
| POST /{id} sets endDate |
| POST /{id} clears endDate when blank |
| POST /{id}/delete soft-deletes and redirects |
| Unauthenticated GET → 401 |

---

## M-Income.C — Cash Flow Hub Integration

After M-Income.B ships, add an Income card to the Accounts hub and the Cash Flow hub.

### Accounts Hub (`/accounts`) — add Income card

Under a new "Income" section at the bottom of the hub:

```
│  ── Income ──────────────────────  │
│  ┌─────────────────────────────┐    │
│  │ 💰 Income   SGD 7,280 / mo  │ > │  ← tap → /income
│  └─────────────────────────────┘    │
```

### Cash Flow Hub (`/cash-flow`) — add Income summary

Income summary card with est. monthly total and link to `/income`. Detail in M-CashFlow.A.

### `serverless.yml` — new routes

```yaml
income:
  handler: src/handlers/income.handler
  events:
    - httpApi: { method: GET,  path: /income }
    - httpApi: { method: POST, path: /income }
    - httpApi: { method: POST, path: /income/{id} }
    - httpApi: { method: POST, path: /income/{id}/delete }
```

### `CLAUDE.md` update

Add IncomeSource to DDB key pattern table.

---

## Acceptance Criteria

- [ ] `/income` lists all sources grouped by type (salary, rental, other, ended)
- [ ] Monthly estimate shows FX-converted total for active sources only
- [ ] Sources with `endDate < today` are greyed out and excluded from estimate
- [ ] Add form: name optional (auto-generated), currency+amount on same row, exchange rate shown only for non-base currency
- [ ] Edit form: currency read-only, end date field present
- [ ] Soft delete with confirmation
- [ ] Accounts hub shows Income card after M-Income.C
- [ ] 95% coverage maintained
