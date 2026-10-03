# Phase 7 validation

Validated on 2 October 2026 with Node.js 24.19.0.

- `npm run typecheck`: passed for source, CLI scripts and tests.
- `npm run build`: passed.
- `npm test`: **134 passed**, zero failed, skipped or cancelled. This retains 111 Phase 1–6 regression tests and adds 23 Phase 7 tests.
- Automated integration checks use embedded PostgreSQL 18.3 through PGlite 0.5.8, with pg_trgm enabled, and Supertest against the real Express application.
- Source was compared with the retrieved Phase 6 package before modification. Original SQL migrations 001–004 remain byte-for-byte identical; no migration or dependency was added.

## Phase 7 checks

- All six JSON routes and all six CSV routes reject anonymous callers and DELIVERY users before query validation. Changed roles and inactive accounts take effect on subsequent requests through the existing session middleware.
- Inclusive order-date ranges, exact case-insensitive snapshot city matching, supplier/design/status filters and customer/design delivery snapshots were checked. Malformed dates, year zero, reversed ranges, invalid UUIDs/enums, blank/control-character city values, invalid pagination, array/duplicate filters and unknown parameters return 400. Literal wildcard and SQL-injection text never widen the filter.
- Posted-only net customer receipts, refunds, void receipts, supplier payments/refunds/allocations and void parent payments were tested against PostgreSQL-engine calculations. Multiple receipts/expenses/allocations do not multiply totals. Voided expenses do not reduce profit. Payments made after the selected order-date range still affect current balances.
- Profit is computed through the existing view, including delivery and other expenses. Missing buying prices produce null row profit; summary complete profit is null while known profit and unpriced count remain available. Maximum NUMERIC money values remain exact, and an actual negative profit is preserved in JSON and CSV.
- Customer dues exclude paid and cancelled orders. Supplier rows distinguish order-cohort allocations/pending values from lifetime payments, unallocated funds and actual payable. Existing cancelled-order supplier liabilities are preserved.
- Dashboard total/cancelled orders, current dues, sales, known profit/unpriced count, pending/issue deliveries, current India-month amounts and supplier payable were exercised. Delivery reports include exactly READY_FOR_DELIVERY, SENT, DELIVERED and ISSUE and expose no financial columns; completion times are UTC.
- All five list reports have deterministic pagination, full-filter summaries and stable totals across pages. Beyond-end pages and empty sets behave correctly. Each report read/export starts a REPEATABLE READ transaction; this checks transaction configuration and query grouping, not independent-connection concurrency.
- Every report exports CSV. Tests cover complete filtered output, UTF-8/BOM, CRLF records, commas, quotes, multiline/Marathi text, formula neutralization, plus-prefixed phone numbers, null cells, exact decimals and negative numeric profit. Export pagination is rejected. The 10,000-row ceiling rejects an oversized result without truncation or audit; this boundary is exercised through a narrow adapter volume fixture, not 10,001 database inserts.
- Ordinary JSON reads do not log report activity. CSV export starts log authenticated actor, request ID, normalized filters and row count only. Injected audit failure produces JSON error before CSV headers/bytes and leaves no report activity.

## Earlier phases

All earlier authentication/security, migration, master-record, order, ledger, delivery and private-file tests remain passing. Two historical assertions were updated because reports now exist: master-module tests check still-unimplemented management APIs, and the Tanaji delivery regression now expects report permission denial. No existing database constraints, services or ledger/delivery/file behavior were changed.

The original migration checksums are:

```text
001_foundation.sql           3a25d781d1555cc79ca17b30cceff03487b0ee31395043bd893d7649135eecaf
002_tables.sql               09700759bc8d346a0ac8a20cf6342bfa8932636693829cc49360f64751eb3ec9
003_guards_indexes_views.sql c316dcd43096e8028148380a69b08048802a4d7d611464a3cabebcad8e2f7ee1
004_contains_search.sql      d986580691ace3d54220a6b311e1622d6af74fcf2db015534fa0342d9db5e99f
```

## Limits

The PostgreSQL TCP connection and Docker Desktop were not exercised here. Follow README.md to run PostgreSQL locally, then use `/health/ready` and `npm run auth:check` for your actual connection. Tests use PGlite's serialized transaction adapter; they do not simulate independent PostgreSQL connections or multi-process race conditions. No large real-world report load benchmark or spreadsheet-application round trip was performed. CSV files are bounded but generated in memory; use narrower filters for large exports.

Earlier file/storage limits remain: no real Azure connection or deployment; format checks validate signatures/container markers rather than full decoding or malware scanning; cross-storage/SQL process-crash recovery was not simulated. Production local-file storage remains blocked pending durable private adapter wiring. No live business database, cloud container or remote repository was changed. The existing private `.env` was not edited and is excluded, along with dependencies, build output and uploaded files, from the source archive.
