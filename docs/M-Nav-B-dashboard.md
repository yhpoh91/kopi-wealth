# M-Nav.B — Dashboard Revamp

## Goal

Slim the dashboard from 6 metric cards to a focused view: one Net Worth hero, three supporting figures, top goals, and a cash flow preview. Remove Current Assets and Total Funds — they are derivable from the Accounts hub.

---

## Current vs. New Layout

**Current:** 6 metric cards in a grid (Net Worth, Total Assets, Current Assets, Total Liabilities, Total Funds, Available Funds)

**New:**

```
┌─────────────────────────────────────┐
│ ☕ Kopi Wealth [PREVIEW]        👤  │
├─────────────────────────────────────┤
│                                     │
│  ╔═════════════════════════════╗    │
│  ║  Net Worth                  ║    │
│  ║  SGD 144,200                ║    │
│  ╚═════════════════════════════╝    │  ← hero card, accent border
│                                     │
│  ┌──────────────────────────────┐   │
│  │ Total Assets      SGD 152,700│   │
│  │ Total Liabilities   SGD 8,500│   │
│  │ Available Funds    SGD 31,200│   │
│  └──────────────────────────────┘   │  ← single stacked card, 3 rows
│                                     │
│  ── Goals ───────────────────────  │
│  ┌──────────────────────────────┐   │
│  │ 🎯 Lean FIRE                 │   │
│  │ SGD 144,200 / SGD 900,000    │   │
│  │ ████░░░░░░░░░░░░  16%        │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ 🎯 First Property            │   │
│  │ SGD 31,200 / SGD 150,000     │   │
│  │ █████░░░░░░░░░░░  21%        │   │
│  └──────────────────────────────┘   │
│  (top 2 active goals only)          │
│                                     │
│  ── Cash Flow (this month) ──────  │
│  ┌──────────────────────────────┐   │
│  │ Income    SGD 7,200          │   │
│  │ Expenses  SGD 1,840          │   │
│  │ Net       SGD 5,360          │   │  ← green if positive, red if negative
│  └──────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│  🏠      🗂️       💸              │
│  Dash  Accounts  Cash Flow          │
└─────────────────────────────────────┘
```

---

## Metrics Removed from Dashboard

| Metric | Removed reason | Still visible at |
|---|---|---|
| Current Assets | Derivable from Accounts hub | Accounts hub (accounts + investments + receivables) |
| Total Funds | Derivable from Accounts hub | Accounts hub (accounts + investments) |

---

## Dashboard Data

| Data | Source | Notes |
|---|---|---|
| Net Worth | accounts + investments + CPF + receivables − liabilities | FX-converted |
| Total Assets | accounts + investments + CPF + receivables | FX-converted |
| Total Liabilities | liabilities (non-settled) | FX-converted |
| Available Funds | accounts + investments − reserved | FX-converted |
| Top 2 goals | `queryGoalsByUser`, sorted by `sortOrder`, limit 2 active | Same calc as M13 |
| Income this month | `queryIncomeByUser` (active sources) → normalise to monthly | Zero if no income sources yet |
| Expenses this month | `queryExpenseItemsByUser` filtered to current YYYY-MM | Sum of amounts in base currency |

One `getOrFetchRates` call at top; passed to all renderers.

---

## Cash Flow Section — Income Before M-Income Ships

Until M-Income.B ships, income sources don't exist. The Cash Flow section on the dashboard:
- **Shows expenses only** if no income sources exist: "SGD 1,840 spent in July"
- **Shows full 3-row card** (Income / Expenses / Net) once at least one income source exists

This avoids a misleading "Net: −SGD 1,840" when income hasn't been set up yet.

---

## Goals Section

- Shows top 2 active goals (sorted by `sortOrder`)
- Progress bar: `current / target × 100%`, capped at 100%
- "View all →" link to `/goals` if more than 2 active goals exist
- If no active goals: "No active goals. Set one up →" with link to `/goals`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/handlers/dashboard.ts` | Revamp render logic — strip 6-card grid, add hero + 3-row card + goals + cash flow |
| `MILESTONES.md` | M-Nav.B → In progress / Done |

---

## Tests

| Test | File |
|---|---|
| Dashboard renders Net Worth hero | `test/handlers/dashboard.test.ts` |
| Dashboard renders Total Assets, Total Liabilities, Available Funds | same |
| Dashboard renders top 2 active goals with progress | same |
| Dashboard renders Cash Flow card when income exists | same |
| Dashboard renders expenses-only when no income sources | same |
| Dashboard renders empty goals state | same |
| Current Assets and Total Funds are NOT in the rendered HTML | same |

---

## Acceptance Criteria

- [ ] Net Worth renders as hero card with accent styling
- [ ] Exactly 3 supporting figures: Total Assets, Total Liabilities, Available Funds
- [ ] Current Assets and Total Funds are gone from dashboard
- [ ] Top 2 active goals shown with progress bars
- [ ] Cash Flow shows Income + Expenses + Net when income data exists
- [ ] Cash Flow shows expenses total only when no income sources exist
- [ ] 95% coverage maintained
