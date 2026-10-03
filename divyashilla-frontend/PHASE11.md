> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 11 — Delivery and private files

This extends Phase 10 without new migrations or Azure deployment. React uses only the existing backend APIs with session cookies and CSRF protection. Database and storage access remain on the backend.

## Delivery screens

ADMIN can list all deliveries, search/filter/paginate, inspect safe customer/design snapshots and assign an active DELIVERY user. Tanaji sees only assigned deliveries: his dashboard provides expected-today, ready, sent and issue queues. List filters use URL state and server pagination. Both roles use delivery-safe responses; these screens do not fetch order financials, payments, suppliers or reports.

Ready deliveries can be sent with required driver number and driver/bus name; bus number is optional. Sent deliveries permit driver edits and completion. Completion uses the backend transaction that also marks the order DELIVERED. Issue requires a reason. Delivered records are closed. The existing backend has no ISSUE-resolution endpoint, so issue deliveries pause and ask Ayush for help rather than inventing a transition. Backend permissions remain authoritative.

Updates carry the backend version. A stale version retains entered values, blocks another write and offers explicit reload of the latest delivery. Reassignment revokes the previous driver's delivery and file access. ADMIN can unassign only where the backend permits it. Session role changes clear cached delivery results and file metadata/previews.

## Files on existing record pages

| Record | ADMIN | DELIVERY |
| --- | --- | --- |
| Design detail | Upload/list/download/preview images; choose primary image | No master screen; assigned order's snapshot image only |
| Order/delivery detail | Product images and delivery documents | Safe photos/documents for assigned delivery orders |
| Customer payment detail | Upload/list/download documents | No access |
| Supplier payment detail | Upload/list/download documents | No access |
| Expense detail | Upload/list/download documents | No access |

Supported formats are JPEG, PNG, WebP and PDF, with the database's inclusive 10 MiB limit. Image categories accept only images. The browser checks names, size, MIME and extensions; the existing backend validates bytes, owner/category rules and permissions. Financial evidence belongs on its financial record, not in an order document accessible to a delivery user.

Files upload as raw binary to `/api/v1/files` with category, exact owner, encoded filename and CSRF headers. Lists use the same owner/category scope and pagination. Downloads use authenticated `/files/:id/download` requests; there are no public blob links or storage credentials. Image previews use temporary object URLs revoked when closed or unmounted; PDFs download rather than render inline. File list/read failures offer retry.

Uploads are not idempotent. If a successful response is lost, the UI requires refreshing and checking the list before permitting another selection; it does not silently retry and duplicate a file. Selecting a design primary image uses the existing design PATCH API. Existing order snapshots keep their original image; only newly created snapshots use the updated primary.

## Small backend integration fix

`GET /api/v1/deliveries/assignees` is ADMIN-only and returns just `id`, `name`, `username` for active DELIVERY users. It supports validated search, exact ID and pagination for the selector. It excludes inactive users and ADMIN accounts. The four changed backend files are delivery routes, validation, service and delivery tests. Existing delivery authorization, transactions, files, migrations and dependencies are unchanged.

## Run locally

Follow README.md in this frontend and the backend README. Use Node.js 24 and `npm ci` in both sibling folders. Keep your existing private backend configuration, PostgreSQL data and private upload directory. Start backend with `npm run dev`, then frontend with `npm run dev` and open http://localhost:5173. Apply the included backend source fix alongside the frontend; no migration is needed for an existing Phase 10 installation.

Tests use disposable database records and a temporary private file directory, never the business database or existing uploads. See VALIDATION.md for results and limits.
