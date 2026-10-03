# Troubleshooting — Ayush and Tanaji

Use the exact link provided by your helper. For errors, record the time, page, action and visible request ID. Send a screenshot without passwords/private document content. Do not edit database rows or reset the database to fix a screen.

| What you see | What to do |
| --- | --- |
| App will not open | Check internet and try the exact HTTPS address. If everyone is affected, ask the helper to check App Service health/Log stream. |
| Login rejected | Check username, typing and correct hostname. Do not share accounts. Too many attempts: wait and retry. Forgotten passwords need the helper; no default password exists. |
| Asked to change password | This is expected at first login. Choose your own permanent password. |
| Logged out | Sign in again. Sessions expire; another tab's logout or a security change can also end access. |
| Tanaji has no deliveries | Ayush checks that the order is ready and assigned to Tanaji. Tanaji clears filters or opens All assigned. |
| Tanaji cannot see payments | Expected: these pages are only for ADMIN. |
| Driver details will not save | Driver number and driver/bus name are required to send. Check visible validation. ISSUE or delivered status may block the action. |
| Another person updated the delivery | Read the latest record before retrying. Reload latest discards the old draft; do not repeatedly press save. |
| Delivery is ISSUE | Give Ayush the reason. This version has no automatic issue-resolution workflow. |
| Upload rejected | Use JPG/PNG/WebP or PDF, 10 MiB or smaller; images cannot use PDF. Do not rename an unrelated file to fake its format. |
| Upload outcome uncertain | Refresh the file list and check whether it is already there before choosing/uploading again. |
| File missing after reassignment | Access may have changed. Ayush checks assignment and whether it is a financial document. |
| Payment response uncertain | Use the screen's explicit retry procedure; do not create a second payment blindly. |
| Blank page after refresh | Ask helper to check compiled frontend/public folder and startup settings. |
| App slow / too many requests | Wait briefly, close repeated refreshes and retry once. Ask helper if it persists. |

## Helper's diagnosis

| Symptom | Check |
| --- | --- |
| Startup fails | NODE_ENV/secret format, HOST/PORT, startup node dist/server.js, deployed ZIP layout, FRONTEND_DIRECTORY |
| Private storage initialization fails | System identity enabled, container-scoped Blob Data Contributor, valid names, private access, role propagation/network route |
| DB connection/readiness fails | Flexible Server status, exact encoded URL, runtime grants, TLS verification, outbound firewall IPs or VNet DNS, migration history |
| Extension/migration failure | azure.extensions allows pg_trgm; owner privileges; do not alter original checksums |
| Permission denied on app query | Reapply reviewed runtime grants as owner; do not grant owner/superuser/ledger DELETE to runtime |
| 403 origin/CSRF | Exact current HTTPS origin without slash; same hostname frontend/API; leave platform CORS empty; sign out/in after secret rotation |
| Login never persists | Production HTTPS, cookie host, secure settings, browser cookies allowed; no cross-site frontend/API |
| Missing private documents | Check ACTIVE database blob_key against exact UUID object and backup manifest; restore matching private files |
| 429 unexpectedly | Real client IP/proxy hop configuration; one-instance per-process limits; do not simply disable security |
| New hostname breaks login | Add exact origin, validate certificate; user must sign in on the new host |

Check logs without printing connection URLs, cookies, tokens, passwords, private file bytes or request bodies. If changing settings, keep the old values securely for rollback. If data appears inconsistent, pause writes and involve Ayush before restoring; an old backup can lose newer payments/orders.
