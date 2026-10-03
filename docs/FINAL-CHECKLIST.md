# Final testing and release checklist

Local automated checks passing prepares a release; live Azure checks below are still required after a helper deploys. No Azure verification is claimed by this package.

## Before deployment

- [ ] Private GitHub repo, MFA, no .env/credentials/customer data/backups in staged files or history.
- [ ] Node 24, lockfile installs, `npm run check` and all browser workflows pass in CI.
- [ ] Built Linux release root contains dist/server.js, public/index.html, package files and production dependencies; no source ZIP wrapper/private files.
- [ ] Exact release SHA recorded; previous verified production artifact retained.
- [ ] Existing migration checksums unchanged; no new migration needed for this phase.
- [ ] Matched database/files backup verified and restore rehearsal recorded.
- [ ] Separate staging database/container, runtime role grants, managed identity and container scope verified.
- [ ] Environment placeholders replaced privately; TLS, HTTPS, narrow network rules and no owner credential on runtime.

## After deployment, before real business writes

- [ ] /health/live and /health/ready return 200; startup uses Azure storage, not local disk.
- [ ] React root/deep-link refresh works; unknown /api and missing assets return 404 rather than index.html.
- [ ] Valid HTTPS certificate, secure HttpOnly host-only SameSite=Lax session cookie, no mixed content.
- [ ] Unapproved browser origins/forged CSRF writes fail; trusted login/logout and password change work.
- [ ] Ayush ADMIN login accesses masters, orders, finances and reports; Tanaji sees only assigned deliveries.
- [ ] Tanaji direct ADMIN/report/financial URLs and API calls are denied; delivery responses contain no prices/profit/payment/expense fields.
- [ ] Test order gets a backend-generated number; customer/design snapshots and financial totals match backend.
- [ ] Posted payment/expense totals, overpayment/invalid refund denial, allocation and void rules remain correct on staging.
- [ ] Assign, send (required driver fields), optional bus edit, ISSUE and completion work; completing also changes order status.
- [ ] Reassignment removes the old driver's order/file access; stale edits require explicit reload.
- [ ] JPEG/PNG/WebP/PDF uploads and private downloads work; >10 MiB, bad MIME/signature and wrong owner/category are rejected.
- [ ] Design image selection preserves existing order snapshots; financial documents remain ADMIN-only.
- [ ] Direct unauthenticated blob URL fails; no public storage or SAS links appear in UI/network responses.
- [ ] Restart app: database records, login sessions (subject to expiry) and uploaded blobs survive.
- [ ] Mobile 320/390/768 and desktop display, loading/empty/error/retry states checked on actual user devices.
- [ ] Rate limiting, actual proxy/client IP, readiness monitoring, disk/DB/CPU alerts and costs checked.
- [ ] Backup retention/versioning and independent matched backup method confirmed.

Use isolated staging records for destructive/posting checks. Do not manufacture real payments in the live ledger to test the app. Before release, Ayush verifies sample balances/files and Tanaji tries his normal delivery work. Do not share their account passwords with screenshots.

## Updating later

Back up, check CI, deploy the reviewed artifact manually, verify readiness/login/files and record the SHA/date. Never automatically run account provisioning or migrations at every restart. Revisit original grants when future schema changes require new permissions. Review dependency advisories and update in a tested branch; do not blindly run npm audit fix on production. Existing reports APIs include CSV but reports/export frontend screens and user-management UI remain outside these completed frontend phases.
