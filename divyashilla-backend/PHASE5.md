> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 5 — Delivery

Complete backend through Phase 5, extending the Phase 4 routes/validation/service structure. No new migration, frontend, files/photos API, reports API or Azure deployment is included.

## Local upgrade

Stop the old server. Replace source/package files while retaining your private `.env` and PostgreSQL data. Run `npm ci`, `npm run db:migrate`, `npm run typecheck`, `npm run build`, `npm test`, then `npm run dev`. The four existing migrations are unchanged. New installations should follow README.md. Do not reset the database.

## Permissions and response safety

ADMIN can list/read/update every delivery, including the automatic records for draft and cancelled orders. DELIVERY users can list/read/update only deliveries assigned to their own authenticated user ID and linked to READY_FOR_DELIVERY or DELIVERED orders. Unassigned, foreign, draft and cancelled orders are invisible to them. A hidden ID returns the same 404 as a missing ID. List counts and search results use that same scope; user-supplied filters cannot widen it.

Both roles receive the same delivery-safe response whitelist: delivery_id, order_id, order_number, order_date, order_status, assigned_delivery_user_id, version, customer_name, customer_phone, customer_city, customer_address, design_number, design_name, size, material, additional_work, expected_delivery_date, delivery_status, driver_number, driver_or_bus_name, bus_number, delivered_at, updated_by, delivery_updated_at and issue_reason.

Customer/design fields come from the existing order snapshots through delivery_order_details. Amounts, supplier IDs/payments, customer payments, expenses, profit and file/image IDs are not selected or serialized by this module. It never calls the ADMIN order read service to construct a delivery response. Tanaji still cannot access the orders, master-record or ledger APIs.

Sessions enforce the current active account/role on each request. Assignment is checked again inside mutation transactions under row locks. There is no username hardcoding: Tanaji uses a DELIVERY account, and other DELIVERY accounts obey the same ownership rules.

## Endpoints

Base path: `/api/v1/deliveries`. `:id` means the **delivery UUID**, not the order UUID or order number. Each response includes both delivery_id and order_id. GET list returns data plus meta.page, limit, total and total_pages. Reads and mutations return `{ "data": delivery }` with HTTP 200.

| Method | Path | Permission and behavior |
|---|---|---|
| GET | `/` | ADMIN all; DELIVERY assigned rows only |
| GET | `/:id` | Scoped safe details |
| POST | `/:id/assign` | ADMIN-only assignment/reassignment |
| POST | `/:id/send` | READY_FOR_DELIVERY → SENT with driver details |
| PATCH | `/:id/driver` | Edit driver/bus details while SENT |
| POST | `/:id/deliver` | SENT → DELIVERED; synchronize linked order |
| POST | `/:id/issue` | READY_FOR_DELIVERY/SENT → ISSUE with reason |

Use the existing session cookie. All mutations require an allowed Origin, X-CSRF-Token and a current integer version. They do not require a financial Idempotency-Key. No root POST, DELETE or generic status/assignment PATCH exists.

## Workflow for Ayush and Tanaji

1. Ayush creates the order using the existing orders API. The schema creates its delivery record automatically.
2. Ayush moves the order through IN_WORK to READY_FOR_DELIVERY. The existing orders service synchronizes delivery readiness.
3. Ayush lists deliveries and assigns the delivery to Tanaji using his user UUID. Assignment is explicit: making an order ready does not automatically assign it.
4. Tanaji lists his assigned deliveries, reads details and dispatches with driver number/name.
5. Tanaji can correct driver/bus details while the delivery is SENT.
6. Tanaji confirms receipt: delivery and order become DELIVERED together. He retains safe read access to his completed assigned deliveries.

ADMIN can also send, edit, report issues and complete deliveries directly. ADMIN may dispatch an unassigned delivery; it remains invisible to DELIVERY accounts until assigned.

## Assignment

```json
{
  "version": 3,
  "assigned_delivery_user_id": "replace-with-tanaji-user-uuid",
  "reason": "Assigned for Pune delivery"
}
```

Use POST /:id/assign. The target must be an active DELIVERY user. Orders must be READY_FOR_DELIVERY, with delivery status READY_FOR_DELIVERY, SENT or ISSUE. ADMIN may reassign in-transit/issue deliveries with a reason; the previous assignee loses access immediately and the new assignee gains it. Send null to unassign only before dispatch (READY_FOR_DELIVERY). Finished deliveries cannot be reassigned. Repeating the current assignment/version is a no-op.

No new user-list module is introduced here. Tanaji's UUID appears as user.id in his login response and GET /api/v1/auth/me. An ADMIN developer can also retrieve an existing user's ID from users during local setup. UUIDs identify accounts; the API never accepts a username as permission proof. An inactive or changed-role assignee must be replaced with an active DELIVERY account before further delivery mutation, preserving the existing database guard.

## Dispatch

```json
{
  "version": 4,
  "driver_number": "+91 (98765) 43210",
  "driver_or_bus_name": "Pune bus service",
  "bus_number": "MH12 AB1234"
}
```

Use POST /:id/send. Both driver fields are mandatory; bus_number is optional and defaults to null. driver_number normalizes spaces, parentheses and hyphens into 7–15 digits, optionally prefixed with +. driver_or_bus_name is nonblank, at most 200 characters. bus_number is nullable, at most 100 characters, with no control characters. Blank bus text becomes null. Dispatch requires a READY_FOR_DELIVERY order and delivery. Order status remains READY_FOR_DELIVERY while in transit.

