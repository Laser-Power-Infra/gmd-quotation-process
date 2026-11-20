# Drawings & QAP API (for the requester's Claude)

This API lets an assistant outside the app keep the **Drawings & QAP** register up to date. It can:

- add a drawing entry to a contract;
- upload drawing PDFs and attach links;
- move an entry through the status flow.

Everything it does is stamped **"Claude (API)"** in the drawing's history. It follows the same rules as the app.

## Where and how

- **Base path:** `/api/drawings` on the quotation app's server, e.g. `https://<app host>/api/drawings`.
- **Key:** send the header `x-api-key: <drawings API key>` on every call.
  - The key is the server's `GMD_DRAWINGS_API_KEY`. Ask the app's admin for it and keep it out of chats and files.
  - The scheduler's key does not work here.
- **Errors** come back as JSON, e.g. `{ "error": "…" }`.
  - For bad input they also name the field: `{ "error": "…", "field": "docType" }`.

| Code | Meaning |
| ---- | ------- |
| 401  | Missing or wrong key. |
| 411  | A POST or PATCH came without a `Content-Length` header (for example a chunked upload). Send the body with its length; `curl -d` and `curl -F` do. |
| 503  | The server has no drawings key set up, or the key is the same as the scheduler's key. |
| 500  | Server error; try again later. |

## Order of calls

1. **GET** the contract: it gives the next free drawing number, the contract details and the drawings it already has.
2. **POST** the new entry. It starts as "Draft prepared".
3. **PATCH** the entry: upload PDFs, attach links, move its status.

## 1. GET: next number, contract, entries

Give **one** of `contractNo` or `poNo`.

```bash
curl -G "https://<app host>/api/drawings" \
  -H "x-api-key: $DRAWINGS_KEY" \
  --data-urlencode "poNo=42009843"
```

`200`:

```json
{
  "nextDrawingNo": "GMDSPL-26110030",
  "contract": {
    "contractNo": "…", "contractor": "LCC Projects Ltd", "client": "…", "project": "…",
    "poNo": "42009843", "contractDate": "18.11.2026", "live": true,
    "lines": [{ "itemCode": "…", "itemName": "…", "size": "…", "pnRating": "…", "orderQty": "…", "approvalDate": null }]
  },
  "entries": [ /* every revision, see "An entry" below */ ]
}
```

- `nextDrawingNo` is only a suggestion. The number is reserved by the POST, not by this call.
- If both are given, `contractNo` is used. At most 100 characters.
- `400`: neither `contractNo` nor `poNo` was given, or the PO no is on several contracts (use the contract no).
- `404`: no such contract or PO in Contract Review.

## 2. POST: add an entry (JSON)

**A POST cannot be undone:** the API and the app have no delete or edit for an entry, and its text stays for good. A new entry also blanks the APPROVAL DATE in Contract Review on the lines it covers (the whole contract when `itemCodes` is left out) until the entry is approved. So confirm the contract from GET first, and send the entry once.

The body is at most 64 KB.

```bash
curl -X POST "https://<app host>/api/drawings" \
  -H "x-api-key: $DRAWINGS_KEY" -H "content-type: application/json" \
  -d '{"poNo": "42009843", "drawingNo": "GMDSPL-26110027", "docType": "Merged set", "preparedBy": "Washim"}'
```

| Field | Required | Notes |
| ----- | -------- | ----- |
| `contractNo` or `poNo` | one of them | The contract the drawing belongs to; text of at most 100 characters. Send one, not both (`400`). |
| `drawingNo` | yes | `GMDSPL-YYMM` + 4 digits, e.g. `GMDSPL-26110030`. Use `nextDrawingNo` for a new drawing, or the existing number of a drawing made before the register. |
| `rev` | no | Whole number, default `0` (shown as R-0). |
| `docType` | yes | Exactly one of: `GAD`, `QAP`, `Cover & list of drawings`, `Datasheet`, `Merged set`. |
| `product` | no | Text: product and sizes covered. At most 2000 characters. |
| `pn`, `standard`, `flangeDrilling`, `remarks` | no | Text, at most 2000 characters each. |
| `preparedBy` | no | Text of at most 2000 characters, default `Claude`. |
| `itemCodes` | no | List of at most 200 of the contract's item codes the drawing covers (from `contract.lines`), each at most 100 characters. Leave it out for the whole contract. |

Any other field is refused with `400`.

| Code | Meaning | Body |
| ---- | ------- | ---- |
| 201 | Created. | `{ "entry": … }` |
| 200 | The same entry was already there (same contract, number, rev and type), so nothing was added. Retrying is safe. | `{ "entry": … }` |
| 400 | Invalid input (including text over its length limit). Also returned when the number is already on this contract under another rev: a new revision is made in the app, not through the API. | `{ "error", "field"? }` |
| 404 | No such contract or PO. | `{ "error" }` |
| 413 | The body is over 64 KB. | `{ "error" }` |
| 409 | The number is taken (by another contract, or by another document type on this one). Use the suggestion. | `{ "error", "suggestedDrawingNo" }` |

For example, `201`:

