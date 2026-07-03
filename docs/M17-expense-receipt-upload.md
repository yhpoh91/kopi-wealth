# M17 — Expense Items: Receipt Photo Upload

Adds S3 photo storage to expense items. User can attach a receipt image; it is stored permanently. No AI extraction yet — the user still fills in all fields manually. The photo is displayed in the expense detail view.

Depends on: M16 (ExpenseItem entity + CRUD routes must exist)

---

## Infrastructure

### S3 Bucket

```yaml
# serverless.yml — resources section
WealthReceiptsBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: wealth-${self:provider.stage}-receipts
    CorsConfiguration:
      CorsRules:
        - AllowedOrigins: ['*']
          AllowedHeaders: ['*']
          AllowedMethods: [PUT]
          MaxAge: 3000
    LifecycleConfiguration:
      Rules:
        - Id: AbortIncompleteUploads
          Status: Enabled
          AbortIncompleteMultipartUpload:
            DaysAfterInitiation: 1
```

- Private by default (no public-read ACL)
- CORS allows browser `PUT` for presigned upload
- Lambda IAM policy: `s3:PutObject` + `s3:GetObject` on `wealth-{stage}-receipts/*`

### Key layout

```
receipts/{sub}/{YYYY-MM-DD}/{id}.{ext}
```

Example: `receipts/google-oauth2|123/2026-07-03/a1b2c3d4.jpg`

---

## New Routes

| Method | Path | Handler |
|---|---|---|
| POST | `/expenses/items/upload-url` | `src/handlers/expenseItems/uploadUrl.ts` |
| GET | `/expenses/items/{id}` | `src/handlers/expenseItems/detail.ts` |

---

## Upload Flow

```
Browser                    Lambda                       S3
  │                           │                          │
  │  POST /expenses/items/    │                          │
  │  upload-url               │                          │
  │  { ext: "jpg" }           │                          │
  │──────────────────────────>│                          │
  │                           │ s3.getSignedUrl           │
  │                           │  (PutObject, 5min TTL)   │
  │                           │─────────────────────────>│
  │                           │<─────────────────────────│
  │  { uploadUrl, receiptKey }│                          │
  │<──────────────────────────│                          │
  │                           │                          │
  │  PUT {uploadUrl} (binary) │                          │
  │─────────────────────────────────────────────────────>│
  │  204 No Content           │                          │
  │<─────────────────────────────────────────────────────│
  │                           │                          │
  │  (user fills form, then)  │                          │
  │  POST /expenses/items     │                          │
  │  { receiptKey, amount, …} │                          │
  │──────────────────────────>│                          │
  │  302 → /expenses/items    │                          │
  │<──────────────────────────│                          │
```

1. User taps "Add receipt" in the Add form
2. Browser calls `POST /expenses/items/upload-url` with the file extension
3. Lambda generates a presigned PUT URL (5-min TTL) and a `receiptKey`
4. Browser uploads directly to S3 (no Lambda involvement — no 10MB Lambda payload limit)
5. `receiptKey` is stored in a hidden `<input>` in the Add form
6. On form submit, `receiptKey` is included in `POST /expenses/items`

---

## Handler — `POST /expenses/items/upload-url`

```ts
// Input: { ext: string } — allowed: jpg, jpeg, png, heic, webp, pdf
// Output: { uploadUrl: string, receiptKey: string }

const allowedExts = ['jpg', 'jpeg', 'png', 'heic', 'webp', 'pdf'];
const ext = (params.ext ?? '').toLowerCase();
if (!allowedExts.includes(ext)) return { statusCode: 400, body: '{"error":"unsupported file type"}' };

const key = `receipts/${sub}/${clock.today()}/${uuidv4()}.${ext}`;
const uploadUrl = await s3.getSignedUrl('putObject', {
  Bucket: `wealth-${config.stage}-receipts`,
  Key: key,
  ContentType: mimeFor(ext),
  Expires: 300, // 5 minutes
});
return { statusCode: 200, body: JSON.stringify({ uploadUrl, receiptKey: key }) };
```

JSON response (not a redirect) — consumed by client-side JS.

---

## Handler — `GET /expenses/items/{id}`

