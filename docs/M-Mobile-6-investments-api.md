# M-Mobile.6 — Investments JSON API (issue #27)

Backend for the mobile Investments screen (kopi-wealth-mobile#7). Auth, error shape and the `{value, partial, reason}` figure shape follow `/v1/accounts` (#25). Full contract: "Investments Routes" in `CLAUDE.md`.

## Routes

| Route | Handler |
|---|---|
| `GET`, `POST /v1/investments` | `src/handlers/v1/investments.ts` |
| `PATCH`, `DELETE /v1/investments/{id}` | same |
| `POST /v1/investments/{id}/value` | same |

## Response shapes (for mobile#7)

```
GET /v1/investments → {
  currency: "SGD",
  total: { value, partial, reason },
  groups: [ {
    type: "etf", label: "ETF",
    total: { value, partial, reason },
    share: 67,                       // % of the Investments total, 1 decimal, null if unknown
    holdings: [ holding, … ]         // oldest first
  }, … ]                             // only types present, in web order
}

holding = {
  id, name, type, institution|null, notes|null,
  currency, value,                   // the holding's own currency
  converted: { value, partial, reason },   // base currency
  updatedAt,
  changeSinceLast: { amount, percent, since } | null,
  due: boolean, daysSince: number
}

POST /v1/investments             → 201 { investment: holding }
PATCH /v1/investments/{id}       → { investment: holding }
POST /v1/investments/{id}/value  → { investment: holding, previous: { value, updatedAt } }
DELETE /v1/investments/{id}      → { ok: true }
```

Types: `stocks etf unit_trust bonds crypto robo reit private_equity insurance_linked other`. Currencies: `SGD USD MYR AUD GBP EUR JPY HKD`.

## DynamoDB

No new keys. Reads: `Query` on `INVEST#{sub}`; `GetItem` on `INVEST#{sub}` / `INVEST#{id}`; `Query` on `INVEST_SNAP#{id}` (newest first, `Limit` 2, or 1 for the value route). Writes: `Put` holding, `Put` `INVEST_SNAP#{id}` / `SNAP#{recordedAt}#{uuid}`, `Update` details/value, `Update` `deletedAt`/`deletedBy`. No Scan, no hard delete.

## Decisions

- **Cost of `changeSinceLast`.** One small Query per holding (limit 2), run in parallel, on `GET /v1/investments` only. A user with 20 holdings makes 20 tiny Queries. No record change was needed: the snapshots already hold the history. A holding with fewer than two snapshots gets `null`, never 0.
- **Grouped response.** Holdings are nested in `groups` (one canonical list) rather than also repeated flat. The server computes every total and share.
- **Totals follow `/v1/assets`.** The Investments total and each group total use `groupMetric()`: when any amount cannot be converted the value is `null` with `partial: true`, `reason: 'fx_unavailable'`. This differs from the web `/investments` page and `/v1/accounts`, which show a partial sum; it was chosen so the total always equals `/v1/assets` (tested). Shares are null when the total is unknown.
- **Shared rules.** `src/lib/investments.ts` is used by the web handler too. Over-long text is truncated, not rejected, as on the web; value must be a number ≥ 0.
- **PATCH vs value.** The web edit form saves details and value together with a snapshot. The API splits them: PATCH changes details only (no snapshot, bumps `updatedAt`), `/value` writes the snapshot. As with accounts, a rename resets the due clock.
- **`due`.** `isDue(daysSince(updatedAt, now, tz))` from `src/lib/finance/due.ts`, with the same timezone default as `buildOverview`; tested to agree with `/v1/overview` `due[]` and `/v1/assets` `dueCount`.
- **Ownership.** Every lookup is keyed by the caller's `sub`; foreign, unknown and deleted ids give the same `404 not_found`.
- **Known web quirk, not changed.** Web `POST /investments/{id}/delete` does not check the holding exists first.
