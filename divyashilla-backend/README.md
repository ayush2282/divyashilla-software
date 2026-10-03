# DivyaShilla backend — Phase 12

This package includes the Phase 1 authentication foundation, Phase 2 customers/designs/suppliers APIs, Phase 3 orders APIs, Phase 4 customer payments, supplier payments/allocations and expenses, Phase 5 delivery APIs, Phase 6 private file APIs and Phase 7 ADMIN reports/CSV exports. It uses the four previously created PostgreSQL migrations unchanged. Read [PHASE7.md](PHASE7.md) for report contracts and date/balance meanings; [PHASE6.md](PHASE6.md) for file API contracts, storage settings and upgrade steps; [PHASE5.md](PHASE5.md) covers delivery, [PHASE4.md](PHASE4.md) covers ledgers, [PHASE3.md](PHASE3.md) covers orders, and [PHASE2.md](PHASE2.md) documents master records. Phase 12 adds production storage wiring and compiled-frontend hosting; see the repository root README and docs/AZURE-SETUP.md. No Azure resources are created by this package.

## Production setup

Read [Azure setup](../docs/AZURE-SETUP.md), [environment settings](../docs/ENVIRONMENT.md) and [database/users](../docs/DATABASE-USERS.md) before hosting. The existing Azure adapter now uses the official Azure SDK with the App Service system-assigned identity. Set FILES_DRIVER=azure; production refuses local files. FRONTEND_DIRECTORY=./public serves the compiled React frontend from the same HTTPS origin. The root release builder copies only compiled runtime files and production dependencies. Original migrations remain unchanged; deployment/runtime-grants.sql is permission setup, not a migration.

## Why Express

Express 5 keeps this small two-user application easy to follow: routes, middleware, services and SQL are explicit. Express 5 also forwards rejected async route-handler promises to the error handler.

Stack: Node.js 24, TypeScript, Express 5, node-postgres (`pg`), Zod validation, PostgreSQL 15+, and Node's built-in asynchronous scrypt password hashing. A locked dependency file is included. Business records are not stored in files or in memory.

## Start locally — recommended path

Install Node.js 24 and Docker Desktop first. Docker Desktop must be running. Open a terminal in the extracted `divyashilla-backend` folder.

1. Install dependencies:

```bash
npm ci
```

2. Create your private local configuration:

```bash
npm run env:init
```

This creates `.env` from `.env.example`, generating a unique local database password and CSRF secret. It never overwrites an existing `.env`. Do not commit or share `.env`.

3. Start PostgreSQL locally:

```bash
docker compose up -d --wait
```

The database listens only on your computer's loopback interface. A named Docker volume retains data when the container stops. The default port is 5432. If another PostgreSQL instance already uses that port, either use the native-server option below or change the Compose port and DATABASE_URL together.

4. Apply the existing SQL migrations:

```bash
npm run db:migrate
```

Migration names, checksums and timestamps are saved in `public.divyashilla_migrations`. Each migration and its history entry commit in the same transaction. Rerunning the command safely skips already applied files. Changed previously applied SQL is rejected. A database advisory lock prevents two runners from applying migrations together. Do not edit old migrations; add a new numbered file for later changes.

5. Create Ayush first, then Tanaji:

```bash
npm run user:create -- --username ayush --name Ayush --role ADMIN
npm run user:create -- --username tanaji --name Tanaji --role DELIVERY
```

Each command asks for a temporary password and confirmation. Input is hidden. Choose separate passwords, 12–128 characters each. Passwords do not go into command arguments, terminal history, source files or plaintext database fields. Both accounts must change their temporary password at first login. No default password exists, and there is no public registration endpoint.

6. Start the backend:

```bash
npm run dev
```

Leave this terminal running. It reloads when source files change.

7. In a second terminal in the same folder, complete first login and verify permissions:

```bash
npm run auth:check -- --username ayush
npm run auth:check -- --username tanaji
```

These commands ask for the temporary password, then the new permanent password if required. They check login, current user, the appropriate permission endpoint and logout. They do not print session cookies or passwords. They are local interactive helpers, not a frontend.

