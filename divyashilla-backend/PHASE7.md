> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 7 — reports

This phase adds reports to the existing Express/TypeScript backend. Authentication, sessions, permissions, storage and all Phase 1–6 APIs remain in place. The existing four migrations and financial views are used unchanged. No dependency, environment setting, frontend or deployment is added.

## Upgrade from Phase 6

Use this complete source package, retain your private `.env` and database, and retain the existing private file directory. Do not overwrite your configuration or uploaded files. Then run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

No migration is needed for this upgrade. For a new local installation, follow README.md, including the original migrations and user provisioning.

## Permissions and endpoints

Every endpoint below requires an authenticated, active ADMIN account that has completed its initial password change. DELIVERY users, including Tanaji, receive 403 for every report and CSV endpoint. Anonymous/expired/inactive sessions receive 401. Existing trusted-origin and rate-limit protections apply. Responses use `Cache-Control: no-store`.

All paths start with `/api/v1/reports`. Methods are GET.

| Report | JSON endpoint | CSV endpoint | Filters besides dates |
| --- | --- | --- | --- |
| Dashboard | `/dashboard` | `/dashboard/export` | None |
| Orders | `/orders` | `/orders/export` | `order_status`, `city`, `supplier_id`, `design_id` |
| Profit | `/profit` | `/profit/export` | Same as orders |
| Customer payment due | `/customer-dues` | `/customer-dues/export` | Same as orders |
| Suppliers | `/suppliers` | `/suppliers/export` | `supplier_id` |
| Delivery | `/deliveries` | `/deliveries/export` | Same as orders, plus `delivery_status` |

All reports support optional `date_from` and `date_to` in `YYYY-MM-DD` format. Either boundary can be used alone. Boundaries are inclusive; invalid calendar dates, year zero and reversed ranges are rejected. UUID filters must be valid UUIDs. `city` matches the order's delivery-city snapshot exactly, ignoring case and surrounding filter whitespace. Wildcards are treated as literal text. Unknown query keys, duplicate/array-valued filters and unsupported enums return 400.

Order statuses: `NEW`, `IN_WORK`, `READY_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`.
Delivery statuses in the delivery report: `READY_FOR_DELIVERY`, `SENT`, `DELIVERED`, `ISSUE`. `NOT_ASSIGNED` is deliberately absent.

### Date and balance meanings

**Date filters always select orders by `order_date`**, including the dashboard, supplier and delivery reports. They do not filter payment dates, expense dates, dispatch dates or delivery-completion dates. Delivery rows also contain expected-delivery and completion dates for inspection.

Each selected order's balances and profit use its **current** posted records, including payments and expenses entered after the selected order-date range. A January order paid in April therefore shows the April receipt. These endpoints are order-cohort reports, not historical balances as of the range end, bank/cash transaction reports, tax accounts or revenue-recognition statements.

`order_financials` already aggregates POSTED customer payments, supplier allocations and expenses independently. Reports use that view, avoiding duplicated money when an order has multiple ledger rows. Refunds reduce receipts/payments. VOID records and allocations attached to VOID supplier payments do not contribute. Agreed `advance_amount` is not treated as an actual received payment.

Amounts are decimal strings, calculated by PostgreSQL NUMERIC. Order numbers are strings to preserve BIGINT precision. Unknown buying prices stay null. Row profit is `selling_price - buying_price - delivery_expense - other_expense`; it can be negative. Summaries expose `known_profit` and `unpriced_orders`; summary `profit` is null when any selected order is unpriced. Buying-cost and supplier-pending totals are known subtotals when unpriced orders exist.

## Response shape and pagination

Dashboard returns `{data: {...}}`. Every other JSON report returns:

```json
{
  "data": [],
  "summary": {},
  "meta": {"page": 1, "limit": 20, "total": 0, "total_pages": 0}
}
```

List queries accept `page` (1–100000, default 1) and `limit` (1–100, default 20). `summary` covers the entire filtered set, regardless of the page. Orders are sorted by order number descending, then ID; suppliers are sorted by name ascending, then ID. Out-of-range pages return an empty list while retaining totals.

Count/page/summary are read in one REPEATABLE READ database transaction. Exports also use one consistent snapshot. These operations do not acquire the mutation module's global financial write lock.

### Dashboard

Fields: `total_orders`, `cancelled_orders`, `pending_delivery`, `delivery_issues`, `payment_pending_orders`, `payment_pending_amount`, `sales`, `known_profit`, `unpriced_orders`, `monthly_sales`, `monthly_known_profit`, `monthly_unpriced_orders`, `supplier_payment_pending_amount`, `supplier_payment_pending_suppliers`.

Total orders includes cancelled orders. Sales, profit and customer dues exclude cancelled orders. Pending delivery counts READY_FOR_DELIVERY, SENT and ISSUE deliveries; `delivery_issues` shows the ISSUE subset separately. Monthly amounts select the current India calendar month (Asia/Kolkata), intersected with the requested date range. Sales means order selling value, not cash received; profit is current order margin, including undelivered orders.

Supplier pending is the current **lifetime payable** from `supplier_balances`, counted once for each supplier represented among selected orders. This includes unallocated posted payments and costs outside the selected range. It is not restricted to the selected orders' unpaid allocations. Unpriced liabilities are unknown and excluded from payable; `unpriced_orders` on the dashboard counts selected non-cancelled unpriced orders.

### Orders and profit

