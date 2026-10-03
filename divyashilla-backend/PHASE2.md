> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 2 — customers, designs and suppliers

Version 0.2.0 extends the existing Express/TypeScript backend. It includes the full Phase 1 code plus these three modules. Auth, sessions, password hashing, CSRF protection, migration runner and health APIs remain available. The four SQL migrations are unchanged; no additional migration is required.

## Upgrade an existing Phase 1 installation

1. Keep your existing `.env`, database and private credentials. Back up your working project before merging the new code files. Do not replace/delete a database or recreate users.
2. Merge the package's files into the existing backend project, preserving `.env`. The archive excludes real credentials and node_modules.
3. From the backend directory run:

```bash
npm ci
npm run typecheck
npm test
npm run dev
```

Stop an already running backend before restarting it. If running compiled JavaScript, run `npm run build` then `npm start` instead. `npm run db:migrate` is safe on a Phase 1 database managed by the existing runner, but there are no new migrations in this phase.

For a new installation, follow README.md. No extra environment variables or runtime dependencies were added. You can run `npm test` in an online development terminal with Node.js 24; the tests use disposable PostgreSQL engines and do not require Docker or your live DATABASE_URL. Actually serving the app still requires a PostgreSQL connection.

## Permissions and deletion

Every customer/design/supplier endpoint is ADMIN-only, including list and detail. Tanaji receives 403 and no business data. Unauthenticated/invalid-session requests receive 401. First-login password change remains required.

Mutations require the existing session cookie, trusted Origin, and X-CSRF-Token. Actor IDs and created/updated timestamps are server/database controlled; unknown payload fields are rejected.

DELETE means **deactivate**, not physically erase. This preserves foreign keys and future order history. Deactivation and reactivation require a reason. Inactive records remain readable by ID; list defaults to active records. Repeating a status change already in effect is a no-op, with no extra audit record or timestamp change. Identical PATCH submissions are also no-ops.

## Routes

For each resource `customers`, `designs` and `suppliers`, use `/api/v1/<resource>`:

| Method | Path | Behavior |
|---|---|---|
| POST | / | Create an active record; 201 and Location header |
| GET | / | Search/filter/paginated list |
| GET | /:id | Read one active or inactive record |
| PATCH | /:id | Update only provided editable fields |
| DELETE | /:id | Deactivate, retaining the row |
| POST | /:id/deactivate | Explicit deactivation alternative |
| POST | /:id/reactivate | Restore active status |

PUT is not implemented: use PATCH for partial updates. Status is changed through deactivate/reactivate, not `is_active` in a generic update. Bodies cannot override id, created_by, updated_by, created_at or updated_at.

## Customer payload

```json
{
  "name": "Example Customer",
  "phone": "+91 98765 43210",
  "city": "Pune",
  "address": "Customer address",
  "notes": "Prefers a morning call"
}
```

- Create requires name, phone and city.
- Address/notes are optional and default to null. PATCH can set either to null; blank text normalizes to null.
- Phone removes spaces, parentheses and hyphens, then requires 7–15 digits with an optional leading +. It is never converted to a number; no country code is silently assumed.
- Shared family phone numbers are allowed. Customer names support Marathi and other Unicode text.

## Supplier payload

```json
{
  "name": "Example Craftsman",
  "phone": "9876543210",
  "city": "Kolhapur",
  "address": "Workshop address",
  "notes": "Stone carving supplier"
}
```

Create requires name and phone. City/address/notes are optional and default to null. Phone normalization matches customers. No supplier payment/ledger fields are exposed by this module.

## Design payload

```json
{
  "design_number": "705",
  "design_name": "Tulsi Vrindavan",
  "size": "3.5 feet",
  "material": "Stone",
  "notes": "Additional catalog notes"
}
```

Create requires design_number, design_name, size and material. Notes are optional. Design numbers are strings so future alphanumeric codes remain possible; uniqueness follows the existing case-sensitive database constraint. Leading/trailing whitespace is trimmed. Duplicate design numbers return 409 with DESIGN_NUMBER_EXISTS for both create and update.

Sizes remain exact text labels, such as `3.15 feet`; the backend does not reinterpret the label as a feet/inches calculation.

