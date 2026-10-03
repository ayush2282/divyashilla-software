# Azure setup — perform later, nothing is deployed by this package

## 1. Accounts and resource names

Ayush should own the Azure subscription and private GitHub repository; enable MFA and give the helper only required access. Set an Azure budget alert before creating paid resources. Record the resource group, region, app name, database server, storage account, container and Git commit. Use separate resources for test/staging and real business data.

Create a resource group (for example `divyashilla-production`) in a region available to your subscription near your users. Check current Azure prices in the portal; no monthly cost is promised here.

## 2. PostgreSQL Flexible Server

Create Azure Database for PostgreSQL **Flexible Server**, PostgreSQL 16 or 17 (app supports 15+). Set a unique owner password in your password manager. Create database `divyashilla`. Set backup retention to 35 days if suitable for your budget. Enable TLS; the app verifies certificates with `PG_SSL=true`.

For straightforward initial setup, public networking may be enabled with narrow firewall rules: your helper's current public IP and **all listed App Service outbound and possible outbound IPs**. Do not enable the broad "allow all Azure services" rule. Recheck outbound IPs after plan/region changes. Prefer VNet integration/private database networking if your helper can configure its DNS, subnet and access correctly. Never open PostgreSQL to every IP.

Under server parameters, add `pg_trgm` to `azure.extensions` without removing any existing extension allowlist entries. Follow [Database and users](DATABASE-USERS.md) to apply original migrations and separate owner/runtime credentials. If extension setup is unavailable, core migrations 001–003 work with `ENABLE_CONTAINS_SEARCH=false`; migration 004 remains deferred, not removed.

## 3. Private Blob Storage

Create a general-purpose v2 **Standard** storage account, without hierarchical namespace, with HTTPS required and minimum TLS 1.2. Set **Allow Blob anonymous access = Disabled**. Create container `private-files` with access level **Private (no anonymous access)**. Do not create public/SAS links or browser storage credentials; no Blob CORS rule is needed.

Enable blob soft delete, container soft delete and versioning (for example 35-day retention). Set suitable retention/lifecycle costs and protect these settings from accidental removal. These are recovery protection, not a coordinated database/files backup. See the backup guide.

Storage may use its public network endpoint with private identity authorization, or a private endpoint/VNet configuration if implemented by the helper. A private container does not mean a private network endpoint. If applying a firewall, ensure the web app's network route can reach Blob Storage; managed identity alone does not bypass a firewall.

## 4. App Service — backend and frontend together

Create an Azure **Linux App Service**, code deployment, **Node 24 LTS**, on a paid plan supporting Always On (start with one instance sized for this small business; confirm pricing/capacity). No Static Web App is necessary: the included server serves React and the API on the same hostname.

Configure:

| Setting | Value |
| --- | --- |
| HTTPS Only | On |
| Minimum inbound TLS | 1.2 or higher |
| Startup command | `node dist/server.js` |
| Always On | On |
| Health check path | `/health/ready` |
| Instance count | 1 initially |
| App Service Authentication / Easy Auth | Disabled; app uses its own login |
| FTP/basic publishing authentication | Disable if using Entra-authorized CLI deployment |

In **Identity > System assigned**, enable the identity. In the Blob container's **Access control (IAM)** grant **Storage Blob Data Contributor** to that web app identity, scoped to this container. This permits the existing storage cleanup path as well as upload/download. Wait for permission propagation. Do not add storage account keys to app settings. Slots have separate identities and need their own test resources/permissions.

Add every setting from `deployment/app-service.env.example`, replacing placeholders using [Environment](ENVIRONMENT.md). Secret values should be App Service settings or Key Vault references; never commit real values. Do not set the owner database URL on the running web app. Do not change App Service's supplied PORT. Set `HOST=0.0.0.0`. Start with `TRUST_PROXY_HOPS=1` for direct App Service ingress and verify client IP behavior; revisit this if adding Front Door or another proxy.

Keep one instance initially: session state is in PostgreSQL, but rate-limit counters are per process. Multiple instances/restarts do not share counters. Introduce shared edge/distributed rate limiting before scaling into a different threat/capacity model. App Service health checks test database/core schema, not Blob access on every check; storage is checked on startup and each operation.

## 5. Existing business data and local files

For an empty production installation, follow the fresh database/account procedure. For existing Phase 11 data, use the backup/restore cutover procedure instead of importing test data or recreating users.

Existing local file objects must be transferred with the **exact UUID blob_key names** stored in `divyashilla.files`. Stop writes, back up both parts, copy all matching files privately to the production container (for example an authenticated `az storage blob upload-batch --auth-mode login --account-name YOUR_ACCOUNT --destination private-files --source YOUR_PRIVATE_FILE_DIRECTORY`), preserve UUID names, and compare each ACTIVE record's size/hash to the uploaded object. Do not upload the directory name as a blob prefix, create new metadata rows or expose the directory publicly. The copy command is for a clean container; do not enable overwrite for an existing live container. The helper's Azure identity needs temporary upload permission, removed afterwards. Do not delete the original copy until restore/download checks pass.

## 6. Deploy the built release manually

Use a passing Linux GitHub Actions `app-service-release` artifact or build on Linux with Node 24. Extract the artifact wrapper to obtain **divyashilla-app.zip**. Verify the ZIP root contains `dist/server.js`, `public/index.html`, `package.json` and `node_modules`; it must not contain an enclosing `app/` folder. This compiled release has remote build disabled and no dev dependencies.

Install Azure CLI, sign in as the authorized helper, select the intended subscription, then run only when ready:

```bash
az login
az account set --subscription YOUR_SUBSCRIPTION_ID
az webapp deploy --resource-group YOUR_RESOURCE_GROUP --name YOUR_APP --src-path divyashilla-app.zip --type zip
```

No deploy workflow is enabled. This command actually changes the selected app when run by you. Keep the previous artifact for rollback. Release packaging itself never connects to Azure.

Visit `https://YOUR_APP.azurewebsites.net/health/live` and `/health/ready`, then sign in and run the final checklist, including private file upload/download. Use Log stream for startup failures. Before live operations, check backup retention and perform a restore rehearsal.

## 7. Optional custom hostname

After default-host verification, attach a dedicated internal hostname such as `manage.divyashilla.in` through App Service custom domains, using its displayed DNS verification records, and bind a valid certificate. Keep the public product website separate. Add only the exact new HTTPS origin to ALLOWED_ORIGINS. Test login/deep links on it; cookies are host-only, so users sign in again after changing hostname. Remove origins no longer used. Do not add a separate cross-site Static Web App without a reviewed same-origin API gateway and cookie design.

## 8. Monitoring and updates

Enable App Service application logs/Log stream, Azure resource-health alerts and alerts for repeated HTTP 5xx, CPU/memory and PostgreSQL storage/connection limits. Limit log retention; never log request bodies, passwords, cookies or private file content. Track release commit and date. Review budgets, backups and security updates regularly. Cleanup expired sessions with `npm run sessions:cleanup` from a secured administrative workspace using the runtime connection; the deployed runtime artifact excludes this TS helper. Follow release checklist for each update; migrations never run automatically on application startup.

Official references (verified 2 October 2026): [Node App Service](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs), [ZIP deployment](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip), [managed identity](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity), [JavaScript storage access](https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-app-access-storage-javascript), [PostgreSQL extensions](https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-create-extensions).
