> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

# Phase 4 — Payments and expenses

This is the complete backend through Phase 4. It retains the existing Express/TypeScript routes → validation → service → PostgreSQL structure. Every new endpoint is ADMIN-only. Tanaji cannot read balances, payments, allocations or expenses.

## Upgrade locally

Stop the Phase 3 server. Replace source/package files with this package while retaining your private `.env` and PostgreSQL data. Run:

```bash
npm ci
npm run db:migrate
npm run typecheck
npm run build
npm test
npm run dev
```

The original four migrations are unchanged and are skipped when already applied. No database reset or additional migration is needed. New installations should follow README.md. No delivery-update APIs, frontend, upload/download/photo APIs, reports or Azure deployment are included.

## Endpoints

All paths below start with `/api/v1`. Use the existing session cookie. Mutations need an allowed `Origin` and `X-CSRF-Token`. Posting money or adding allocations also needs an `Idempotency-Key`.

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/customer-payments` | Post a receipt/refund; list records |
| GET | `/customer-payments/:id` | Read one record |
| POST | `/customer-payments/:id/void` | Void a record with a reason |
| GET | `/customer-payments/orders/:id/balance` | Customer balance from order_financials |
| POST / GET | `/supplier-payments` | Post a payment/refund; list records |
| GET | `/supplier-payments/:id` | Read a payment and its allocations |
| POST | `/supplier-payments/:id/allocations` | Allocate more of a posted record to orders |
| POST | `/supplier-payments/:id/void` | Void payment/refund and exclude its allocations from totals |
| GET | `/supplier-payments/suppliers/:id/balance` | Supplier balance from supplier_balances |
| POST / GET | `/order-expenses` | Post an expense; list records |
| GET | `/order-expenses/:id` | Read one expense |
| POST | `/order-expenses/:id/void` | Void an expense with a reason |

POST to a module root returns 201, Location and `{ "data": record }`. Allocation additions return 200 and the payment with allocations. GET/void return 200. List responses include `data` and `meta` with page, limit, total and total_pages. Supplier list rows omit allocation arrays; use the single-payment endpoint to read them. IDs are UUIDs. Amounts and derived totals are exact decimal strings, dates are `YYYY-MM-DD`, and timestamps serialize as UTC ISO strings.

## Customer receipt and refund

```json
{
  "order_id": "replace-with-order-uuid",
  "amount": "5000.00",
  "direction": "RECEIPT",
  "purpose": "ADVANCE",
  "payment_date": "2026-10-01",
  "payment_method": "UPI",
  "note": "Advance received"
}
```

Receipts require purpose: `ADVANCE`, `INSTALLMENT`, `FINAL` or `OTHER`. For a refund use direction `REFUND` and omit purpose:

```json
{
  "order_id": "replace-with-order-uuid",
  "amount": "1000.00",
  "direction": "REFUND",
  "payment_date": "2026-10-02",
  "payment_method": "BANK_TRANSFER",
  "note": "Part refund"
}
```

Receipts/refunds must leave net customer receipts between zero and selling price. This prevents overpayment and refunds greater than money actually received. Refunds are checked against the order's aggregate POSTED history, rather than tied to a particular receipt ID. Cancelled orders may be refunded but cannot receive new receipts; delivered orders may receive outstanding payments.

`received_by` and `processed_by` come from the logged-in ADMIN. Refunds have null received_by/purpose and still record processed_by. Clients cannot choose these actors.

`GET /customer-payments/orders/:id/balance` returns order ID/number, selling price, agreed advance amount, recorded advance receipts, net customer receipts and balance. The values come directly from `order_financials`. Agreed `advance_amount` does not count as a receipt. The existing advance_receipts_recorded field counts posted ADVANCE receipts; it is not a separate net advance balance after refunds.

## Supplier payment and allocations

```json
{
  "supplier_id": "replace-with-supplier-uuid",
  "amount": "8000.00",
  "direction": "PAYMENT",
  "payment_date": "2026-10-01",
  "payment_method": "BANK_TRANSFER",
  "note": "Payment for carving",
  "allocations": [
    { "order_id": "replace-with-first-order-uuid", "amount": "5000.00" },
    { "order_id": "replace-with-second-order-uuid", "amount": "2000.00" }
  ]
}
```

Allocations are optional and may use only part of the payment; the example leaves 1000 unallocated. Each order must belong to the same supplier and have a known buying price. A request may contain up to 100 allocations with distinct order IDs. Allocation totals may not exceed that payment/refund amount. Across posted history, each order's allocated net payment must stay between zero and its buying price.

**Overpayment policy:** total supplier net payments may not exceed the total buying prices of that supplier's existing priced orders. Unknown buying prices add no payable amount. Unallocated payments are allowed within this known liability, so they can be assigned to orders later. This phase does not permit supplier advances beyond known costs.

Add allocations later with a fresh Idempotency-Key:

```json
{
  "allocations": [
    { "order_id": "replace-with-another-order-uuid", "amount": "1000.00" }
  ]
}
```

Use `POST /supplier-payments/:id/allocations`. There can be only one allocation for each payment/order pair, including previously added allocations. Allocations are retained as history and cannot be edited/deleted through these APIs. To correct an allocation, void and replace its parent payment after resolving any dependent refunds. A voided parent cannot receive allocations.

Supplier refunds use the same fields with direction `REFUND`; allocation amounts remain positive. The direction causes the financial views to subtract those amounts. Refunds must leave nonnegative supplier net paid, nonnegative allocated net paid per order, and nonnegative unallocated net paid. An unallocated refund therefore cannot remove money that is still assigned to orders: include the relevant order allocations when returning allocated funds. New payments require an active supplier; refunds and voids remain possible after deactivation. paid_by is the authenticated ADMIN for PAYMENT and null for REFUND; processed_by always records the ADMIN.

The supplier balance endpoint returns known_liability, unpriced_orders, net_paid, net_allocated, unallocated_net_advance, net_position, payable and credit from `supplier_balances`. Cancellation preserves buying-price liabilities in the existing views; it does not automatically reverse supplier costs or issue refunds.

Order price edits now validate these same supplier balances. Reducing/removing a buying price or relinking an order cannot leave paid supplier funds unsupported. Existing Phase 3 receipt-price and ledger-history restrictions remain in force.

## Expense

```json
{
  "order_id": "replace-with-order-uuid",
  "category": "DELIVERY",
  "amount": "800.00",
  "expense_date": "2026-10-01",
  "note": "Bus transport charge"
}
```

Categories are `DELIVERY` or `OTHER`. Expenses record costs, not money movements to suppliers: they do not reduce customer/supplier balances or create supplier payments. created_by comes from the logged-in ADMIN. Costs may be recorded after delivery or cancellation, and profit may legitimately become negative. A missing buying price keeps profit unknown.

The existing `order_financials` view computes delivery/other expense totals and `profit = selling_price - buying_price - delivery_expense - other_expense`, counting only POSTED expenses. Existing order read responses show the recalculated totals; no editable profit field is introduced.

## Void and correction

Use `POST /<module>/:id/void`:

```json
{ "reason": "Amount entered incorrectly; replace with the correct record" }
```

Voiding is a recording correction, not an actual refund. To return money, post a REFUND. No PATCH or DELETE payment/expense endpoint exists. Voids preserve amount, date, actors, original timestamps and allocations; PostgreSQL stamps voided_at/voided_by and status becomes VOID. Repeating a void is a no-op, preserving the first reason and timestamp.

A void is rejected if its resulting balances are invalid. Examples: removing a receipt supporting an existing refund, removing an allocated supplier payment supporting an allocated refund, or removing a refund after replacement payments have filled the available balance. Resolve dependent corrections first. Voided parent supplier allocations remain visible but no longer contribute to the financial views.

## Validation and retry protection

Money must be a positive decimal string with up to 12 integer digits and two fractional digits. Zero, negatives, JavaScript numbers, exponent notation, NaN and excess precision are rejected. Payment methods: CASH, UPI, BANK_TRANSFER, OTHER. Dates must be valid calendar dates. note is optional/nullable, at most 2000 characters. Unknown fields, actor/status spoofing and invalid UUIDs are rejected.

For money posts and allocation additions send a new key (a UUID works):

```text
Idempotency-Key: 97bd2c03-9692-41b9-8abd-a493b6a8d330
```

Use the same key and data to retry an uncertain response. The existing idempotency_requests table stores the original successful result in the same transaction as the ledger and audit. A matching retry returns that original result with `Idempotency-Replayed: true` and creates no new record/log. Keys are scoped to the authenticated user and operation; the same shared business action should be retried by the same account. Changed data returns 409 IDEMPOTENCY_CONFLICT. After seven days, reuse returns 409 IDEMPOTENCY_EXPIRED; check the original record before creating a new request. Expired keys remain recorded and are not automatically deleted. A replay is the original response snapshot; use GET for the current status, particularly after a void. Void requests are already naturally repeatable and do not require this header.

400 means malformed/invalid input, 401 means login required, 403 means permission/CSRF/origin denied, 404 means record absent, and 409 means a business balance, allocation or retry conflict. Failures do not post partial money.

## List filters

All lists accept page (default 1), limit (default 20, maximum 100), sort_order (desc default), status (POSTED default, VOID or all), date_from and date_to (inclusive). Ordering uses payment/expense date and ID for a stable tie-breaker. Count and page share a repeatable-read snapshot.

- Customer payments: order_id and direction (RECEIPT/REFUND).
- Supplier payments: supplier_id, direction (PAYMENT/REFUND), and order_id to find payments allocated to an order, including retained void allocations when status=all/VOID.
- Expenses: order_id and category (DELIVERY/OTHER).

Example: `/api/v1/customer-payments?order_id=<uuid>&status=all&date_from=2026-10-01&date_to=2026-10-31`.

## Transactions and concurrency

A PostgreSQL transaction-scoped advisory lock serializes financial writes across all backend processes; order create/update/status writes take the same lock before row locks. This keeps balance checks and order cost edits consistent even across processes. It is intentionally simple for this small internal application; reads remain concurrent. Higher write volume would warrant a reviewed move to finer locks.

Ledger mutations, allocations, balance checks, retry persistence and activity logs commit or roll back together. Explicit row locks protect orders, suppliers and voided records. The existing immutable-ledger and customer-balance database triggers remain intact. Activity logs record safe before/after data, amounts, directions, actors, allocation links and void reasons. No cookies/passwords/session tokens are logged.

Supplier caps and refund rules are enforced by these API services; the existing SQL schema alone does not enforce all supplier aggregate rules. Keep all business writes through this backend, including order edits. Existing historic supplier inconsistencies may block new changes until reviewed/corrected; no migration silently changes old money.

## Files

New modules each have routes.ts, validation.ts and service.ts under src/modules/customer-payments, supplier-payments and order-expenses. Shared ledger helpers live in src/shared/ledger-records.ts and ledger-validation.ts; financial-lock.ts centralizes write locking. src/modules/orders/service.ts adds the shared lock and supplier checks. tests/ledgers.test.ts covers the new behavior.

See VALIDATION.md for the verified test results and limits. Docker/TCP PostgreSQL connection verification remains part of your local setup.