Design responses include `image_file_id`, initially null. A PATCH may attach an existing UUID or set it to null. The file must already be an ACTIVE DESIGN_IMAGE owned by this exact design and have an image MIME type. Other designs' files, unregistered IDs, pending/deleted files and arbitrary image_url values are rejected. File bytes/Blob keys are not returned. No upload, file-content, Azure or Blob API is added in Phase 2; new designs can be created without photos. The reference check prepares for the later private-file module without changing your schema.

## Deactivate/reactivate body

Use this body for DELETE, POST deactivate or POST reactivate:

```json
{"reason":"Design no longer offered"}
```

Reasons must be nonblank text, at most 500 characters. Status changes preserve all contact/product details.

## List/search/filter contract

| Query parameter | Meaning/default |
|---|---|
| page | Positive integer, default 1; maximum 100000 |
| limit | Positive integer, default 20; maximum 100 |
| q | Case-insensitive substring search, maximum 100 characters |
| status | active (default), inactive, or all |
| sort_by | Module-specific allowlisted field; default created_at |
| sort_order | asc or desc; default desc |
| city | Customers/suppliers: case-insensitive exact match |
| phone | Customers/suppliers: normalized exact phone match |
| material | Designs: case-insensitive exact match |
| size | Designs: case-insensitive exact match |
| design_number | Designs: exact match |

Customer/supplier q searches name, phone and city. Design q searches number, name, size and material. `%`, `_` and backslash in q are literal text, not unrestricted SQL wildcards. All search/filter values use SQL parameters. Unknown query fields, repeated array-valued query parameters, invalid statuses and invalid sort identifiers return 400.

Sort fields:

- Customers/suppliers: created_at, updated_at, name, city.
- Designs: created_at, updated_at, design_number, design_name, size, material.

Design-number sorting is text sorting, matching the schema. All sorts use id as a stable tie-breaker. List rows and counts use the same read-only repeatable-read transaction snapshot.

Examples:

```text
GET /api/v1/customers?q=patil&city=Pune&status=active&page=1&limit=20
GET /api/v1/suppliers?status=all&sort_by=name&sort_order=asc
GET /api/v1/designs?material=Stone&size=3.5%20feet&sort_by=design_number&sort_order=asc
```

Single-record responses use `{"data":{...}}`. Lists use:

```json
{
  "data": [],
  "meta": {"page":1,"limit":20,"total":0,"total_pages":0}
}
```

Records include id, editable fields, is_active, created_by, updated_by, created_at and updated_at. Timestamps are ISO strings. A page beyond the result set returns an empty data array while preserving the total. A malformed UUID returns 400; a well-formed missing UUID returns 404. Invalid payload/query input returns 400 without SQL details.

## Field limits

| Field | Limit |
|---|---|
| Customer/supplier name, design_name | 120 characters |
| city | 100 characters |
| address | 1000 characters |
| notes | 2000 characters |
| design_number | 40 characters |
| size/material | 80 characters |

Required short text rejects control characters; nullable address/notes may contain normal line breaks but never NUL. PATCH rejects an empty object. Required fields cannot be set to null.

## Activity logs and structure

Each module has routes.ts, validation.ts and service.ts under its existing `src/modules/<name>/` folder. Shared SQL/pagination/status mechanics are in `src/shared/master-records.ts`; common validation is in master-validation.ts. Module definitions are constants; SQL identifiers never come directly from request input.

Events: CUSTOMER/DESIGN/SUPPLIER_CREATED, _UPDATED, _DEACTIVATED and _REACTIVATED. Create/update logs contain explicitly selected business fields before/after, not complete request/session objects. Status logs contain the old/new active flag and required reason. Every event uses the authenticated admin actor and server request ID. Writes and audit inserts commit together; log failure rolls back the record change. Audit notes/contact data remain private, and no activity-log read API is added in this phase.

No new version column was added to master records. PATCH locks the row and changes only submitted fields. Disjoint-field updates preserve other fields; two edits to the same field use the last committed value. Later edit-conflict UI can add an explicit version/precondition if needed.

## Checks

Run `npm run typecheck`, `npm run build` and `npm test`. The added tests cover full CRUD/deactivation/reactivation, audit changes, rollback on failed logs, unauthorized/Tanaji denial, CSRF/origin restrictions, validation, pagination, literal wildcard handling, design-number conflicts, private image ownership/state and Marathi/phone/null handling. All original Phase 1 checks remain in the suite. See VALIDATION.md for executed results and limits.