```json
{ "entry": { "drawingNo": "GMDSPL-26110027", "rev": 0, "status": "Draft prepared", "statusBy": "Claude (API)", "moves": ["Sent to Washim for verification"], "…": "…" } }
```

And `409`:

```json
{ "error": "GMDSPL-26110030 is already used on contract …; next free number GMDSPL-26110031.", "suggestedDrawingNo": "GMDSPL-26110031" }
```

## 3. PATCH: files, links, status (multipart/form-data)

```bash
curl -X PATCH "https://<app host>/api/drawings" \
  -H "x-api-key: $DRAWINGS_KEY" \
  --form-string "drawingNo=GMDSPL-26110027" --form-string "rev=0" \
  --form-string "from=Sent to client" --form-string "status=Approved by client" \
  --form-string "comment=Approved by LCC, mail of 20.11.2026" \
  -F "file=@LCC approved GAD.pdf;type=application/pdf" \
  --form-string "link=https://mail.google.com/mail/u/0/#inbox/…"
```

Use `--form-string` for every text value: with `-F`, curl reads a local file when a value starts with `@` or `<`. Keep `-F` only for `file=@…`.

| Field | Required | Notes |
| ----- | -------- | ----- |
| `drawingNo`, `rev` | yes | Which entry. |
| `status` | no | The status to move to (names below). |
| `from` | recommended with `status` | The status you last read. If the entry has moved on to another status since, the call is refused with `409` and nothing is uploaded. If the entry already has `status`, `from` is not checked (see "Repeating a call"). Without `from`, the server uses the status it reads now. |
| `comment` | no | Saved with the status change, so it needs `status`. At most 4000 characters. |
| `file` | no, repeatable | PDF only, at most 25 MB each and 10 per call. The file name is at most 200 characters, with no control characters. |
| `link` | no, repeatable | A valid `http(s)` link of at most 2000 characters, at most 10 per call. |

The whole request is at most 10 PDFs of 25 MB plus 1 MB. Send at least one of `status`, `file` or `link`. Any other field is refused with `400`; there is no field for a file hash, because the server works it out from the bytes.

| Code | Meaning | Body |
| ---- | ------- | ---- |
| 200 | Done. | `{ "entry": … }` |
| 400 | Invalid input, or a step that is missing what it needs. For example, "Approved by client" without a PDF in the same call. | `{ "error", "field"? }` |
| 403 | A status the API may not set (see below). Checked after the request is read but before the drawing is looked up, anything is uploaded or anything is written. | `{ "error" }` |
| 404 | No such drawing number and rev. | `{ "error" }` |
| 409 | One of these, re-read with GET and decide again: the step is not in the flow from the entry's current status; the entry changed since `from`; the revision is superseded. | `{ "error" }` |
| 413 | A file over 25 MB, or a body too large for 10 such files. | `{ "error" }` |
| 502 | Drive upload failed; nothing was recorded in the register, but some of the files may already be in Drive (a retry uploads them again). Try again later. | `{ "error" }` |
| 503 | Drawing uploads are not set up on the server; retrying will not help. | `{ "error" }` |

### Repeating a call

- **The same status again** (the one the entry already has) does not change the status and answers `200` with `"unchanged": true`. `from` is not checked and a `comment` sent with it is **not saved**: if someone else got there first, check `entry.events` for what was recorded. A `file` or `link` sent with it is still added (a link again is a second copy; the same PDF bytes are not recorded twice).
- A call with only a `file` or `link` (no `status`) also answers `200` with `"unchanged": true`, since the status did not move.
- **The same PDF again** on the same entry is not recorded twice. Drive may still keep a spare copy.
- **The same link again** is added again, so do not repeat a link-only call that succeeded.

## Status names (exactly as the API expects them)

| From | To (`status`) | Needs in the same call |
| ---- | ------------- | ---------------------- |
| Correction required | `Draft prepared` | |
| Draft prepared | `Sent to Washim for verification` | |
| Verified by Washim | `Sent to client` | |
| Sent to client | `Client comments received` | a `comment`, a `file` or a `link` |
| Sent to client | `Approved by client` | an uploaded PDF (`file`); a link does not count |
| Client comments received | `Approved by client` | an uploaded PDF (`file`); a link does not count |

The API cannot set these (`403`):

- `Verified by Washim` and `Correction required`: only Washim sets them, in the app.
- `Superseded`: set when a new revision is made in the app.

Each entry's `moves` lists the statuses the API may move it to right now.

## An entry

The `entry` in POST and PATCH answers, and each item of GET's `entries`, holds:

- `id`, `contractNo`, `drawingNo`, `rev`, `docType`;
- `product`, `pn`, `standard`, `flangeDrilling`, `preparedBy`, `remarks`, `itemCodes`;
- `status`, `statusAt`, `statusBy`, `createdAt`, `updatedAt` (times in ISO, UTC);
- `moves`;
- `events`: the history, oldest first. Each event has `status` (on a status change), `comment`, `fileName`, `fileUrl`, `sha256` (on an uploaded file), `final` (the client-approved copy), `by` and `at`.