The server is at `http://127.0.0.1:3000`. Open these URLs to check it:

- `http://127.0.0.1:3000/health/live`
- `http://127.0.0.1:3000/health/ready`

Ready returns 200 only when the database is reachable and core migrations/tables are present; otherwise it returns 503. Health responses do not reveal credentials or database error details.

## If PostgreSQL is already installed

Skip Docker. Create a NEW empty database, then edit `.env` so DATABASE_URL points to it. The database user needs owner privileges for local migrations and account provisioning. URI-encode special characters in URL usernames/passwords. Database TLS is controlled by PG_SSL; do not add URL SSL query options that override certificate verification.

If the database already contains the old schema applied manually, the runner deliberately refuses to guess a baseline. Keep that data, and have a developer verify and register the original migration checksums before proceeding. Do not drop a populated database to make setup work.

Migration 004 requires pg_trgm in the public schema. If your database account cannot enable it, set `ENABLE_CONTAINS_SEARCH=false` and rerun the migration command. Core APIs and search work after migrations 001–003; migration 004 adds indexes for substring searches. Later, enable the extension, change the setting to true and rerun to apply 004.

## Folder structure

| Folder/file | Purpose |
|---|---|
| src/server.ts | Load configuration, start HTTP server, close cleanly |
| src/app.ts | Express setup and route registration |
| src/config.ts | Validate environment variables without exposing secrets |
| src/db/ | PostgreSQL pool, transactions and migration runner |
| src/modules/auth/ | Passwords, sessions, login/password routes and permissions |
| src/modules/users/ | Local account provisioning service |
| src/modules/customers/ | ADMIN-only customer routes, validation and service |
| src/modules/designs/ | ADMIN-only design routes, validation and image-link checks |
| src/modules/suppliers/ | ADMIN-only supplier routes, validation and service |
| src/modules/orders/ | ADMIN-only orders, snapshots, versioned edits and status flow |
| src/modules/customer-payments/ | Customer receipts/refunds, balances and voids |
| src/modules/supplier-payments/ | Supplier payments/refunds, allocations and voids |
| src/modules/order-expenses/ | Expense posting and voids |
| src/modules/delivery/ | Delivery-safe scoped access, assignment, dispatch, completion and issues |
| src/modules/files/ | Private scoped uploads, metadata and download streams |
| src/storage/ | Private storage interface, local adapter and Azure-ready port |
| src/modules/audit/ | Transaction-aware activity-log helper |
| src/modules/health/ | Liveness/readiness endpoints |
| src/middleware/ | Safe, consistent error handling |
| src/shared/ | Shared application error type |
| src/types/ | TypeScript request extensions |
| scripts/ | Environment setup, migrations, accounts, local auth check, session cleanup |
| migrations/ | Original four SQL files, byte-for-byte copies |
| tests/ | HTTP/auth/security and migration integration checks |
| .env.example | Configuration names and placeholders |
| compose.yaml | Local PostgreSQL only |

## API endpoints

| Method | Endpoint | Access |
|---|---|---|
| GET | /health/live | Public; process health |
| GET | /health/ready | Public; minimal dependency readiness |
| POST | /api/v1/auth/login | Username/password plus trusted Origin |
| GET | /api/v1/auth/me | Valid session |
| POST | /api/v1/auth/logout | Session, trusted Origin and CSRF token |
| POST | /api/v1/auth/change-password | Session, current password, trusted Origin and CSRF token |
| GET | /api/v1/access/admin | ADMIN after first password change |
| GET | /api/v1/access/delivery | ADMIN or DELIVERY after first password change |

The two access endpoints demonstrate permission middleware; they expose no business records. Phase 2 adds ADMIN-only CRUD/list APIs at `/api/v1/customers`, `/api/v1/designs` and `/api/v1/suppliers`; see PHASE2.md. Phase 3 adds `/api/v1/orders`; see PHASE3.md. Phase 4 adds `/api/v1/customer-payments`, `/api/v1/supplier-payments` and `/api/v1/order-expenses`; see PHASE4.md. Phase 5 adds `/api/v1/deliveries`; see PHASE5.md. Phase 6 adds `/api/v1/files`; see PHASE6.md. Phase 7 includes ADMIN reports at /api/v1/reports.

