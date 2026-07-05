# M-Budget — Budget

## Goal

Give the user a monthly spending budget per category, then show how actual expenses (from ExpenseItems) track against it. Also compare total expenses against total income (from IncomeSources) to show whether the user is living within their means.

This milestone evolves from the originally-deferred M12 (expense categories with lean/fat budgets). The category concept is retained but simplified: one budget amount per category per month, not two tiers.

---

## Sub-milestones

### M-Budget.A — Budget Categories + Monthly Budget Setup
### M-Budget.B — Budget vs. Actual View
### M-Budget.C — Income vs. Expenses Comparison in Cash Flow

---

## M-Budget.A — Budget Categories + Monthly Budget Setup

### Concept

The user defines a list of **expense categories** (e.g. Food, Transport, Housing). Each category has an optional **monthly budget amount**. Categories are shared across all months — the budget amount is a standing target, not per-month.

When the user logs an expense item (from M16), they can optionally tag it with a category. Tagging is optional — untagged items roll up into "Uncategorised".

> **Out of scope for this milestone:** tagging past expense items. The UI for tagging is added to the expense item Add/Edit form.

### Expense Category Entity

Reuses the existing DDB key pattern already defined:

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| ExpenseCategory | `EXPENSE#{sub}` | `CAT#{id}` | `USER#{sub}` | `EXPENSE_CAT#{sortOrder}#{id}` |

```ts
export type CategoryType =
  | 'housing' | 'food' | 'transport' | 'utilities' | 'insurance'
  | 'healthcare' | 'education' | 'entertainment' | 'clothing'
  | 'personal_care' | 'subscriptions' | 'savings_transfer' | 'other';

export interface ExpenseCategory {
  PK: string;            // EXPENSE#{sub}
  SK: string;            // CAT#{id}
  id: string;
  sub: string;
  type: CategoryType;
  name: string;          // user-defined label (e.g. "Groceries", "Netflix")
  monthlyBudget?: number; // in user's base currency; absent = no budget set
  sortOrder: number;     // lower = shown first
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
```

### Seeded Default Categories

At first use of `/budget` (or optionally at first login), seed these categories for the user:

| Name | Type | Default Budget |
|---|---|---|
| Housing | housing | — |
| Food | food | — |
| Transport | transport | — |
| Utilities | utilities | — |
| Insurance | insurance | — |
| Healthcare | healthcare | — |
| Entertainment | entertainment | — |
| Personal Care | personal_care | — |
| Subscriptions | subscriptions | — |
| Other | other | — |

No default budget amounts — user sets their own.

### Category Tag on Expense Items

Add optional `categoryId?: string` to `ExpenseItem` type and update Add/Edit forms:

```ts
// In src/types/expenseItem.ts
categoryId?: string;  // FK to ExpenseCategory.id (same user)
```

The category selector in the expense item form shows a dropdown of the user's categories. "None" is always available (leaves categoryId unset).

### Routes

| Method | Path | Action |
|---|---|---|
| GET | `/budget` | List categories + edit budget amounts |
| POST | `/budget` | Create new category |
| POST | `/budget/{id}` | Update category name / budget |
| POST | `/budget/{id}/delete` | Soft-delete category |

### UI — `/budget` page

```
┌─────────────────────────────────────┐
│  Budget                    [+ Add]  │
│                                     │
│  Monthly budget total  SGD 3,200    │  ← sum of set budgets
│                                     │
│  ┌──────────────────┬───────────┐   │
│  │ Housing          │  SGD 1,500│ ✏️│
│  │ Food             │  SGD  800 │ ✏️│
│  │ Transport        │  SGD  200 │ ✏️│
│  │ Utilities        │  not set  │ ✏️│
│  │ …                │           │   │
│  └──────────────────┴───────────┘   │
└─────────────────────────────────────┘
```

Edit is inline or bottom sheet — user updates the monthly budget amount and category name.

### Files

- `src/types/expenseCategory.ts`
- `src/repositories/expenseCategory.ts`
- `src/handlers/budget.ts`
- Update `src/types/expenseItem.ts` — add `categoryId?`
- Update `src/handlers/expenseItems.ts` — add category selector to Add/Edit forms
- Update `src/repositories/expenseItem.ts` — persist `categoryId`
- `serverless.yml` — 4 budget routes

---

## M-Budget.B — Budget vs. Actual View

### Goal

For a given month, show each category's budget vs. actual spend, and a total row.

### Route

`GET /budget/month` (or `GET /budget?month=YYYY-MM`)

### UI

```
┌─────────────────────────────────────┐
│  Budget vs Actual      July 2026    │  ← month picker (same as Cash Flow)
│                                     │
│  Total                              │
│  ████████░░░░░░  SGD 1,840 / 3,200 │  ← 57% of total budget
│                                     │
│  ┌──────────────────────────────┐   │
│  │ Food                         │   │
│  │ ███████░░░  SGD 620 / 800    │   │  ← 78%
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ Transport                    │   │
│  │ ██████████  SGD 210 / 200    │   │  ← 105%, over-budget bar red
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ Uncategorised   SGD 120      │   │  ← no budget bar; just total
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

- Over-budget: bar turns red, amount shown in red
- Under-budget: normal accent colour
- No budget set for category: show actual spend only, no bar
- Uncategorised: always shown as a lump sum at the bottom

### Data fetched

1. `queryExpenseCategoriesByUser(sub)` — all active categories
2. `queryExpenseItemsByUser(sub, { month: 'YYYY-MM' })` — all items for the month
3. Group items by `categoryId`; items without `categoryId` → Uncategorised
4. For each category: sum of amounts in base currency (using `exchangeRate` if set)

---

## M-Budget.C — Income vs. Expenses in Cash Flow

### Goal

Upgrade the Cash Flow hub's "Net" calculation to also show budget context:

```
│  ── This Month ──────────────────  │
│  Income (est.)     SGD 7,280       │
│  Budget            SGD 3,200       │  ← total of set category budgets
│  Expenses          SGD 1,840       │  ← actual spend
│  ─────────────────────────────     │
│  vs Budget         +SGD 1,360      │  ← Budget − Expenses (green if positive)
│  vs Income         +SGD 5,440      │  ← Income − Expenses
```

Also: cash flow hub Budget card changes from "Not set up" to showing the budget total and linking to `/budget`.

---

## Acceptance Criteria

### M-Budget.A
- [ ] `/budget` lists categories with budget amounts
- [ ] Add/edit budget amount per category
- [ ] Category selector appears in expense item Add/Edit forms
- [ ] `categoryId` persisted on ExpenseItem
- [ ] 95% coverage maintained

### M-Budget.B
- [ ] Budget vs actual view for current month by default
- [ ] Month picker allows browsing history
- [ ] Over-budget categories shown in red
- [ ] Uncategorised items shown separately
- [ ] 95% coverage maintained

### M-Budget.C
- [ ] Cash Flow hub shows Budget total alongside Income and Expenses
- [ ] "vs Budget" and "vs Income" rows in Net section
- [ ] Budget card in Cash Flow hub shows total (not "Not set up")
- [ ] 95% coverage maintained
