> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 3 — Orders

Includes the complete Phase 1 and Phase 2 backend. Orders follow the same routes → validation → service → parameterized SQL structure. Sessions, CSRF protection, permissions and audit logging are reused. Every order endpoint requires ADMIN access; Tanaji receives 403 and no financial data.

## Upgrade from Phase 2

Replace the source/package files with this package, retaining your private `.env` and PostgreSQL data. Stop the old server first. Run `npm ci`, `npm run db:migrate`, `npm run typecheck`, `npm test`, then `npm run dev`. All four SQL migrations are unchanged; the migration runner skips migrations already applied. No database reset or new migration is needed. New installations should follow README.md.

## Endpoints

Base path: `/api/v1/orders`. Use your existing session cookie. POST/PATCH requests must include an allowed `Origin` and the `X-CSRF-Token` returned by login or `/api/v1/auth/me`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Create a NEW order; return 201 and Location |
| GET | `/` | Search, filter and paginate orders |
| GET | `/:id` | Read an order and derived financial totals |
| PATCH | `/:id` | Update editable details using the current version |
| POST | `/:id/status` | Change status using the current version and a reason |

There is no DELETE endpoint: cancel an order and keep its history. Responses use `{ "data": ... }`. Lists additionally include `meta.page`, `limit`, `total` and `total_pages`. Order IDs are UUIDs. Order numbers and amounts are decimal strings, so clients can avoid JavaScript precision loss. Dates are `YYYY-MM-DD`; timestamps are UTC ISO strings. List rows contain the stored order fields; single-order/create/update/status responses additionally contain `balance_amount`, `customer_net_received`, `delivery_expense`, `other_expense`, `profit` and `actual_delivery_date`.

## Create

```json
{
  "customer_id": "replace-with-customer-uuid",
  "design_id": "replace-with-design-uuid",
  "supplier_id": "replace-with-supplier-uuid",
  "order_date": "2026-10-01",
  "expected_delivery_date": "2026-10-15",
  "selling_price": "15000.00",
  "buying_price": "9500.00",
  "advance_amount": "5000.00",
  "additional_work": "Engrave the family name"
}
```

Only `customer_id`, `design_id` and `selling_price` are required. Customer and design must be active. Supplier is optional for a NEW draft; a supplied supplier must be active. Buying price defaults to unknown (`null`), advance target to `0.00`, expected delivery date and additional work to `null`. An omitted order date comes from PostgreSQL using India time, not the client computer clock. Work cannot begin until a supplier and buying price are present. A zero buying price is valid if intentional.

Send money as a nonnegative string with up to 12 integer digits and two decimal places; numbers, negatives, exponent notation and excess precision are rejected. Advance cannot exceed selling price. Expected delivery cannot precede the order date. `advance_amount` is the agreed target, not proof of payment: creating an order does not insert a customer payment or reduce the outstanding balance.

PostgreSQL's existing `GENERATED ALWAYS AS IDENTITY` allocates order numbers starting at 1001. The unique constraint and immutable-number trigger protect them. The backend never counts rows or calculates the next number. Rollbacks can leave sequence gaps; these are normal. Existing databases continue their current sequence. Each successful POST creates an order; unique numbers do not provide request idempotency, so do not automatically retry an uncertain create response without checking for the resulting order.

## Snapshots and edits

On creation the backend copies customer name/phone/city/address into `delivery_name`, `delivery_phone`, `delivery_city`, `delivery_address`. It copies design number/name/size/material/image ID into the corresponding snapshot columns. Size remains text (for example `3.15 feet`). The image must be an ACTIVE image belonging to that design; the API stores a file ID, not a public blob URL.

Later changes to a customer or design do not alter the order. Optional `delivery_name`, `delivery_phone`, `delivery_city`, `delivery_address` on create or PATCH allow a different recipient/address. Phone formatting is normalized. Snapshot design fields cannot be supplied by the client. This phase does not upload, download or render files.

```json
{
  "version": 1,
  "expected_delivery_date": "2026-10-18",
  "delivery_address": "Customer's requested delivery address",
  "additional_work": "Add a carved border"
}
```

