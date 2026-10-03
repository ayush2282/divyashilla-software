# Environment variables and production security

Use App Service > Environment variables for runtime values, or Key Vault references. Restart after changes. The supplied production template contains placeholders only. Source `.env.example` defaults to development; `npm run env:init` is a local helper, not production configuration.

| Variable | Production value / purpose |
| --- | --- |
| NODE_ENV | `production`; enables Secure host-only cookie and production checks |
| HOST | `0.0.0.0` |
| PORT | Leave App Service's supplied value; no manual override |
| DATABASE_URL | Restricted runtime PostgreSQL URL, database `divyashilla`; secret |
| MIGRATION_DATABASE_URL | Owner URL only in secured helper workspace, absent from web app |
| PG_SSL | `true`; certificate verification stays enabled |
| CSRF_SECRET | At least 64 hexadecimal characters; secret generated independently per environment |
| ALLOWED_ORIGINS | Exact HTTPS origin(s), comma-separated; no wildcard/path/trailing slash |
| SESSION_HOURS | `12` default; permitted 1–168 |
| TRUST_PROXY_HOPS | `1` for the selected direct App Service topology; never blindly raise |
| FILES_DRIVER | `azure`; local storage is rejected in production |
| AZURE_STORAGE_ACCOUNT | Lowercase account name only, no URL/key/SAS |
| AZURE_STORAGE_CONTAINER | `private-files`, valid lowercase container name |
| FRONTEND_DIRECTORY | `./public` in the compiled App Service release |
| ENABLE_CONTAINS_SEARCH | `true` when original migration 004/pg_trgm is enabled |
| SCM_DO_BUILD_DURING_DEPLOYMENT | `false`, because the release is already built |
| FILES_DIRECTORY | Development only; production uses Blob |
| LOCAL_POSTGRES_PASSWORD | Local Docker only; never an Azure setting |

Generate a CSRF secret on a trusted machine using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, save directly in the secret manager and clear sensitive terminal output. No generated production secret is supplied. Rotating it invalidates current CSRF tokens; users should sign out/in. Changing database passwords requires updating the app secret and restarting.

PostgreSQL URL format: `postgresql://USER:ENCODED_PASSWORD@SERVER.postgres.database.azure.com:5432/divyashilla`. URI-encode username/password special characters; never add `sslmode` query parameters (the configuration rejects options). Do not print URLs in logs. If certificate validation fails, repair the trust/network configuration; never use `rejectUnauthorized=false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Cookies, CORS and CSRF

The production session cookie is `__Host-divyashilla_session`, Secure, HttpOnly, SameSite=Lax, Path=/, with no Domain attribute. The existing client includes credentials; CSRF tokens stay in memory and protect writes. Login and write origin checks remain enforced. Browser/server use one exact HTTPS hostname; the frontend uses relative `/api/v1` URLs, so no production API base secret or CORS proxy is needed.

Set ALLOWED_ORIGINS to the actual app URL, later optionally its custom hostname. Do not put localhost, `*`, preview domains or arbitrary customer websites in production. Leave Azure's separate platform CORS configuration empty; Express handles it. No business request should depend on changing SameSite to None. No secret belongs in `VITE_*` values; there are no production frontend secret variables.

App Service terminates TLS. Restrict proxy trust to the real topology; test untrusted forwarded client-IP headers before introducing extra proxies. Helmet headers and no-store remain active on the hosted frontend/API. Built assets currently use no-store too, trading caching efficiency for simple freshness/privacy. Private uploads are never mounted as static content.

## Development versus production

Development keeps separate Vite port 5173, Express port 3000 and local private storage. Leave FRONTEND_DIRECTORY empty and FILES_DRIVER=local. Vite's BACKEND_PROXY_TARGET is a development server target only; it is not baked into the production API client. Production requires Azure storage and verified PostgreSQL TLS; it cannot silently fall back to local disk.
