# Backup and restore

A code ZIP or GitHub repository is **not a data backup**. Keep a recovery copy of PostgreSQL, private file bytes and required secret configuration. Assign a helper and schedule a monthly restore rehearsal. Record backup date/time, database version, release commit, blob account/container and file manifest. Store encrypted copies outside the live app's account permissions, with restricted access and retention.

## Routine protection

Enable Flexible Server automatic backups with appropriate retention (up to 35 days), plus Blob versioning, blob soft delete and container soft delete. Verify these settings and resource health regularly. Set a calendar reminder to check backups. Automatic PostgreSQL recovery does not restore Blob Storage. Retain immutable UUID blobs at least as long as the database backup window; do not independently delete old file objects or prune versions required by a retained database backup.

For independent/exportable backups, use PostgreSQL `pg_dump` plus a private copy of every file referenced by the matching database. Native Azure backups are service-managed and are not downloadable dump files. Longer retention requires a separately planned backup solution.

## Manual matched backup — before cutover or major changes

The helper should announce a maintenance window, stop/restrict **all app instances and other writers**, wait for in-flight requests to finish, then take both copies. Do not let users add orders/files between the database dump and file snapshot. Existing downloaded copies are unaffected by stopping the app.

Configure trusted PostgreSQL client tools matching or newer than the source server major version. Use PGHOST, PGUSER, PGDATABASE, PGPORT and `PGSSLMODE=verify-full` (install the current Azure PostgreSQL trusted CA chain in the PostgreSQL client trust file or set PGSSLROOTCERT to its trusted location), with interactive password input or a permission-0600 password file. Do not put passwords in command arguments or exported URLs. Use a dedicated encrypted backup destination (outside the repository):

```bash
pg_dump --format=custom --no-owner --no-acl --file=/SECURE_BACKUP/divyashilla.dump
pg_restore --list /SECURE_BACKUP/divyashilla.dump
```

Dump the **whole database**, including public.divyashilla_migrations and all sequence state, not just a few business tables. Save a manifest of ACTIVE files (blob_key, size_bytes, MIME and an independently verified SHA-256). Copy referenced UUID objects to a separate private backup container/account or encrypted local destination using an authenticated Azure tool. Preserve exact names and bytes; never publish a backup container. Hash/compare each copied file, save the manifest with the dump, and record the UTC cutoff. A directory of thumbnails is not a backup of original documents.

Record secret references/configuration separately in a password manager or restricted vault; do not put the app's runtime/owner passwords in the backup manifest. Backup operators need permission to read all objects; the live web identity should not be able to delete the independent backup. Start the application only after both copies and the manifest have been verified. Keep multiple generations with a documented retention policy.

## Restore rehearsal — always a new isolated destination

1. Select a verified matched database dump/file backup and its release commit. Create a **new** empty PostgreSQL database/server and new private Blob container; do not restore over live records. Ensure the required extension allowlist is configured.
2. Set the PostgreSQL client connection variables to the new destination and confirm its name. As its owner:

```bash
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=divyashilla /SECURE_BACKUP/divyashilla.dump
```

Do not use --clean on the live database. Do not run fresh migrations before restoring a full dump (the dump already contains schema/history). Azure owner/extension permissions may differ: if an extension restore is denied, resolve the allowed extension/owner setup and retry into an empty database, not by ignoring errors.

3. Recreate the runtime role with a new password, apply deployment/runtime-grants.sql, then use the migration runner with the matching original migration files to verify checksums. Restoring without ACLs deliberately requires reapplying app grants; it does not alter business records. Verify original migration history and sequence values; the next order number must exceed existing numbers, never reset it to 1001.
4. Restore corresponding blobs into the new private container, using their original UUID keys. Verify every ACTIVE file reference has the expected byte count/hash. Do not connect an old database to a newer unrelated file snapshot without reconciling references. Blobs missing from a historical backup may need version/soft-delete recovery before cutover.
5. Delete **sessions only** in the isolated restored database as owner (`DELETE FROM divyashilla.sessions;`) so restored old login sessions cannot remain active. Keep users/password hashes and activity history. Use new runtime credentials and a fresh CSRF secret for the isolated app. Never expose production copied customer data in public preview URLs.
6. Start an isolated test app using the matching release and run the final checklist. Compare order counts/numbers, balances, supplier allocations, delivered states, snapshots and several original file downloads. Capture the successful rehearsal date and recovery time. Only after approval of those concrete checks should the helper repoint the production app to restored resources, restart and verify again. Keep the previous resources until reconciliation is complete.

## Azure point-in-time recovery

In PostgreSQL Flexible Server, select Restore and choose a timestamp before the incident; Azure creates a new restored server. Configure its networking, connection credentials and runtime grants as necessary. Then reconcile Blob versions/reference keys for that same timestamp, revoke sessions and run the rehearsal checks above before switching the app. Choosing a database time alone does not guarantee the files match. Record any orders/payments entered after the recovery timestamp and reconcile them with Ayush before accepting new entries; never replay payments blindly.

## App-only rollback

If code fails after an update but data is intact, redeploy the previous verified compiled ZIP and matching configuration. Phase 12 adds no migrations, so code rollback does not need a database reset. Preserve database/files. Do not restore an older database merely to undo a UI deployment. Check private file wiring and HTTPS settings after rollback; Phase 11's server intentionally rejects production startup, so production rollback targets must already contain durable storage support.

Official references: [Azure PostgreSQL backup](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), [blob protections](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview), [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).