PATCH accepts create fields plus mandatory `version`, and needs at least one editable field. It merges the patch with the saved record before validating prices and dates. Customer/design/supplier links may change only while NEW and only without existing payment/allocation/expense history. Changing customer or design refreshes that snapshot; explicit recipient overrides in the same request take precedence. Unchanged links preserve old snapshots even if the master record has since become inactive. Delivered/cancelled orders cannot be edited. Reducing selling price below existing net receipts is rejected.

The backend locks the order and checks the version supplied by the client. PostgreSQL increments it after each real update. A stale version returns 409 `VERSION_CONFLICT`; read the order again before saving. Identical updates are no-ops and do not increment the version or create duplicate audit entries. Order number, status, profit, timestamps, actor IDs, assigned delivery user and design snapshot fields cannot be altered through PATCH.

## Status flow

```json
{
  "version": 2,
  "order_status": "IN_WORK",
  "reason": "Supplier has started carving"
}
```

The allowed forward path is `NEW → IN_WORK → READY_FOR_DELIVERY → DELIVERED`. Skipping or moving backward returns 409. NEW, IN_WORK or READY_FOR_DELIVERY may become CANCELLED before dispatch; a nonblank reason is required for every status request. Delivered and cancelled orders are terminal. Repeating the same status with the current version is a no-op.

READY_FOR_DELIVERY also sets the existing delivery record to READY_FOR_DELIVERY. The schema creates that delivery record automatically when an order is inserted. Cancellation returns it to NOT_ASSIGNED and retains the order and all history. It does not issue refunds or reverse supplier liabilities; later financial modules must handle those actions explicitly.

**DELIVERED requires an existing SENT delivery with driver number and driver/bus name.** The service then stamps `delivered_at` using the database clock and changes both statuses in one transaction. Without valid dispatch details it returns 409 `DISPATCH_REQUIRED`. Phase 3 deliberately has no API for driver entry, dispatch, delivery assignment or delivery-user order access; those belong to the later delivery phase. Tests seed dispatch directly in their isolated database to exercise completion. Do not invent driver details or bypass the database guard in your business database.

## List filters

Example: `GET /api/v1/orders?order_status=NEW&supplier_id=<uuid>&date_from=2026-10-01&date_to=2026-10-31&page=1&limit=20`.

| Query | Meaning |
|---|---|
| `q` | Case-insensitive literal search in recipient name/phone/city, design number/name snapshots and order number |
| `order_number` | Exact order number |
| `customer_id`, `design_id`, `supplier_id` | Exact linked UUID |
| `order_status` | One of the five uppercase statuses; omitted means all |
| `date_from`, `date_to` | Inclusive order-date range |
| `page`, `limit` | Defaults 1/20; maximum limit 100 |
| `sort_by` | order_number (default), order_date, expected_delivery_date, created_at |
| `sort_order` | desc (default) or asc |

Queries bind values; sorting uses an explicit allowlist. SQL wildcard characters in `q` are treated literally. Pagination has a stable ID tie-breaker, and count/page use a single repeatable-read snapshot. Existing indexes support order number, status/due date, linked records and order date; contains-search over snapshot text can require a scan as the dataset grows.

## Transactions, calculations and logs

Creating, editing and status transitions include their audit entries in the same transaction. Failed validation or logging leaves no partial business change. Delivery synchronization is part of that transaction. Logs record authenticated actor/request ID, safe before/after values and status reasons; user-supplied actor fields are rejected.

Financial values are read from the existing `order_financials` view, not copied into mutable order totals. Profit is `selling_price - buying_price - delivery_expense - other_expense`; it is unknown when buying price is unknown. Outstanding balance uses actual net customer receipts. This phase reads any existing ledger entries but does not expose payment/expense APIs.

## Files and verification

- `src/modules/orders/validation.ts`: strict field, money, date, filter and status schemas.
- `src/modules/orders/service.ts`: snapshot creation, locked/versioned edits, state transitions, SQL and auditing.
- `src/modules/orders/routes.ts`: ADMIN-only Express endpoints.
- `src/app.ts`: orders router registration.
- `src/modules/audit/activity-log.ts`: explicit order audit-field allowlist.
- `tests/orders.test.ts`: PostgreSQL-engine and authenticated HTTP integration tests.

Run `npm run typecheck`, `npm run build` and `npm test`. See VALIDATION.md for results and test limits. No frontend, payments module, delivery-update module or Azure deployment is included.
