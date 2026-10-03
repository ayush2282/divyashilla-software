# DivyaShilla — Phase 12

Internal business software for Ayush (ADMIN) and Tanaji (DELIVERY). Phase 12 prepares production hosting; it does not create Azure resources or add business features.

**Start here:** [Azure setup](docs/AZURE-SETUP.md). For daily problems, use [Troubleshooting](docs/TROUBLESHOOTING.md). Deployment should be performed by a technical helper, with Ayush controlling the Azure/GitHub accounts.

| Folder | Purpose |
| --- | --- |
| divyashilla-backend | Express/TypeScript APIs, sessions, original migrations |
| divyashilla-frontend | React/TypeScript/Vite screens from Phase 11 |
| deployment | Production settings template and restricted database grants |
| scripts | Local checks and safe release packaging; no deployment |
| docs | Azure, environment, data setup, backups, testing and troubleshooting |
| .github/workflows | CI checks and a built App Service artifact; no automatic deployment |

## Local start

Install Node.js 24. In each application folder run `npm ci`. Keep any existing private backend `.env`, PostgreSQL data and uploads. For fresh local setup follow the backend README (`npm run env:init`, Docker PostgreSQL, original migrations, account creation). Run `npm run dev` in each folder in separate terminals; open http://localhost:5173.

## Production arrangement

A Linux Azure App Service runs Express and serves the compiled React frontend on the same HTTPS origin. `/api/v1` goes to APIs; React deep links return index.html. Unknown API/assets remain 404. PostgreSQL Flexible Server stores records. The server accesses a private Blob container with its system-assigned managed identity. This is the selected suitable Azure frontend hosting option; a separate Static Web App is not required or configured.

Production startup validates storage and database access. Local files cannot be selected in production. The four database migration files are unchanged. New code is limited to Azure SDK storage wiring, production configuration and built-frontend hosting. No business routes, roles or workflows are added.

## Checks and release

From the repository root, after `npm ci` in both folders:

```bash
npm run check
```

For browser tests: `cd divyashilla-frontend`, `npx playwright install chromium`, `npm run test:e2e`. Tests use disposable data/storage, not your business database.

Build an App Service release on Linux or through GitHub Actions:

```bash
npm run release:build
cd release/app
zip -qr ../divyashilla-app.zip .
```

The release builder copies only compiled backend, compiled frontend, package files and production dependencies into `release/app`. It does not copy private .env, migrations, test fixtures or live uploads. The **source ZIP you received is not the deployable ZIP**. Deployment commands are instructions in the guide and require a configured Azure account; no deployment occurs during checks/builds.

## Private GitHub repository

Create an empty **private** repository under your own account. Extract this package, keep the included root `.gitignore`, then review staged files before committing:

```bash
git init
git branch -M main
git add README.md package.json .nvmrc .gitignore .github scripts deployment docs divyashilla-backend divyashilla-frontend
git status --short
# Check that no .env, var uploads, backups, node_modules or releases are staged.
git commit -m "Prepare DivyaShilla Phase 12 production setup"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_PRIVATE_REPO.git
git push -u origin main
```

If already using a Git repository, use its existing history/remote and a branch instead of reinitializing. Do not commit passwords, publish profiles, database dumps, customer files or real production configuration. Use branch protection and require CI before merging where your GitHub plan supports it. CI has read-only repository permissions, uses no Azure secrets and never deploys/migrates/provisions accounts. Download the `app-service-release` artifact from a successful run; keep the commit SHA with the release.

## Guides

- [Azure setup](docs/AZURE-SETUP.md)
- [Environment and security](docs/ENVIRONMENT.md)
- [Database and first users](docs/DATABASE-USERS.md)
- [Backup and restore](docs/BACKUP-RESTORE.md)
- [Final testing and release checklist](docs/FINAL-CHECKLIST.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Validation evidence](docs/VALIDATION.md)