Login body:

```json
{"username":"ayush","password":"<your-password>"}
```

Change-password body:

```json
{"currentPassword":"<current-password>","newPassword":"<new-password>"}
```

Login and `/auth/me` return safe user details, `csrfToken` and session expiry. The raw session token is only in the HttpOnly cookie; it is not returned as a JSON field. Account roles come from PostgreSQL, never from a login body.

All mutation requests require an exact allowed `Origin` header, including command-line/Postman requests. Authenticated mutations also require `X-CSRF-Token` from login or `/auth/me`. Send cookies with each authenticated request. The supplied auth:check command handles this for you.

React calls use `credentials: 'include'`; keep the CSRF token in runtime memory, not localStorage. ALLOWED_ORIGINS defaults to `http://localhost:3000` and `http://localhost:5173`. Keep browser frontend and backend on matching hostnames rather than mixing localhost and 127.0.0.1. Add only explicit trusted origins; there is no wildcard credential CORS.

## Authentication and sessions

- Passwords use salted scrypt with N=32768, r=8, p=3, a random 16-byte salt and 64-byte output. This is one OWASP-listed scrypt configuration. Using the Node built-in avoids native-addon installation for beginners.
- Login issues a new cryptographically random 32-byte opaque session token. Only its SHA-256 hash is stored in the existing sessions table. Login replaces/revokes an existing session cookie presented by the same client. Other devices remain logged in until logout/expiry/password change.
- Sessions expire absolutely after SESSION_HOURS, default 12 hours. They are not silently extended on each request.
- Cookies are HttpOnly, SameSite=Lax, and scoped to `/`. Production mode requires HTTPS origins, database TLS, Secure cookies and a host-only `__Host-` cookie name. Local HTTP cookies intentionally omit Secure so local login works.
- Current is_active, role and must_change_password are loaded from the database on every authenticated request. Expired/revoked/deactivated sessions receive 401 and the cookie is cleared.
- Temporary-password users may call `/auth/me`, change their password or logout; protected role endpoints remain blocked until the password is changed.
- Password changes validate the current password, revoke ALL old sessions and issue a replacement session/cookie in the same transaction. They cannot be used as a password reset without knowing the current password.
- Login failures are generic and unknown usernames perform dummy scrypt work. Login/password changes are rate-limited. These limit counters are in memory for a single local process; they do not persist after restart or coordinate multiple servers. Sessions themselves persist in PostgreSQL.

## Permissions for future modules

Use `requireAuth(db, config)` and then `requireRoles('ADMIN')` for financial/admin routes. Use the appropriate ADMIN/DELIVERY role set for delivery routes, AND filter each Tanaji query to his assigned orders. A role alone does not authorize a particular order or financial file. Read the existing delivery-safe view instead of serializing a full order to his browser. Phase 5 implements those delivery checks and excludes file references from its safe response. Phase 6 provides scoped file access, including only the exact assigned-order design image snapshot.

CLI provisioning is for the person who controls the local backend/database credentials. It bypasses application login deliberately, cannot be called through HTTP, requires an ADMIN account before creating DELIVERY users, and logs USER_CREATED. There are no user-role-change, user-deactivation or password-reset APIs in this phase.

## Activity logs and transactions

The helper accepts explicit allowlisted fields rather than whole request/user objects. Passwords, password hashes, raw/hashed session tokens, cookies, CSRF tokens and environment values must never be passed to it.

Successful login, logout, password change and account creation write their activity record in the SAME transaction as the change. If logging fails, the change rolls back. Failed login attempts are logged without retaining the attempted password or arbitrary username. Existing database triggers keep audit rows append-only.

For a later business service:

```typescript
await db.transaction(async tx => {
  // Parameterized SQL changes go here.
  await writeActivity(tx, {
    actorId: authenticatedUser.id,
    action: 'YOUR_ACTION',
    entityType: 'YOUR_ENTITY',
    entityId: recordId,
    requestId
  });
});
```

