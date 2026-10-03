> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 6 — Private files, photos and documents

Complete backend through Phase 6. Files use the existing PostgreSQL files table and its category/ownership/size rules. The four migrations remain unchanged. No frontend, reports, Azure deployment or new migration is included.

## Local upgrade and storage

Keep your existing private `.env`, database and stored files. Stop the old server, replace source/package files, then run:

```bash
npm ci
npm run db:migrate
npm run typecheck
npm run build
npm test
npm run dev
```

FILES_DIRECTORY defaults to `./var/private-files`; you may add that setting to your existing `.env`. The server creates this dedicated directory with owner-only permissions (0700) and writes files with mode 0600. An existing directory must already have owner-only permissions; on macOS/Linux use `chmod 700 <your-private-directory>`. Symlink directories are rejected. Do not point this setting at your project root, public/static directory or an unrelated shared folder. Custom storage locations must also be excluded from Git and backed up securely.

The default var directory is gitignored. There is no static file-serving route, and code archives exclude live stored objects. Local PostgreSQL plus this private directory together form your development data: back up both. This POSIX-permission adapter is intended for macOS/Linux development/tests; a Windows ACL-aware adapter would need separate validation.

The executable server intentionally refuses production mode with local storage. The future hosting phase must wire durable private storage before enabling production. The new configuration has no Azure credentials, secrets or public URLs. Existing `.env` files continue to work with the default file directory.

## Endpoints

All paths start with `/api/v1/files`. Use the existing session cookie. Uploads require an allowed Origin and X-CSRF-Token.

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Upload raw binary bytes with category/owner query fields |
| GET | `/` | List permitted ACTIVE file metadata |
| GET | `/:id` | Read permitted ACTIVE metadata |
| GET | `/:id/download` | Authorize and stream private bytes through the backend |

Upload returns 201, Location and `{ "data": file }`. Metadata/list responses use the existing data/meta shape; downloads return binary attachment bytes. File IDs are UUIDs. size_bytes is a decimal string. Download paths are relative authenticated API paths, not public object URLs. blob_key and filesystem paths are never returned. No file edit/delete or public preview endpoint is introduced.

## Upload contract

This phase uses a small **raw-binary API**, without multipart/form-data or a new parsing dependency. Send the actual file as the body. Query fields select category and exactly one owner, Content-Type declares the allowed MIME type, and X-File-Name contains the URI-encoded original filename (use encodeURIComponent for Unicode filenames).

| Category | Required query owner | Allowed types | DELIVERY upload |
|---|---|---|---|
| DESIGN_IMAGE | design_id | JPEG, PNG, WebP | Denied |
| ORDER_PRODUCT_IMAGE | order_id | JPEG, PNG, WebP | Assigned ready/delivered orders only |
| ORDER_DOCUMENT | order_id | JPEG, PNG, WebP, PDF | Assigned ready/delivered orders only |
| CUSTOMER_PAYMENT_DOCUMENT | customer_payment_id | JPEG, PNG, WebP, PDF | Denied |
| SUPPLIER_PAYMENT_DOCUMENT | supplier_payment_id | JPEG, PNG, WebP, PDF | Denied |
| EXPENSE_DOCUMENT | expense_id | JPEG, PNG, WebP, PDF | Denied |

ADMIN can upload/read all valid categories linked to an existing owner, including historical inactive/void records. The API rejects absent/foreign owner IDs, mismatched category/owner fields, multiple owners, and client-supplied state/actor/blob keys. It does not alter payment status, totals or profit.

Only delivery-safe instructions/photos belong in ORDER_DOCUMENT or ORDER_PRODUCT_IMAGE. Invoices, payment evidence and expense documents must use their dedicated financial categories. The backend enforces category/ownership permissions; it does not infer business confidentiality from document text.

Example local upload after login (replace IDs, cookie/CSRF placeholders and path):

```bash
curl -X POST 'http://localhost:3000/api/v1/files?category=ORDER_PRODUCT_IMAGE&order_id=REPLACE_ORDER_UUID' \
  -b cookies.txt \
  -H 'Origin: http://localhost:3000' \
  -H 'X-CSRF-Token: REPLACE_CSRF_TOKEN' \
  -H 'Content-Type: image/png' \
  -H 'X-File-Name: product.png' \
  --data-binary '@product.png'
```

For a customer receipt PDF, change the query to category=CUSTOMER_PAYMENT_DOCUMENT&customer_payment_id=<uuid>, Content-Type to application/pdf, X-File-Name to receipt.pdf, and upload the PDF bytes. This request requires ADMIN.

An upload creates a new file ID. There is no upload idempotency key in this phase; after an uncertain response check the file list before automatically posting again. The money-ledger Idempotency-Key behavior remains unchanged.

## Types, size and names

The only MIME types are image/jpeg, image/png, image/webp and application/pdf. The limit is **1–10485760 bytes (10 MiB)**, exactly matching the existing database rule. Authentication/owner preflight happens before raw-body buffering, which has that same hard cap. Nonempty valid files are required.

Filename extensions must match (.jpg/.jpeg, .png, .webp, .pdf). The API checks format signatures/end markers and WebP container size rather than trusting MIME or extension alone. Unsupported SVG/GIF/HTML/ZIP, disguised types, basic truncations and PDFs in image categories are rejected. Names are limited to 200 characters, may be Unicode, and cannot contain path separators, NUL/control characters or . / .. path names. Storage keys are independent generated UUIDs; user filenames never become storage paths.