## Edit drivers while SENT

```json
{
  "version": 5,
  "driver_number": "9876543210",
  "driver_or_bus_name": "Updated driver",
  "bus_number": null
}
```

Use PATCH /:id/driver. Supply at least one driver/bus field. Omitted fields retain their values; null clears bus_number only. Driver number/name cannot be cleared. Edits are allowed only while SENT. Identical edits are no-ops with no extra audit entry or version change.

## Confirm delivery

```json
{ "version": 6 }
```

Use POST /:id/deliver. SENT must have valid driver details. The database stamps delivered_at; the client cannot supply a delivery time. In the same transaction the service sets delivery_status=DELIVERED and order_status=DELIVERED, advances the order version, and records both a delivery activity and an order-status activity. The existing deferred consistency trigger checks agreement at commit. The existing order_financials view derives actual_delivery_date using India time; that financial view is not sent to Tanaji.

Delivered records are immutable through these commands. Repeating completion with the current version is a no-op and preserves the original timestamp. Trying to complete from READY_FOR_DELIVERY or ISSUE returns 409.

## Report an issue

```json
{
  "version": 6,
  "reason": "Bus broke down; driver is arranging alternate transport"
}
```

Use POST /:id/issue. A nonblank reason, at most 500 characters, is required. READY_FOR_DELIVERY or SENT can become ISSUE; order status stays READY_FOR_DELIVERY, driver details remain intact and no delivered_at timestamp is created. An existing ISSUE can receive an updated reason with the current version; an identical reason is a no-op.

There is no issue-reason column in the current schema. The transactional activity entry stores the reason, and safe responses expose the latest issue reason only while ISSUE. The lookup orders issue entries by the saved order version, avoiding ambiguous transaction-start timestamps. Only that delivery's issue action/reason is queried; there is no raw activity-log API.

**ISSUE pauses dispatch, driver edits and completion.** This phase does not introduce an ISSUE-resolution/resume transition. Such a workflow needs a separately reviewed policy for pre-dispatch versus in-transit issues. ADMIN can reassign an issue delivery, but reassignment does not clear it. Delivered, cancelled and draft orders cannot be marked ISSUE.

## List and search

Example: `/api/v1/deliveries?delivery_status=READY_FOR_DELIVERY&expected_from=2026-10-10&expected_to=2026-10-10` lists that day's expected deliveries within the caller's scope.

| Query | Meaning |
|---|---|
| page / limit | Defaults 1/20; maximum limit 100 |
| delivery_status | NOT_ASSIGNED, READY_FOR_DELIVERY, SENT, DELIVERED or ISSUE; omitted means all visible states |
| expected_from / expected_to | Inclusive expected-delivery date range |
| q | Literal case-insensitive recipient name/phone/city, design name/number or order number search |
| sort_by | expected_delivery_date (default), order_number or delivery_updated_at |
| sort_order | desc (default) or asc; null dates last |
| assigned_delivery_user_id | ADMIN-only filter; DELIVERY requests supplying it receive 403 |

Count/page share a repeatable-read snapshot. SQL values are bound, sort fields are allowlisted, wildcard text is escaped, and the assignment predicate wraps the search correctly. List metadata never counts hidden deliveries. There is no financial query filter.

## Versions, logs and rollback

Every real delivery mutation, including assignment, driver corrections and issue reasons, advances the existing linked order version using the database trigger. This protects against both delivery edits and concurrent owner order edits. A stale version returns 409 VERSION_CONFLICT: read again before saving. No-op requests still require the current version. Clients cannot set actor IDs, financial fields, order/delivery status directly, delivered_at or arbitrary assignment fields through other commands.

Mutation transactions take the same PostgreSQL financial-write advisory lock used by Phase 4, then lock the scoped order/delivery rows. Thus delivery completion, ADMIN order status changes, cancellation and financial/order edits share one consistent lock order across backend processes. Reads stay concurrent.

Assignment, delivery fields, linked order version/status, and audit entries commit together. An audit failure rolls them all back, including delivered_at. DELIVERY audit snapshots contain only statuses, assignment/version, driver fields and completion time; they do not include finances. Completion adds a separate ORDER_STATUS_CHANGED activity. The actor comes from the authenticated session, not the body. CSRF/origin and initial-password restrictions remain active.

401 means login/session invalid, 403 means permission/filter/CSRF/origin denied, 400 means invalid input, 404 means missing or hidden delivery, and 409 means stale version or invalid state/assignment. SQL, session tokens and secrets are never returned in errors.

## Code and verification

- src/modules/delivery/validation.ts: commands, phones, reasons, versions and safe list filters.
- src/modules/delivery/service.ts: explicit safe projection/serialization, scoped queries, assignment, row locks and state changes.
- src/modules/delivery/routes.ts: authenticated role/CSRF-protected endpoints.
- src/app.ts: delivery router registration.
- src/modules/audit/activity-log.ts: deliberately extended delivery audit allowlist.
- tests/delivery.test.ts: delivery privacy, ownership, transitions and rollback integration tests.

Run npm run typecheck, npm run build and npm test. VALIDATION.md records results and limits. This package does not test a live Azure deployment or independent PostgreSQL TCP race conditions.
