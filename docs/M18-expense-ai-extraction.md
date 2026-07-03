# M18 — Expense Items: AI Receipt Extraction

Plugs Claude vision into the M17 upload flow. After a photo is uploaded to S3, the user can trigger extraction. Claude reads the image and returns structured data: merchant, date, total, and line items. The form pre-fills from the extracted data; the user reviews and edits before saving.

Depends on: M17 (S3 upload flow must exist)

---

## New Route

| Method | Path | Handler |
|---|---|---|
| POST | `/expenses/items/extract` | `src/handlers/expenseItems/extract.ts` |

---

## Extraction Flow

```
Browser                    Lambda                      Claude API
  │                           │                             │
  │  (after S3 upload)        │                             │
  │  POST /expenses/items/    │                             │
  │  extract                  │                             │
  │  { receiptKey }           │                             │
  │──────────────────────────>│                             │
  │                           │ s3.getObject(key)           │
  │                           │ → binary buffer             │
  │                           │                             │
  │                           │ anthropic.messages.create   │
  │                           │  model: claude-haiku-4-5    │
  │                           │  image: base64 buffer       │
  │                           │  prompt: see below          │
  │                           │────────────────────────────>│
  │                           │                             │
  │                           │ { merchant, date, total,    │
  │                           │   currency, lineItems[] }   │
  │                           │<────────────────────────────│
  │                           │                             │
  │  { merchant, date,        │                             │
  │    total, currency,       │                             │
  │    lineItems }            │                             │
  │<──────────────────────────│                             │
  │                           │                             │
  │  (JS pre-fills form)      │                             │
```

---

## Claude Extraction Prompt

```
You are a receipt parser. Extract structured data from this image.
Return a JSON object (no markdown, no explanation) with these exact fields:

{
  "merchant": string | null,       // business name
  "date": string | null,           // YYYY-MM-DD format
  "total": number | null,          // final amount paid (positive)
  "currency": string | null,       // ISO 4217 code (e.g. "SGD")
  "lineItems": [                   // individual line items
    { "name": string, "amount": number }
  ]
}

Rules:
- If the image is not a receipt (e.g. a handwritten note with a number, a photo of a price tag),
  still extract total and currency if visible. Leave other fields null.
- If you cannot determine a field, set it to null — never guess.
- lineItems should reflect what appears on the receipt; omit if unclear.
- Amounts are always positive numbers (not strings).
```

### Model selection

Use `claude-haiku-4-5-20251001` — vision capable, fast, low cost. Sufficient for structured extraction. Can be upgraded to Sonnet in future if accuracy is insufficient.

### Secrets Manager

Store the Anthropic API key at: `wealth/{stage}/anthropic-api-key`

Retrieved via `src/lib/secrets.ts` (existing cache — 5-min TTL per cold start).

---

## Handler — `POST /expenses/items/extract`

```ts
// Input (form-encoded): { receiptKey: string }
// Output: JSON { merchant, date, total, currency, lineItems }

1. Verify session
2. Validate receiptKey: must match pattern receipts/{sub}/...  (prevent path traversal)
3. s3.getObject(bucket, receiptKey) → ArrayBuffer
4. Determine media type from extension: jpg/jpeg → image/jpeg, png → image/png,
   heic → image/heic, webp → image/webp, pdf → application/pdf
5. base64-encode buffer
6. secrets.get('anthropic-api-key') → apiKey
7. POST to https://api.anthropic.com/v1/messages
   Headers: x-api-key, anthropic-version: 2023-06-01
   Body: {
     model: 'claude-haiku-4-5-20251001',
     max_tokens: 1024,
     messages: [{
       role: 'user',
       content: [
         { type: 'image', source: { type: 'base64', media_type, data: base64 } },
         { type: 'text', text: EXTRACTION_PROMPT }
       ]
     }]
   }
8. Parse response.content[0].text as JSON
9. Store rawExtraction on item (for debugging)
10. Return 200 { merchant, date, total, currency, lineItems }
```

Error handling: if Claude returns unparseable JSON, or network fails, return `{ error: 'extraction_failed' }` — client shows a toast and lets the user fill in manually. Never block the expense from being saved.

---

## Storing Extraction Results

`ExpenseItemRecord` gains two new optional fields (added in M18):

```ts
lineItems?: string;       // JSON.stringify([{ name, amount }])
rawExtraction?: string;   // full Claude response text (for debugging)
```

These are stored when the user submits the Add form after extraction. The `rawExtraction` is never displayed in the UI — it is kept for debugging only.

---

## UI Design

### Updated Add Form Flow

**Before photo chosen:**
```
  📷 Add Receipt (optional)
  [Choose photo / file]
```

