# Database migration and first accounts

These commands are for a technical helper on a trusted machine with Node 24, backend dependencies and PostgreSQL client tools. Never run them against an unknown server. Keep the owner connection separate from the running application. A production `.env` in the administrative workspace must be private and ignored by Git; fill the validated settings (including azure storage names), DATABASE_URL and MIGRATION_DATABASE_URL. Owner credentials are for setup only. The TS scripts do not initialize Blob storage or serve the frontend.

## Fresh database

1. In PostgreSQL Flexible Server create database `divyashilla`, owned by the chosen setup account. Configure narrow network access and extension allowlist as described in the Azure guide. Do not use this owner credential in the web app.
2. In `divyashilla-backend`, install with `npm ci`, configure the administrative workspace's private variables and run:

```bash
npm run db:migrate
```

The original four SQL migrations run in numerical order; each SQL/history commit is transactional and protected by an advisory lock. Reruns check checksums and skip applied migrations. No new migration is included in Phase 12. Never run the SQL files manually and then ask the runner to guess its history. If an existing database has no migration history, stop for a reviewed baseline; do not drop data or edit recorded checksums.

3. Connect with psql as owner (`PGHOST`, `PGPORT=5432`, `PGDATABASE=divyashilla`, `PGUSER` and `PGSSLMODE=verify-full`; configure the current Azure PostgreSQL trusted CA chain for psql verification, and use a protected password file or interactive prompt). Create the runtime role **without a password in SQL**, then set its password using psql's hidden prompt:

```sql
CREATE ROLE divyashilla_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password divyashilla_runtime
```

From repository root with the same owner psql connection:

```bash
psql -v ON_ERROR_STOP=1 -f deployment/runtime-grants.sql
```

This is deployment permission setup, not a schema migration. It assumes database name `divyashilla` and role `divyashilla_runtime`. Runtime has no schema ownership/DDL, no ledger/file deletion, and audit insert plus only delivery-safe audit read columns. It has column UPDATE(id) for PostgreSQL row locks on immutable files/idempotency rows. Database guards still protect history. Do not grant the runtime role membership in the owner role.

4. Create **Ayush first**, then Tanaji in the backend folder:

```bash
npm run user:create -- --username ayush --name Ayush --role ADMIN
npm run user:create -- --username tanaji --name Tanaji --role DELIVERY
```

Each prompts twice for a separate 12–128-character temporary password with hidden input. Passwords are hashed with scrypt, not stored as plaintext or supplied in command history. There are no default credentials or public registration. First login requires a permanent password change. Hand Tanaji his own temporary password securely; never share Ayush's account.

5. Put only the runtime URL in App Service DATABASE_URL. Remove owner credentials from the running app, secure the administrative workspace and remove temporary firewall permissions. Test production login for each role, then Ayush assigns delivery orders to Tanaji through the UI.

## Existing Phase 11 data

Do not create a fresh empty business database over existing records. Back up, restore/import the existing database together with private files using the recovery guide. The restore must include `public.divyashilla_migrations`, the divyashilla schema and sequence states, so order numbers remain unique. Existing users and password hashes come with the restore; do not create duplicate Ayush/Tanaji accounts. Create the runtime role/grants on the new server, verify checksum history with the runner, migrate file objects preserving UUID keys, and check balances/snapshots before cutover.

The order-number sequence begins at 1001 on a fresh install; never reset it during an upgrade or manually reuse a number. Restored sequence state must exceed every existing order_number. The runner will not reset existing records or number generation.

## Ongoing administration

This project has no user-management/password-reset business UI. Create additional accounts only with the trusted owner provisioning command. A forgotten password or user deactivation requires a helper following the existing auth design; do not invent a default recovery password or expose a public reset endpoint. Expired sessions can be cleaned with the existing sessions:cleanup helper using runtime permissions.
