# Phase 12 validation

Checked 2 October 2026 with Node.js 24.19.0. No Azure resources were created or deployed.

| Check | Result |
| --- | --- |
| Backend TypeScript and build | Passed |
| Backend regression/integration tests | 139 passed |
| Frontend TypeScript, tests and Vite build | Passed; 57 tests |
| Chromium browser workflows | 27 passed |
| Linux release builder | Passed; production-only dependencies installed |
| Compiled release Azure SDK imports | Passed |
| Original migrations | All four byte-for-byte unchanged from Phase 11 |
| Existing dependency versions | Retained; Azure identity/blob dependencies added with locked versions |
| Runtime dependency audit | Zero reported advisories in both application folders at check time |

Four new backend production checks cover valid TLS/HTTPS/Azure configuration, React deep links with correct API/asset/private-path errors, public-container denial/exclusive writes and restricted runtime SQL grants including immutable record row locks. All 135 earlier backend tests and all 57 frontend tests pass. The browser suite covers all 27 previous auth, CRUD, orders, payments, delivery and private-file workflows.

The first browser attempt could not launch because the old temporary Chromium executable was gone. Standard browser download returned truncated bytes in this environment. Chromium 153 was restored from a temporary npm browser package and the full suite was rerun successfully; that recovery package is not added to application dependencies. GitHub CI uses Playwright's standard Chromium installation.

Release packaging was executed on Linux, installed the exact production lockfile and verified that compiled Azure SDK imports resolve. The source archive excludes real .env, uploads, dumps, dependencies, compiled output and test traces; the release builder selects compiled files only. Existing backend dependency versions were not opportunistically updated. SDK dependencies are @azure/identity 4.13.3 and @azure/storage-blob 12.34.0.

## What remains to verify when you deploy

No live App Service, managed-identity token, Blob network/RBAC, PostgreSQL TCP/TLS connection, DNS/certificate, cloud backup/restore or Azure load test was performed. The adapter uses the official Azure SDK and its private-container checks, tested through a structural fake; credentials and actual Azure networking must pass the post-deployment checklist. Local database tests use disposable PGlite and cannot prove Azure permissions/networking or multi-connection concurrency. Browser workflows run through the local Vite proxy; compiled-frontend deep-link/API separation is separately tested with Express. Physical phones, Safari/Firefox and a formal accessibility audit are not covered.

The dependency audit is a point-in-time advisory check, not a penetration test. Recheck before each release. Production uses one process/instance with in-memory rate-limit counters; sessions are durable in PostgreSQL. Uploaded bytes still use existing format/signature checks, not antivirus scanning. File upload and delivery version/recovery behavior remain as in Phase 11. Reports/export and user-administration frontend screens are not added by this deployment phase.