Use the transaction's `tx`, not a separate pool query, for the change and its log. Extend the audit field allowlist deliberately when adding business modules. Pool transactions acquire one client for BEGIN, every query and COMMIT/ROLLBACK.

## Useful commands

| Command | Purpose |
|---|---|
| npm run typecheck | Check source/scripts/tests with strict TypeScript |
| npm run build | Compile backend to dist/ |
| npm start | Run the compiled backend after build |
| npm test | Run disposable PostgreSQL-engine integration tests |
| npm run db:migrate | Apply pending migrations; verify old checksums |
| npm run sessions:cleanup | Remove revoked/expired sessions older than seven days |
| docker compose stop | Stop the local database while retaining data |

Tests use isolated PGlite PostgreSQL instances and Supertest HTTP requests. They never use DATABASE_URL or create real business records. No database service is needed for these tests. They do not consume your live order-number sequence.

## Database accounts and later hosting

For beginner local setup, Compose gives a single development owner account. Do not expose this database port publicly or use this owner credential as a hosted runtime account. Production separates MIGRATION_DATABASE_URL (owner) and DATABASE_URL (restricted runtime).

Runtime needs schema usage; SELECT/INSERT/UPDATE for auth users/sessions and Phase 2 customers/designs/suppliers; DELETE on sessions for cleanup; SELECT plus column-level UPDATE(id) on files for PostgreSQL FOR SHARE image-validation locks; INSERT on activity_logs; SELECT on public.divyashilla_migrations for readiness; and needed function execution. Phase 3 additionally needs SELECT/INSERT/UPDATE on orders and deliveries (including the automatic delivery insert), sequence USAGE for order-number generation, and SELECT on order_financials and its underlying customer_payments, supplier_payments, supplier_payment_allocations and order_expenses tables. Phase 4 needs SELECT/INSERT/UPDATE on customer_payments, supplier_payments and order_expenses; SELECT/INSERT on supplier_payment_allocations; SELECT on supplier_balances and its underlying suppliers table, and SELECT/INSERT plus column-level UPDATE(id) on idempotency_requests for retry persistence/row locks. Do not grant DELETE on ledgers or allocations: all corrections retain history. Phase 5 needs SELECT on delivery_order_details and SELECT on activity_logs columns id, entity_type, entity_id, action, reason, after_data and created_at for the scoped issue-reason lookup. It reuses orders/deliveries UPDATE and users SELECT/UPDATE row-lock privileges. Phase 6 needs SELECT/INSERT on files, existing column UPDATE(id) for design-file row locks, and parent-table SELECT/UPDATE row-lock privileges. It never updates/deletes file rows through public APIs. Audit rows must not have runtime UPDATE/DELETE privileges. No DELETE grant is needed on master tables because their DELETE APIs only deactivate records. Do not grant TRUNCATE, DDL/schema ownership or direct browser database access. Configure exact proxy trust only when a real reverse proxy is introduced. No Azure resources, deployment settings or remote repository are created by these files.

## Troubleshooting

- Invalid configuration: run env:init if .env is missing, or compare the named variable with .env.example. CSRF_SECRET must be a random hexadecimal secret; the setup command generates it.
- Connection failure: start Docker/native PostgreSQL, confirm the port, then check DATABASE_URL privately. Changing .env's Docker password does not change the password inside an existing volume; update the database account deliberately instead of deleting data.
- Extension failure: defer migration 004 with ENABLE_CONTAINS_SEARCH=false. Successfully applied earlier migrations remain recorded.
- HTTP 401: login again; session may be missing, expired, revoked or inactive.
- HTTP 403: check role, first-login password change, allowed Origin and CSRF header.
- Password input not visible: expected. The terminal hides typed characters. Use an interactive terminal rather than redirected stdin.
- /health/ready returns 503: apply migrations with this runner and check database permissions/connectivity.

## References

- Express async errors: https://expressjs.com/en/5x/guide/error-handling/
- PostgreSQL transactions with pg: https://node-postgres.com/features/transactions
- Password storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Node crypto/scrypt: https://nodejs.org/download/release/v24.15.0/docs/api/crypto.html

See VALIDATION.md for checks actually performed on this package.