Rows expose order/customer/design/supplier IDs, order number/date/status, expected date, customer delivery snapshots (name, phone, city, address), design snapshots (number, name, size, material), supplier name and financial columns: `selling_price`, `buying_price`, `customer_net_received`, `balance_amount`, `delivery_expense`, `other_expense`, `profit`, `supplier_net_paid`, `supplier_balance_amount`.

Customer/design details come from order snapshots, not today's edited master records. Supplier names come from the supplier master. Orders report includes cancelled orders by default. Profit report excludes cancelled orders by default; an explicit `order_status=CANCELLED` includes them for inspection. No cancellation automatically reverses recorded expenses or supplier liability.

Financial summaries return order count, sums of financial columns, unpriced count, known profit subtotal and complete profit (or null). The orders report's totals can include cancelled orders; use the profit report/default or a status filter for active-business margin.

### Customer dues

Only non-cancelled orders with `balance_amount > 0` appear. Fully paid orders are excluded. Rows retain customer snapshot contacts and the same order financial columns. Summary `balance_amount` is the total current customer amount due for selected orders.

### Suppliers

One row per supplier with matching orders. Inactive suppliers remain included when they have historical orders. A supplier with no matching orders is absent. Both `orders_given` and `order_count` are the number of matching orders; use `/reports/orders?supplier_id=...` with the same dates to inspect those orders.

| Field | Meaning |
| --- | --- |
| `total_buying_cost` | Known buying costs of selected orders |
| `paid_amount` | Net POSTED payments allocated to selected orders |
| `pending_amount` | Known buying cost minus those allocated payments |
| `unpriced_orders` | Selected orders without a buying price |
| `lifetime_buying_cost` | All known buying costs for this supplier |
| `lifetime_paid_amount` | All net POSTED supplier payments, including unallocated amounts |
| `unallocated_paid_amount` | Lifetime net paid minus net allocations |
| `lifetime_pending_amount` | Actual current supplier payable, after all posted payments |
| `lifetime_credit_amount` | Excess net payment over known liability, if legacy data contains a credit |
| `lifetime_unpriced_orders` | All orders for this supplier with unknown buying costs |

Unallocated funds cannot be attributed to a particular order/date cohort. For the actual outstanding supplier bill, use `lifetime_pending_amount`. `pending_amount` answers how much buying cost on the selected orders remains unallocated. Cancelled orders retain supplier liability under the existing view; financial reversals must be recorded explicitly. Summary totals cover every matching supplier, not just the page.

### Deliveries

One row per operational delivery, with order/customer/design snapshots and supplier identity, driver number, driver/bus name, optional bus number, status, UTC completion time and assigned user ID. No financial fields appear in delivery JSON or CSV. This is still an ADMIN-only report; Tanaji continues to use the existing scoped `/api/v1/deliveries` APIs. Summary counts each of the four operational statuses.

## CSV export and activity

CSV exports all matching rows in the same sort order, independent of JSON pagination. Export routes reject `page` and `limit`. Exports over 10,000 rows return 413 `EXPORT_TOO_LARGE`; narrow the filters. They never silently truncate. Dashboard exports one summary row. Empty list exports contain the header only.

CSV uses UTF-8 with a BOM, CRLF row endings, quoted cells and doubled embedded quotes. Marathi text, commas and line breaks are retained. Text that could be interpreted as a spreadsheet formula is prefixed with an apostrophe, including `+` phone numbers. Only static numeric columns retain negative values, so a loss such as `-12.30` stays numeric. Nulls are blank. Spreadsheet applications may reformat large numbers or identifiers; import relevant columns as text to preserve exact representations.

Ordinary JSON reads do not create noisy activity entries. Each successful authorized CSV request logs `REPORT_EXPORT_STARTED` with authenticated actor, request ID, report name, normalized filters and row count. The action records an export start, not proof of client download completion. The audit transaction must commit before CSV bytes are sent; an audit failure returns a JSON error and no CSV. Logs never contain CSV content, session tokens or customer/financial rows. Invalid, denied and oversized exports do not write this activity.

## Examples

First log in as Ayush and complete the initial password change as described in README.md. Store the session cookie locally. Then:

```bash
curl --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/orders?date_from=2026-01-01&date_to=2026-01-31&city=Pune&page=1&limit=20'

curl --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/profit?date_from=2026-01-01&date_to=2026-01-31'

curl --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/customer-dues'

curl --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/suppliers'

curl --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/deliveries?delivery_status=ISSUE'

curl --fail --cookie cookies.txt \
  'http://localhost:3000/api/v1/reports/orders/export?date_from=2026-01-01&date_to=2026-01-31' \
  --output orders.csv
```

Use your configured PORT if different from the example. CSV downloads are GET requests; no CSRF token is needed. Credentials never go in a URL.

## Files added

```text
src/modules/reports/
  validation.ts   Strict query schemas and report names
  queries.ts      Bound filters, view projections and aggregates
  service.ts      Consistent snapshots, pagination and export auditing
  csv.ts          Spreadsheet-safe CSV encoding
  routes.ts       ADMIN-only JSON/CSV endpoints
tests/reports.test.ts
```

Existing `src/app.ts` registers the router. The audit allowlist adds report metadata only. The future-endpoint assertion in master-module tests now checks unimplemented management APIs; the delivery regression test now expects report access to be forbidden. Version is 0.7.0; dependency versions and migration SQL are unchanged.

The regression suite exercises real PostgreSQL-engine calculations through PGlite and the real Express application through Supertest. See VALIDATION.md for the recorded result and limits.
