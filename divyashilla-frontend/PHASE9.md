> Historical phase contract. Phase 12 production setup supersedes hosting/storage limitations; see the root README and docs/AZURE-SETUP.md. Business API contracts remain as described.

> Historical phase guide. The current package is Phase 11; see PHASE11.md and VALIDATION.md for current scope and checks.

# Phase 9 — ADMIN orders

This guide describes the Phase 9 addition. The current package also includes Phase 10 financial screens; see PHASE10.md.

This phase extends the Phase 8 frontend. Backend source, configuration, dependencies and the four existing migrations are unchanged. Orders are accessible only under the ADMIN route guard. Tanaji is redirected to his restricted workspace without fetching order or financial data; the backend also enforces permissions.

## Screens and API mapping

| Screen or action | Existing API |
| --- | --- |
| Order list | `GET /api/v1/orders` |
| Create order | `POST /api/v1/orders` |
| Read order and financials | `GET /api/v1/orders/:id` |
| Edit order | `PATCH /api/v1/orders/:id` |
| Change status | `POST /api/v1/orders/:id/status` |
| Choose customer, design or supplier | Corresponding master list and detail APIs |

The list supports search, exact order number, status, customer, design, supplier, inclusive order-date range, sorting and server pagination. Filters are stored in the URL, so browser navigation and direct links preserve them. Invalid URL filters show a reset action. Customer/design/supplier selectors search and paginate on the server instead of downloading every record.

The create screen accepts dates, customer/design links, optional supplier, selling price, optional buying price, agreed advance and additional work. The order number is displayed only after the backend creates it. It is never generated, predicted or sent by the frontend. New links use active master records. Filter selectors can include inactive records to find historical orders.

## Snapshots and editing

The backend copies the customer recipient contact and design number/name/size/material into each order. Detail pages display those stored snapshots. Editing a master record later does not change an existing order's snapshots. Unchanged order links preserve snapshots; changing a link while permitted lets the backend copy the new master details. An explicit checkbox allows editing the delivery recipient name, phone, city and address. Design snapshots are read-only.

Links are locked in the frontend after an order leaves New. The backend also rejects relinking New orders with ledger history. Delivered and Cancelled orders cannot be edited. Inactive existing links are displayed and retained; newly selected links must be active.

Updates send changed fields and the backend's current `version`. A concurrent edit retains the user's input, shows the conflict and disables another save until **Reload latest order** is explicitly chosen. Reload discards the unsaved form and obtains the current version. Writes are not retried automatically. Closing or reloading the browser with unsaved changes triggers its standard warning.

## Status flow

`NEW → IN_WORK → READY_FOR_DELIVERY → DELIVERED`

A reason is required for every status change. In Work requires a supplier and a known buying price; zero is a known price. Cancellation is offered on open orders, with final eligibility checked by the backend. Cancelled and Delivered orders are terminal.

**Mark as Delivered requires an existing Sent delivery with driver details.** The backend updates the linked order and delivery in one transaction. This phase does not include dispatch or delivery editing screens, so it cannot create that prerequisite. The dialog explains it, and backend denials appear without changing the displayed order. Audit entries and all status rules remain backend responsibilities.

## Financial fields

ADMIN detail pages display selling price, buying price, agreed advance, net customer receipts, balance, delivery expenses, other expenses and profit. Derived values come from the order detail API and its existing `order_financials` view. The browser does not recalculate balances or profit. Lists show selling price; they do not invent derived financial fields absent from the list API.

Money is validated and sent as exact decimal strings, up to PostgreSQL `NUMERIC(14,2)` limits. Blank buying price remains unknown, distinct from zero; unknown profit has an explanatory message. Agreed advance is a target, not a posted customer payment. Validation checks required links, amounts, advance versus selling price, dates, lengths and recipient fields. Backend ledger and price restrictions remain authoritative, and save errors preserve input.

## Running and upgrading

Follow README.md for the two local servers. For an existing installation, use the new `divyashilla-frontend` source and lockfile, then run `npm ci`. Keep your backend, private environment and database. No new migration or business data seed is required.

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests require dependencies in both sibling folders and free ports 5173 and 3180. They use disposable PostgreSQL-engine data, real Express routes and test-only accounts. They do not read the private backend `.env` or use the business database. See VALIDATION.md for results and limitations.

No payments UI, delivery-operation UI, files UI, deployment or backend migrations are included.
