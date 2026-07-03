# M20 — Statement Reconciliation: Match & Backfill

User reviews parsed statement items side-by-side with their logged expense items. Matched rows are flagged automatically. User selects unmatched rows to backfill as new expense items, or explicitly rejects rows they don't want.

Depends on: M19 (StatementItem records must exist)

---

## Matching Logic

A `StatementItem` is considered **matched** if an `ExpenseItem` exists for the same user where:
- `date` matches exactly (YYYY-MM-DD), **and**
- `amount` is within ±0.01 of the statement amount, **and**
- item is not soft-deleted

Match is detected at page-load time in the GET handler and stored as a transient flag (not persisted). The `linkedExpenseItemId` field on `StatementItem` is written when the user **accepts** a row in the review step.

---

## New Route

| Method | Path | Handler |
|---|---|---|
| POST | `/expenses/reconcile/{importId}/review` | `src/handlers/reconcile/review.ts` |

The GET `/expenses/reconcile/{importId}` route from M19 is **extended** (not replaced) to add checkboxes, match badges, and action buttons.

---

## Handler — `POST /expenses/reconcile/{importId}/review`

```ts
// Input (form-encoded): { action: 'accept' | 'reject', itemIds: string[] (multi-value) }
// Accept: create ExpenseItem per selected row, update StatementItem.status → 'accepted',
//         set linkedExpenseItemId
// Reject: update StatementItem.status → 'rejected'

1. Verify session
2. Validate importId belongs to session.sub
3. Decode body — `itemIds` may be multi-value; parse as array
4. For each itemId:
   a. GetItem StatementItem (PK: STMT_ITEM#{importId}, SK: ITEM#{date}#{id})
   b. Verify sub matches; skip if already accepted/rejected
5. If action === 'accept':
   a. For each item: create ExpenseItem (same date, amount, currency, description as name)
   b. Update StatementItem: status → 'accepted', linkedExpenseItemId
6. If action === 'reject':
   a. Update each StatementItem: status → 'rejected'
7. Redirect to /expenses/reconcile/{importId}?done=1
```

**Idempotency:** re-accepting an already-accepted item is a no-op (guard in step 4b). This ensures double-submit doesn't duplicate expense items.

---

## UI Design

### Updated `/expenses/reconcile/{importId}` — Review Table with Actions

```
┌─────────────────────────────────────────────────────┐
│ ← Back to Reconcile                                  │
├─────────────────────────────────────────────────────┤
│  bank-june.pdf · Bank · Jun 2026                     │
│  48 transactions — 12 unmatched, 36 matched ✓        │
│                                                      │
│  Filter: [All ▼]                                     │
│  (All / Unmatched / Matched / Accepted / Rejected)   │
│                                                      │
│  Select all unmatched  [ ]                           │
│                                                      │
│  ┌──┬──────────────┬─────────────────┬──────────┬──────────┐
│  │☐ │ 03 Jul 2026  │ McDonald's      │ SGD 12.50│ Unmatched│
│  ├──┼──────────────┼─────────────────┼──────────┼──────────┤
│  │─ │ 03 Jul 2026  │ Grab Ride       │ SGD 8.00 │ Matched ✓│  ← no checkbox
│  ├──┼──────────────┼─────────────────┼──────────┼──────────┤
│  │☐ │ 02 Jul 2026  │ NTUC FairPrice  │ SGD 45.20│ Unmatched│
│  ├──┼──────────────┼─────────────────┼──────────┼──────────┤
│  │─ │ 01 Jul 2026  │ Singtel         │ SGD 32.00│ Accepted ✓│ ← no checkbox
│  ├──┼──────────────┼─────────────────┼──────────┼──────────┤
│  │─ │ 01 Jul 2026  │ Transfer in     │ SGD 500.0│ Rejected ✗│ ← no checkbox
│  └──┴──────────────┴─────────────────┴──────────┴──────────┘
│                                                      │
│  (2 items selected)                                  │
│                                                      │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │  ✓ Add as expenses  │  │  ✗ Reject selected    │ │
│  └─────────────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Badge colours:**
- `Unmatched` — neutral (muted text, no background) — actionable
- `Matched ✓` — accent colour pill — already in your expense log
- `Accepted ✓` — success green pill — added via reconcile
- `Rejected ✗` — error colour, faint — user dismissed

**Checkbox rules:**
- Only `pending` (Unmatched) rows show a checkbox
- `Matched`, `Accepted`, and `Rejected` rows show `─` (no checkbox, not selectable)
- "Select all unmatched" selects all visible pending rows

**Button states:**
- Both buttons disabled when no rows are selected
- `Add as expenses` is primary (accent); `Reject selected` is secondary (ghost/outline)

### Matched row tooltip

Hovering a `Matched ✓` badge shows a tooltip:
```
Already logged: Grab Ride — SGD 8.00 on 3 Jul 2026
```
(The name and amount of the matching `ExpenseItem`)

This is rendered server-side in the tooltip `data-tip` attribute:
```html
<span class="badge-matched" title="Already logged: Grab Ride — SGD 8.00 on 3 Jul 2026">Matched ✓</span>
```

No JS needed for basic title tooltip; enhanced with CSS tooltip on hover.

### Success banner

After redirect with `?done=1`:
```
┌─────────────────────────────────────────┐
│ ✓ 2 expenses added · 1 item rejected    │
└─────────────────────────────────────────┘
```

### Filter behaviour

The filter `<select>` changes the URL query param and reloads the page (no JS filtering needed). The handler reads `?filter=unmatched|matched|accepted|rejected|all` and applies the appropriate condition on `StatementItem.status`.

---

## Form structure

The table is wrapped in a `<form>` with two submit buttons differentiated by `name="action"`:

```html
<form method="POST" action="/expenses/reconcile/{importId}/review">
  <!-- one hidden input per selectable row -->
  <input type="checkbox" name="itemIds" value="{id}" …>
  …
  <button type="submit" name="action" value="accept">✓ Add as expenses</button>
  <button type="submit" name="action" value="reject">✗ Reject selected</button>
