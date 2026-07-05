# M-CashFlow — Cash Flow Hub

## Goal

The Cash Flow tab is the user's window into their money movement: how much comes in, how much goes out, and whether they are living within their means. The hub page (`/cash-flow`) aggregates Income, Expenses, and (eventually) Budget into a single view.

---

## Sub-milestones

### M-CashFlow.A — Hub Page + Summary Cards
### M-CashFlow.B — Net Cash Flow Calculation + Month Picker

---

## M-CashFlow.A — Hub Page + Summary Cards

### Route

`GET /cash-flow`

### Layout

```
┌─────────────────────────────────────┐
│ ☕ Kopi Wealth                  👤  │
├─────────────────────────────────────┤
│  Cash Flow             July 2026    │  ← current month, picker in M-CashFlow.B
│                                     │
│  ── This Month ──────────────────  │
│  ┌──────────────────────────────┐   │
│  │ Income (est.)   SGD 7,280    │   │
│  │ Expenses        SGD 1,840    │   │
│  │ ─────────────────────────── │   │
│  │ Net             SGD 5,440    │   │  ← green if positive, red if negative
│  └──────────────────────────────┘   │
│                                     │
│  ── Sections ────────────────────  │
│  ┌─────────────────────────────┐    │
│  │ 💰 Income      SGD 7,280/mo │ > │  ← → /income
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ 💸 Expenses    SGD 1,840    │ > │  ← → /expenses/items
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ 📋 Budget      Not set up   │ > │  ← → /budget (M-Budget, greyed if not set up)
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│  🏠      🗂️       💸              │
│  Dash  Accounts  Cash Flow          │
└─────────────────────────────────────┘
```

### "Income (est.)" note

Income sources are standing records (monthly/quarterly/annual), not per-transaction. The monthly income figure is an **estimate** — normalised from the standing sources. Label it clearly as "(est.)" to avoid misleading the user when actual bank credits differ.

### Budget card — pre-M-Budget state

Until M-Budget ships, the Budget card is rendered greyed out with label "Not set up" and still links to `/budget` (which returns a "coming soon" stub or 404). This is acceptable as a placeholder — it communicates the feature exists and where it will live without 404ing the nav item.

> RULES.md: Never add a nav item before the destination exists — but here the Cash Flow tab is the nav item; the Budget card within it is an internal link. This is acceptable since the Cash Flow hub page itself fully exists.

### Data fetched

| Data | Source |
|---|---|
| Income est. this month | `queryIncomeByUser` → active sources → `toMonthlyAmount` sum → FX convert |
| Expenses this month | `queryExpenseItemsByUser` filtered to current YYYY-MM → sum in base currency |
| Net | Income − Expenses |

One `getOrFetchRates` call at top.

### File

`src/handlers/cashFlowHub.ts` (already stubbed in M-Nav.A — expand here)

### Tests — `test/handlers/cashFlowHub.test.ts`

| Test |
|---|
| GET renders Income, Expenses, Net summary |
| GET shows green Net when income > expenses |
| GET shows red Net when expenses > income |
| GET shows Income as "(est.)" |
| GET renders Income card with link to /income |
| GET renders Expenses card with link to /expenses/items |
| GET renders Budget card as greyed-out placeholder |
| GET handles zero income sources gracefully (Income shows 0) |
| GET handles zero expenses gracefully |
| Unauthenticated GET → 401 |

---

## M-CashFlow.B — Month Picker + Historical View

### Goal

Allow the user to browse past months' cash flow. The default is the current month. User can step back/forward with prev/next arrows.

### UI Change

```
│  Cash Flow         ◀ June 2026 ▶   │  ← month navigation
```

- `◀` disabled when there's no expense data before this month
- `▶` disabled for future months (current month is the latest)
- Route: `GET /cash-flow?month=2026-06`
- No new DDB patterns — expenses are already queryable by SK prefix `ITEM#{date}`

### Data fetched for selected month

- Income: always the current standing sources normalised to monthly (income sources don't have a month dimension yet — they are standing records)
- Expenses: `queryExpenseItemsByUser` filtered to selected YYYY-MM

### Tests addition

| Test |
|---|
| GET ?month=2026-06 renders June data |
| GET ?month invalid → defaults to current month |
| GET renders prev/next navigation |
| GET disables next arrow for current month |

---

## Acceptance Criteria (M-CashFlow.A)

- [ ] `/cash-flow` shows Income (est.), Expenses, Net for current month
- [ ] Net is green when positive, red when negative
- [ ] Income labelled as "(est.)"
- [ ] Budget card visible but greyed out with "Not set up"
- [ ] Section cards link to correct routes
- [ ] 95% coverage maintained

## Acceptance Criteria (M-CashFlow.B)

- [ ] Month picker navigates to previous months
- [ ] `?month=YYYY-MM` param drives the data
- [ ] Next arrow disabled for current and future months
- [ ] Invalid month param defaults gracefully to current month