**After photo chosen + upload complete:**
```
  📷 Receipt added ✓          [Remove]
  [receipt thumbnail — 80×80px]

  [✨ Extract details]   ← new button, appears after upload completes
```

**After extraction completes:**
```
  📷 Receipt added ✓          [Remove]
  [receipt thumbnail]

  ✓ Details extracted — review below

  Name (optional)
  ┌─────────────────────────────┐
  │ McDonald's                  │  ← pre-filled from merchant
  └─────────────────────────────┘

  ┌──────────────┐ ┌──────────────┐
  │ Currency     │ │ Amount       │
  │ [SGD ▼]     │ │ 12.50        │  ← pre-filled from total
  └──────────────┘ └──────────────┘

  Date
  ┌─────────────────────────────┐
  │ 2026-07-03                  │  ← pre-filled from receipt date
  └─────────────────────────────┘

  Line items extracted:
  • Big Mac Meal         SGD  8.50
  • McFlurry             SGD  4.00
  (collapsed by default, expand via "Show line items")

  [        Add Expense             ]
```

**If extraction fails:**
```
  ⚠ Could not extract details — please fill in manually.
```
Form remains blank; user fills manually. Never blocks them.

**Extraction in progress:**
```
  ✨ Extracting details…   ████████░░  (spinner)
```
Add button remains disabled.

### Detail View (M17 extended)

After M18, the detail page also shows a "Line items" section if present:

```
  Lunch at McDonald's
  SGD 12.50 · 3 Jul 2026
  ─────────────────────
  Line items:
  • Big Mac Meal         SGD 8.50
  • McFlurry             SGD 4.00
  ─────────────────────
  Receipt [view image ↗]
```

---

## JS (inline in add form)

```js
var extractBtn = document.getElementById('extract-btn');
var lineItemsContainer = document.getElementById('line-items-preview');

extractBtn.addEventListener('click', function(){
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting…';

  fetch('/expenses/items/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'receiptKey=' + encodeURIComponent(receiptKeyInput.value),
  })
  .then(function(r){ return r.json(); })
  .then(function(data){
    if (data.error) {
      document.getElementById('extract-msg').textContent =
        '⚠ Could not extract details — please fill in manually.';
      extractBtn.style.display = 'none';
      return;
    }
    // pre-fill form fields
    if (data.merchant) nameInput.value = data.merchant;
    if (data.total)    amountInput.value = data.total.toFixed(2);
    if (data.currency) currencySelect.value = data.currency;
    if (data.date)     dateInput.value = data.date;
    // store line items in hidden field
    if (data.lineItems && data.lineItems.length) {
      lineItemsInput.value = JSON.stringify(data.lineItems);
      renderLineItemsPreview(data.lineItems);
    }
    document.getElementById('extract-msg').textContent =
      '✓ Details extracted — review below';
    extractBtn.style.display = 'none';
  })
  .catch(function(){
    document.getElementById('extract-msg').textContent =
      '⚠ Extraction failed — please fill in manually.';
    extractBtn.disabled = false;
    extractBtn.textContent = '✨ Extract details';
  });
});

function renderLineItemsPreview(items) {
  lineItemsContainer.innerHTML = items.map(function(item){
    return '<li>' + escHtml(item.name) + ' &nbsp; ' + escHtml(String(item.amount.toFixed(2))) + '</li>';
  }).join('');
  lineItemsContainer.style.display = 'block';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
```

---

## Tests

File: `test/handlers/expenseItems/extract.test.ts`

| Test | Covers |
|---|---|
| POST /extract returns structured data | happy path |
| POST /extract pre-fills merchant, date, total, lineItems | field extraction |
| POST /extract returns extraction_failed on Claude error | error handling |
| POST /extract returns extraction_failed on JSON parse error | malformed response |
| POST /extract rejects receiptKey not belonging to user | path traversal guard |
| POST /extract requires auth | auth guard |

Claude API call is mocked via `vi.mock` on the fetch/http module. No real Claude calls in unit tests.

---

## Secrets

Add `wealth/{stage}/anthropic-api-key` to:
- `serverless.yml` deploy step (ensure secret exists, same pattern as `sso-client-secret`)
- Secrets Manager in both preview and prod environments (manual one-time setup)

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/handlers/expenseItems/extract.ts` | New |
| `src/lib/anthropic.ts` | New — `extractReceipt(imageBuffer, mediaType)` |
| `serverless.yml` | Add `anthropic-api-key` secret bootstrap + 1 new route |
| `MILESTONES.md` | M18 → Done |

---

## Learning to Record (LEARNINGS.md, post-M18)

- Claude Haiku vision API: base64 encode S3 object, send as `image` content block
- Always gracefully degrade: extraction failure must never block the save flow
- `receiptKey` path must be validated against `receipts/{sub}/` prefix to prevent one user accessing another's uploads