These are bounded signature checks, not full image/PDF decoding or antivirus/content scanning. Downloads are forced attachments with an explicit validated Content-Type, nosniff and no-store. No inline/public rendering is added. Any future scanning or preview feature must retain the existing authorization boundary.

## Design images and order snapshots

1. Upload DESIGN_IMAGE with design_id. The ACTIVE file belongs to that design.
2. Use the existing ADMIN PATCH /api/v1/designs/:id with `{ "image_file_id": "uploaded-file-uuid" }` to choose its primary image. The existing service validates ACTIVE image ownership.
3. New orders snapshot that file ID. Existing order snapshots retain their original image when the master design changes.

Uploading does not automatically choose a primary design image or rewrite historic orders. All design photos can be listed by ADMIN using design_id; Tanaji does not have design/catalog write access.

## DELIVERY access

Tanaji may upload/read ORDER_PRODUCT_IMAGE and ORDER_DOCUMENT only when their order is assigned to his authenticated UUID and has order status READY_FOR_DELIVERY or DELIVERED. Files remain visible in SENT/ISSUE delivery states because the linked order is still ready for delivery. Unassigned, other-user, draft or cancelled orders are inaccessible.

He may also read an ACTIVE DESIGN_IMAGE **only when its exact file ID is referenced by an assigned order's design_image_file_id snapshot**. Merely sharing a design, being the current catalog image or belonging to that design grants no access. He cannot upload catalog images or read any financial-document category, even if its payment/expense belongs to one of his deliveries.

Assignment, order status and account role/activity are checked through the backend. Uploads recheck them after the storage write under the shared transaction lock; a reassignment or account deactivation during upload causes metadata rejection and byte cleanup. Future requests lose access after reassignment/cancellation; already-authorized in-progress transfers cannot recall bytes already received.

Hidden/missing/PENDING/DELETED file IDs return the same 404. Tanaji's metadata excludes design/financial owner IDs and uploader IDs. No blob key or storage address is exposed to either role.

## Lists and downloads

GET /files accepts page (1 default), limit (20 default, max 100), sort_order (desc default), optional category and at most one owner filter. ADMIN can filter any of order_id, design_id, customer_payment_id, supplier_payment_id or expense_id. DELIVERY can filter only order_id and delivery-safe categories; financial/design-owner filters return 403.

`GET /files?order_id=<uuid>` returns permitted direct order files plus that order's snapshot design image. The order filter itself is scoped for DELIVERY, so a design image shared by multiple orders cannot reveal a foreign order relationship. Counts/page share a repeatable-read snapshot. Only ACTIVE records are listed.

Download using the same authenticated cookie:

```bash
curl -b cookies.txt \
  'http://localhost:3000/api/v1/files/REPLACE_FILE_UUID/download' \
  --output downloaded-file.png
```

The backend checks the database ownership/category, opens the private object, compares its size with the saved record and requires an audit entry before streaming. Missing/corrupt storage returns a generic 503 FILE_UNAVAILABLE without filesystem details. Metadata alone is not an access token; every metadata/download request rechecks ownership.

## Storage abstraction and consistency

src/storage/types.ts defines PrivateStorage: initialize, put, open and delete. The application accepts an injected adapter as createApp's third argument. Storage never authorizes users; the files service owns all category/assignment checks, and returned objects never have public URLs.

Local storage uses a private dedicated directory, random validated keys, exclusive creation, immutable bytes and no-follow file opens. Traversal, overwrite attempts, unsafe directory modes and symlink files are rejected. Streamed reads avoid loading each download into memory; uploads are bounded to 10 MiB in memory.

src/storage/azure-blob.ts provides a ready adapter behind an injected SDK-shaped container port. It checks that the container is private, uploads with ifNoneMatch='*', reads via backend streams and supports compensating deletion. The SDK, credentials, container creation, production factory and deployment are deliberately deferred. It is tested with an offline fake container; no Azure connection was made. Future wiring must use environment/managed credentials and keep the container private, without frontend SAS/public URLs.

SQL and object storage do not share a distributed transaction. The service first writes a complete immutable private object, then rechecks authorization and commits its ACTIVE database record plus FILE_UPLOADED audit in one transaction. A database/audit/authorization failure rolls back metadata and compensates by deleting the newly written object. No PENDING record becomes downloadable, and no ACTIVE record is created for a failed storage write.

Process crashes, ambiguous remote write failures or failed compensating deletion can leave **unreferenced private objects**. They have no readable API record. Failed cleanup emits a secret-free operational event. A future operations step must reconcile keys with files.blob_key before removing orphans; do not delete objects that have database records. This phase adds no public maintenance/deletion endpoint and never deletes historical file rows.

FILE_DOWNLOAD_STARTED is audited before any response bytes are sent; it records access initiation, not guaranteed completion. A required-audit failure blocks delivery of bytes. Interrupted transfers emit a request-ID event without contents/paths. Metadata reads/lists do not add audit rows.

## Files and verification

New files-module routes/validation/service follow the existing folder style. src/storage contains the interface/local/Azure-ready adapters. src/app.ts injects/registers storage; src/server.ts initializes local development storage; config.ts and .env.example add FILES_DIRECTORY; .gitignore excludes default storage. The activity helper explicitly allowlists file metadata fields.

Run npm run typecheck, npm run build and npm test. tests/files.test.ts uses real private filesystem objects, authenticated HTTP requests, PostgreSQL-engine checks and mocked storage failures. Small JPEG/PNG/WebP fixtures are included under tests/fixtures; live uploaded data is excluded from the code archive. See VALIDATION.md for results and environment limits.
