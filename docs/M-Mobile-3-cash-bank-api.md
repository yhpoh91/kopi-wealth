# M-Mobile.3 — Cash & Bank JSON API (issue #25)

Backend for the mobile Assets tab, Cash & Bank list and update-balance sheet. Auth, error shape and the `{value, partial, reason}` figure shape follow `/v1/overview`.

## Routes

See "Cash & Bank and Assets Routes" in `CLAUDE.md` for the full contract.

| Route | Handler |
|---|---|
| `GET`, `POST /v1/accounts` | `src/handlers/v1/accounts.ts` |
| `PATCH`, `DELETE /v1/accounts/{id}` | same |
| `POST /v1/accounts/{id}/balance` | same |
| `GET /v1/assets` | `src/handlers/v1/assets.ts` |
| `GET /v1/fx-rate` | `src/handlers/v1/fxRate.ts` |

## DynamoDB

No new keys. Reads: `Query` on `ACCOUNT#{sub}` and `GetItem` on `ACCOUNT#{sub}` / `ACCOUNT#{id}`. Writes: `Put` account, `Put` `ACCT_SNAP#{id}` / `SNAP#{recordedAt}#{uuid}`, `Update` details/balance, `Update` `deletedAt`/`deletedBy`. No Scan, no hard delete.

## Decisions

- **Shared rules.** Parsers and writers in `src/lib/accounts.ts`; the web handler calls them too. Over-long text is truncated, not rejected, because that is what the web did. Balance must be finite and >= 0 (the web used to accept `Infinity`; now rejected on both).
- **PATCH vs balance.** The web edit form saves details and balance together and snapshots. The API splits them: PATCH changes details only (no snapshot), `/balance` writes the snapshot. Both bump `updatedAt`, as the web does, so `previous.updatedAt` after a rename is the rename time, not the last balance time.
- **Incomplete totals are null.** As in `/v1/overview`, a total with any amount that cannot be converted is `value: null, partial: true, reason: 'fx_unavailable'`.
- **Assets.** `GET /v1/assets` reuses `buildOverview` (`groups` added to `Overview`) and `toOverviewResponse` for `have`/`available`. `dueCount` is 0 until #26.
- **Ownership.** All lookups are keyed by the caller's `sub`; foreign, unknown and deleted ids give the same `404 not_found`.
- **Known web quirk, not changed.** Web `POST /cash-bank/{id}/delete` does not check the account exists first.
