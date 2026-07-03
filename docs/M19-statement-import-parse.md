# M19 — Statement Import: Upload & Parse

User uploads a bank or credit card statement (PDF or CSV). Lambda calls Claude to parse it and extract individual transactions. Results are stored as `StatementItem` records and displayed in a read-only review table.

No accept/reject yet — that is M20. This milestone proves the upload → parse → display pipeline.

Depends on: M16 (ExpenseItem entity must exist; M17 S3 bucket reused)

---

## New DynamoDB Entities

### StatementImport

Represents one uploaded file.

| Attribute | PK | SK |
|---|---|---|
| StatementImport | `STMT_IMPORT#{sub}` | `IMPORT#{createdAt}#{id}` |

```ts
interface StatementImportRecord {
  PK: string;              // STMT_IMPORT#{sub}
  SK: string;              // IMPORT#{createdAt}#{id}
  id: string;              // uuid
  sub: string;
  fileKey: string;         // S3 key: statements/{sub}/{date}/{id}.{ext}
  fileName: string;        // original filename (display only)
  type: 'bank' | 'credit_card' | 'other';
  status: 'processing' | 'done' | 'failed';
  itemCount?: number;      // populated when done
  period?: string;         // YYYY-MM inferred from statement (if determinable)
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}
```

### StatementItem

One transaction row extracted from a statement.

| Attribute | PK | SK |
|---|---|---|
| StatementItem | `STMT_ITEM#{importId}` | `ITEM#{date}#{id}` |

```ts
interface StatementItemRecord {
  PK: string;              // STMT_ITEM#{importId}
  SK: string;              // ITEM#{date}#{id}
  id: string;              // uuid
  importId: string;
  sub: string;             // denormalised for ownership checks
  date: string;            // YYYY-MM-DD
  description: string;     // raw text from statement
  amount: number;          // always positive (debit/expense amounts)
  currency: string;
  status: 'pending' | 'accepted' | 'rejected';
  linkedExpenseItemId?: string;  // populated in M20 on accept
  createdAt: string;
}
```

> No GSI needed: imports queried by `STMT_IMPORT#{sub}`, items queried by `STMT_ITEM#{importId}`.

---

## New Routes

| Method | Path | Handler |
|---|---|---|
| GET | `/expenses/reconcile` | `src/handlers/reconcile/list.ts` |
| POST | `/expenses/reconcile/upload-url` | `src/handlers/reconcile/uploadUrl.ts` |
| POST | `/expenses/reconcile/parse` | `src/handlers/reconcile/parse.ts` |
| GET | `/expenses/reconcile/{importId}` | `src/handlers/reconcile/detail.ts` |

---

## Flow

```
Browser                          Lambda                     S3 / Claude
  │                                 │                            │
  │  GET /expenses/reconcile        │                            │
  │  (upload form + past imports)   │                            │
  │────────────────────────────────>│                            │
  │<────────────────────────────────│                            │
  │                                 │                            │
  │  POST /reconcile/upload-url     │                            │
  │  { ext: "pdf", type: "bank" }   │                            │
  │────────────────────────────────>│                            │
  │  { uploadUrl, importId, fileKey}│                            │
  │<────────────────────────────────│                            │
  │                                 │                            │
  │  PUT {uploadUrl} (file)         │                            │
  │──────────────────────────────────────────────────────────── >│
  │  204                            │                            │
  │< ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
  │                                 │                            │
  │  POST /reconcile/parse          │                            │
  │  { importId }                   │                            │
  │────────────────────────────────>│                            │
  │                                 │  s3.getObject(fileKey)     │
  │                                 │──────────────────────────> │
  │                                 │  buffer                    │
  │                                 │<───────────────────────────│
  │                                 │                            │
  │                                 │  claude: parse statement   │
  │                                 │──────────────────────────> │ (Claude API)
  │                                 │  [{ date, desc, amount }]  │
  │                                 │<───────────────────────────│
  │                                 │                            │
  │                                 │  write StatementItems      │
  │                                 │  update StatementImport    │
  │                                 │  status → 'done'           │
  │                                 │                            │
  │  302 → /reconcile/{importId}    │                            │
  │<────────────────────────────────│                            │
  │                                 │                            │
  │  GET /reconcile/{importId}      │                            │
  │  (review table, read-only)      │                            │
  │────────────────────────────────>│                            │
  │<────────────────────────────────│                            │
```

---

## Claude Statement Parsing Prompt

```
You are a bank statement parser. Extract all expense/debit transactions from this document.

Return a JSON array (no markdown, no explanation):
[
  {
    "date": "YYYY-MM-DD",
    "description": "string",
    "amount": number,
    "currency": "ISO-4217"
  }
]

Rules:
- Include only debit/expense/payment rows (money leaving the account).
- Exclude: credit entries, refunds, transfers between own accounts, opening/closing balance rows.
- amount is always a positive number.
- If currency is not specified per-row, use the statement's primary currency.
- If date format is ambiguous (e.g. 03/07), prefer DD/MM for Singapore statements.
- description: use the raw text from the statement; do not rewrite or abbreviate.
- If you cannot parse a row, omit it — never guess.
```