Shows a single expense item with:
- Receipt image (if `receiptKey` set) via presigned GET URL (15-min TTL)
- All fields: name, amount, currency, date, notes
- Edit button → opens edit sheet

---

## UI Design

### Add Form (extended)

```
┌─────────────────────────────────────┐
│  Add Expense                    [✕] │
│                                     │
│  📷 Add Receipt (optional)          │
│  ┌─────────────────────────────┐    │
│  │  [Choose photo / file]      │    │  ← <input type="file"> styled button
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │  ← preview thumbnail (hidden until chosen)
│  │  [receipt thumbnail]        │    │
│  └─────────────────────────────┘    │
│  Uploading… ████░░░░ 60%            │  ← progress bar (JS)
│                                     │
│  Name (optional)                    │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ Currency     │ │ Amount       │  │
│  │ [SGD ▼]     │ │ 0.00         │  │
│  └──────────────┘ └──────────────┘  │
│  …date, notes…                      │
│                                     │
│  [        Add Expense             ] │
└─────────────────────────────────────┘
```

- `<input type="file" accept="image/*,.pdf">` — mobile triggers camera roll / camera
- On change: preview thumbnail shown immediately (via `URL.createObjectURL`)
- JS calls `POST /upload-url` then `PUT` to S3; progress bar tracks `XMLHttpRequest.upload.onprogress`
- Add button disabled while upload in progress
- `receiptKey` stored in a hidden `<input name="receiptKey">`

### Expense Detail View — `/expenses/items/{id}`

```
┌─────────────────────────────────────┐
│ ← Back                         [✏️] │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │      [receipt image]        │    │  ← img, max-height 300px, object-fit:contain
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  Lunch at Lau Pa Sat                │  ← name, large
│  SGD 12.50                          │  ← amount, accent colour
│  3 Jul 2026                         │  ← date
│  ─────────────────────────          │
│  Notes: —                           │
│                                     │
└─────────────────────────────────────┘
```

- Receipt image: presigned GET URL with 15-min TTL, `<img>` with `max-width:100%; max-height:300px; object-fit:contain`
- No receipt: image section hidden
- `[← Back]` link goes to `/expenses/items`
- `[✏️]` opens edit bottom sheet (same as list-page edit sheet)

---

## JS (inline in list/add page)

```js
(function(){
  var fileInput = document.getElementById('receipt-input');
  var preview = document.getElementById('receipt-preview');
  var receiptKeyInput = document.getElementById('receipt-key');
  var progressBar = document.getElementById('upload-progress');
  var submitBtn = document.getElementById('submit-btn');

  fileInput.addEventListener('change', function(){
    var file = fileInput.files[0];
    if (!file) return;
    // show preview
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
    // upload
    var ext = file.name.split('.').pop().toLowerCase();
    submitBtn.disabled = true;
    fetch('/expenses/items/upload-url', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: 'ext=' + encodeURIComponent(ext),
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', data.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = function(e){
        if (e.lengthComputable) {
          progressBar.style.display = 'block';
          progressBar.value = (e.loaded / e.total) * 100;
        }
      };
      xhr.onload = function(){
        receiptKeyInput.value = data.receiptKey;
        submitBtn.disabled = false;
        progressBar.style.display = 'none';
      };
      xhr.send(file);
    });
  });
})();
```

No framework. Pure vanilla JS kept inline in the template body.

---

## Tests

File: `test/handlers/expenseItems/uploadUrl.test.ts`

| Test | Covers |
|---|---|
| POST /upload-url returns uploadUrl and receiptKey | happy path |
| POST /upload-url rejects unsupported extension | validation |
| POST /upload-url requires auth | auth guard |
| GET /{id} returns detail page with receipt img | with receipt |
| GET /{id} hides image section when no receiptKey | no receipt |
| GET /{id} returns 404 for unknown id | 404 guard |

The S3 `getSignedUrl` call is mocked. No real S3 calls in unit tests.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/handlers/expenseItems/uploadUrl.ts` | New |
| `src/handlers/expenseItems/detail.ts` | New |
| `src/lib/s3.ts` | New — `getSignedUrl(bucket, key, op, ttl)` wrapper |
| `serverless.yml` | Add S3 bucket resource + IAM policy + 2 new routes |
| `MILESTONES.md` | M17 → Done |
