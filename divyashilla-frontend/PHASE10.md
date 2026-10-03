> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

> Historical phase guide. The current package is Phase 11; see PHASE11.md and VALIDATION.md for current scope and checks.

# Phase 10 — ADMIN payments and expenses

This phase extends the delivered Phase 9 frontend. The existing backend, configuration, dependency lockfile and four migrations are unchanged. Every financial route is inside the ADMIN guard; DELIVERY users are redirected before any ledger or balance request. The backend independently checks roles.

## Screens

| Module | Screens |
| --- | --- |
| Customer payments | Filtered/paginated list, receipt/refund form, detail, reasoned void dialog, customer balance |
| Supplier payments | Filtered/paginated list, payment/refund form, detail, reasoned void dialog, supplier balance |
| Supplier allocations | Optional allocations when posting; add allocations later; saved allocation history |
| Order expenses | Filtered/paginated list, add form, detail, reasoned void dialog |
| Order detail | Existing backend financial summary plus links to payments, supplier balance and expenses |

Lists use URL filters for record status (Posted, Void, All), inclusive date range, order, direction/category, sort direction and server pagination. Supplier payments additionally filter by supplier. Order filtering of supplier payments selects payments with allocations to that order; an unallocated payment will not match. Relation selectors search and paginate on the server. Lists deduplicate order/supplier name lookups within a page.

Balances are current lifetime posted totals for the selected order or supplier, independent of the record list's date/status filters. Refresh buttons obtain current balances. Navigating back from a mutation loads current records; returning to the order detail reads its latest financial summary. Another user's changes are not pushed live: use Refresh when needed.

## Customer money

Receipts require a purpose: Advance, Installment, Final or Other. Refunds omit purpose. Cash, UPI, Bank Transfer and Other methods are supported. Refunds record money actually returned; the backend rejects refunds greater than net receipts and receipts that would exceed the order selling price. Cancelled orders cannot receive new receipts, but refunds remain possible.

The customer balance panel uses the existing balance API: selling price, net receipts, balance due and recorded advance receipts. The agreed advance remains a target and does not count as received money. Recorded advance receipts count posted Advance receipts before refunds; the net receipts and balance include refunds.

## Supplier money and allocations

Payment and Refund use positive amounts. The supplier balance API returns known buying costs, net paid, current pending and unallocated net payments. Orders with unknown buying prices are explicitly noted and add no known liability. Cancellation retains supplier buying costs. The backend prevents total supplier payments beyond known liability and invalid refunds.

Allocation rows select priced orders belonging to the same supplier. One payment/order pair may be allocated only once; existing pairs are disabled when adding allocations later. A request permits up to 100 distinct rows. The form checks row amounts, duplicates and totals against this payment or its remaining unallocated amount. The backend checks current order/supplier balances transactionally, including changes by another user.

Allocations can cover part of a payment, leaving money unallocated for later assignment. Adding allocations does not record another payment. Refund allocations reduce prior allocated net payments. An unallocated refund cannot remove money still allocated to orders; assign it to the relevant orders when appropriate. Saved allocations are history and cannot be edited or deleted. To correct them, void and replace the parent record after resolving dependent refunds.

The existing order detail API does not expose per-order supplier allocated balances. This phase keeps the backend unchanged: it displays saved allocation amounts and buying costs, uses the supplier balance API for pending amounts, and relies on the backend for per-order allocation caps. It does not invent per-order allocated totals in the browser.

## Expenses and voids

Delivery and Other expenses reduce profit, not customer or supplier balances. Profit remains the backend's calculation: selling price minus buying price minus posted delivery and other expenses. Unknown buying price keeps profit unknown. Expense voids remove that record from totals while preserving its history.

Void is a correction, not a refund or deletion. A required reason and confirmation appear in a dialog on the detail page. The backend may reject a void if another posted refund/payment depends on it. The error remains visible and the record stays posted. Successful voids display their retained reason/date, and parent supplier allocations remain visible as excluded history. There are no editable ledger or payment deletion screens.

## Validation and safe retries

Amounts are exact positive decimal strings, not JavaScript floating-point values, up to NUMERIC(14,2) limits. Frontend validation checks links, dates, methods, notes, allocation rows and void reasons. Backend business messages are displayed without hiding them; 400 validation responses include the reported field names. Failed saves retain input. Loading, empty and retryable read-error states are included.

Money posts and allocation additions send a UUID `Idempotency-Key` with the existing session cookie and CSRF header. There is no automatic write retry. An uncertain network/5xx response locks the submitted fields and retains the exact request/key in memory. **Retry same submission** explicitly checks the same operation; it cannot post changed data with that key. A definite denial permits corrections and a fresh request key. Voids are naturally repeatable on the existing backend.

Keep an uncertain submission page open. Reloading, navigating away, logging out or closing the browser loses its memory-only retry key; check the record list before starting another entry. No payment details or keys are persisted in localStorage/sessionStorage. Expired/conflicting key responses remain locked with the backend's instruction to check the original record. Browser reload/close warns when a money form has unsaved input or an uncertain result.

## Existing API integration

All paths below start with `/api/v1`; no new backend endpoint is added.

| Action | API |
| --- | --- |
| List/add customer payments | GET/POST `/customer-payments` |
| Read/void customer payment | GET `/:id`, POST `/:id/void` under `/customer-payments` |
| Customer balance | GET `/customer-payments/orders/:id/balance` |
| List/add supplier payments | GET/POST `/supplier-payments` |
| Read/void supplier payment | GET `/:id`, POST `/:id/void` under `/supplier-payments` |
| Add supplier allocations | POST `/supplier-payments/:id/allocations` |
| Supplier balance | GET `/supplier-payments/suppliers/:id/balance` |
| List/add/read/void expenses | GET/POST `/order-expenses`, GET `/:id`, POST `/:id/void` |
| Current order financials | GET `/orders/:id` |

Ledger transactions, balance checks, actor identity and activity logs remain backend responsibilities.

## Run and upgrade

Use Node.js 24. Keep the existing backend `.env`, database and private uploaded files. Update the frontend source and lockfile, then run `npm ci`. Start the existing backend on port 3000 and the frontend with `npm run dev`; open http://localhost:5173. See README.md for initial setup, cookies and proxy configuration. No migration or business seed is needed for this upgrade.

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests reserve ports 5173/3180 and require dependencies in both sibling folders. They use disposable embedded PostgreSQL and real Express routes, never the private backend `.env` or business database. See VALIDATION.md for results and limitations.

No delivery-operation UI, file/photo/document UI, Azure deployment or new backend migration is included.