### Model selection

Use `claude-sonnet-5` for statement parsing. Statements are often multi-page PDFs with complex table layouts; Haiku may miss rows or misalign columns. Sonnet is more reliable for structured document extraction.

---

## Handler — `POST /expenses/reconcile/upload-url`

Same pattern as M17's upload-url, adapted for statements:

```ts
const key = `statements/${sub}/${clock.today()}/${importId}.${ext}`;
// Create StatementImport record with status: 'processing'
// Return { uploadUrl, importId, fileKey }
```

The `importId` is generated here and stored in `StatementImport` before the upload starts. This means the record exists before parsing, so if the user closes the tab mid-way, the import is still tracked.

---

## Handler — `POST /expenses/reconcile/parse`

Called by the browser after the S3 upload completes:

```ts
1. Verify session
2. Get StatementImport record by importId — verify sub matches session
3. s3.getObject(fileKey) → buffer
4. Determine media type (PDF or CSV text)
5. Call Claude with statement parsing prompt
6. Parse JSON array from response
7. Write each row as a StatementItem (status: 'pending')
8. Update StatementImport: status → 'done', itemCount
9. Redirect to /reconcile/{importId}
```

Error handling: if Claude fails or returns invalid JSON → set `status: 'failed'` on the import, redirect to `/reconcile` with `?error=parse_failed`.

---

## Handler — `GET /expenses/reconcile/{importId}`

Displays parsed statement rows in a read-only table. No actions yet (those are M20).

---

## UI Design

### `/expenses/reconcile` — Upload Page

```
┌─────────────────────────────────────┐
│ ☕ Kopi Wealth                  👤  │
├─────────────────────────────────────┤
│  Reconcile                          │
│                                     │
│  Upload a bank or credit card       │
│  statement to find missing expenses │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Statement type              │    │
│  │ [Bank account ▼]            │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  [Choose PDF or CSV]        │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │        Upload & Parse       │    │
│  └─────────────────────────────┘    │
│                                     │
│  ── Past imports ─────────────────  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ bank-june.pdf   Bank          │  │
│  │ 48 transactions · Jun 2026  ↗ │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ cc-may.pdf   Credit card      │  │
│  │ 31 transactions · May 2026  ↗ │  │
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│  🏠   💰   🎯   💸   ···          │
└─────────────────────────────────────┘
```

- "Parsing…" spinner shown while `POST /reconcile/parse` is in flight
- Past imports listed in reverse-date order; clicking → detail page

### `/expenses/reconcile/{importId}` — Review Table (read-only, M19)

```
┌─────────────────────────────────────┐
│ ← Back to Reconcile                 │
├─────────────────────────────────────┤
│  bank-june.pdf                      │
│  48 transactions · Jun 2026         │
│  Status: Parsed ✓                   │
│                                     │
│  Date         Description   Amount  │
│  ─────────────────────────────────  │
│  03 Jul 2026  McDonald's    SGD 12.50│
│  03 Jul 2026  Grab Ride     SGD 8.00 │
│  02 Jul 2026  NTUC FairPr.. SGD 45.20│
│  01 Jul 2026  Singtel       SGD 32.00│
│  …                                  │
│                                     │
│  (Actions available in next update) │
└─────────────────────────────────────┘
```

- Table: date (formatted), description (truncated), amount+currency
- Sorted by date descending
- Pagination at 50 rows
- Status banner: `Parsed ✓ · 48 transactions` / `Processing…` / `Parse failed`
- No checkboxes yet (M20)

---

## Tests

| Test | Covers |
|---|---|
| GET /reconcile shows upload form + past imports | list page |
| POST /upload-url creates StatementImport + returns presigned URL | upload init |
| POST /parse writes StatementItems and updates import status | parsing |
| POST /parse sets status failed on Claude error | error handling |
| GET /reconcile/{importId} shows parsed transactions | detail view |
| GET /reconcile/{importId} returns 404 for unknown id | 404 guard |
| GET /reconcile/{importId} returns 403 for another user's import | auth guard |

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/types/statementImport.ts` | New — `StatementImportRecord`, `StatementItemRecord` |
| `src/repositories/statementImport.ts` | New — get, put, query by user, update status |
| `src/repositories/statementItem.ts` | New — putBatch, queryByImport |
| `src/handlers/reconcile/list.ts` | New |
| `src/handlers/reconcile/uploadUrl.ts` | New |
| `src/handlers/reconcile/parse.ts` | New |
| `src/handlers/reconcile/detail.ts` | New |
| `serverless.yml` | 4 new routes; S3 key prefix for statements |
| `CLAUDE.md` | Add StatementImport + StatementItem to DDB key table |
| `MILESTONES.md` | M19 → Done |

---

## DynamoDB Key Table Additions

```
| StatementImport | STMT_IMPORT#{sub}    | IMPORT#{createdAt}#{id} | — | — |
| StatementItem   | STMT_ITEM#{importId} | ITEM#{date}#{id}        | — | — |
```