</form>
```

`multi-value` form fields: `new URLSearchParams(body).getAll('itemIds')` returns an array.

---

## JS (inline — minimal)

Only needed for:
1. Enable/disable buttons based on checkbox state
2. "Select all unmatched" checkbox

```js
(function(){
  var checkboxes = document.querySelectorAll('input[type="checkbox"][name="itemIds"]');
  var acceptBtn = document.getElementById('accept-btn');
  var rejectBtn = document.getElementById('reject-btn');
  var selectAll = document.getElementById('select-all');

  function updateButtons(){
    var anyChecked = Array.from(checkboxes).some(function(c){ return c.checked; });
    acceptBtn.disabled = !anyChecked;
    rejectBtn.disabled = !anyChecked;
  }

  checkboxes.forEach(function(c){ c.addEventListener('change', updateButtons); });

  selectAll.addEventListener('change', function(){
    checkboxes.forEach(function(c){ c.checked = selectAll.checked; });
    updateButtons();
  });

  updateButtons();
})();
```

---

## Acceptance → ExpenseItem mapping

When a `StatementItem` is accepted, the created `ExpenseItem` is populated as:

| ExpenseItem field | Source |
|---|---|
| `name` | `statementItem.description` (truncated to 100 chars) |
| `amount` | `statementItem.amount` |
| `currency` | `statementItem.currency` |
| `date` | `statementItem.date` |
| `notes` | `"Imported from statement: {fileName}"` |
| `receiptKey` | not set |
| `lineItems` | not set |

---

## Tests

| Test | Covers |
|---|---|
| GET /reconcile/{id} shows match badges on matched rows | matching |
| GET /reconcile/{id} shows checkboxes only on pending rows | checkbox rules |
| POST /review accept creates ExpenseItems and updates StatementItems | accept flow |
| POST /review reject updates StatementItem status | reject flow |
| POST /review is idempotent — re-accepting doesn't duplicate | idempotency |
| POST /review rejects itemIds from other user's import | auth guard |
| GET /reconcile/{id}?done=1 shows success banner | success banner |
| GET /reconcile/{id}?filter=unmatched shows only pending rows | filter |

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/handlers/reconcile/review.ts` | New |
| `src/handlers/reconcile/detail.ts` | Extend — add match badges, checkboxes, action buttons |
| `MILESTONES.md` | M20 → Done |

---

## Post-M20 Notes

- Users can re-open past imports at any time and continue accepting/rejecting remaining items
- `Matched` items cannot be actioned (the expense already exists); they are informational only
- A future milestone could surface a "reconciliation coverage" metric: what % of statement items are matched or accepted
