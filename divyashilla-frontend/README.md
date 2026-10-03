# DivyaShilla frontend — Phase 12

React + TypeScript + Vite frontend with Phase 11 business screens and Phase 12 production packaging. Azure SDK storage wiring and same-origin compiled-frontend hosting are now configured in the backend. No business features or migrations were added. See [root README](../README.md) and [Azure setup](../docs/AZURE-SETUP.md).

## Start locally

Use Node.js 24. Your existing Phase 7 database, private backend `.env` and uploaded files can stay in place. Do not replace `.env` or copy test data into your business database.

**Terminal 1 — backend**

```bash
cd divyashilla-backend
npm ci
npm run dev
```

For a new installation, first follow the backend README: `npm run env:init`, start PostgreSQL, run the original migrations and provision Ayush/Tanaji. This frontend adds no migrations and no default accounts.

**Terminal 2 — frontend**

```bash
cd divyashilla-frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Sign in with the account created by the backend user-provisioning command. First-login accounts must replace their temporary password before accessing business data.

The frontend's default Vite proxy points `/api` to `http://127.0.0.1:3000`. No frontend `.env` is needed with these defaults. If the backend uses another port, copy `.env.example` to a private `.env` and change `BACKEND_PROXY_TARGET`.

Use `localhost` in the browser: the existing backend allows `http://localhost:5173`. If you choose `127.0.0.1` in the browser instead, add that exact frontend origin to your private backend `ALLOWED_ORIGINS`, then restart the backend. This is local configuration, not a backend code change. Vite uses a fixed port and will report an error instead of silently moving to an unapproved origin.

## Included screens

| Screen | ADMIN | DELIVERY |
| --- | --- | --- |
| Login, initial password change, logout | Yes | Yes |
| Shared sidebar/topbar | ADMIN navigation | Restricted workspace navigation |
| Dashboard | Phase 7 summary API | No access |
| Customers | List, create, details, edit, deactivate/reactivate | No access |
| Designs | List, create, details, edit, deactivate/reactivate | No access |
| Suppliers | List, create, details, edit, deactivate/reactivate | No access |
| Orders | List, create, details, edit, status changes | No access |
| Customer payments | List, receipt/refund, detail, void and balance | No access |
| Supplier payments | List, payment/refund, detail, void, allocations and pending amount | No access |
| Order expenses | List, add, detail and void | No access |
| Deliveries | All deliveries, assign user, dispatch and updates | Assigned deliveries only, dispatch and updates |
| Delivery dashboard | Uses ADMIN dashboard | Expected-today and pending assigned deliveries |
| Private files | Design, order and financial record files | Safe files on assigned delivery orders |

Phase 11 adds delivery operations and private file screens, described in [PHASE11.md](PHASE11.md). Prior master, order and financial screens remain available. Reports list/export UI and deployment remain outside this phase.

Customers/designs/suppliers use the existing backend's soft deletion: **Deactivate** hides a record from active lists while preserving history. A reason is required. Filter by Inactive or All records to view or reactivate it. Editing an inactive record does not reactivate it.

Record lists offer search, exact field filters, active/inactive/all status, sort field/direction and page size. Click **Apply filters** to run the search; **Reset** clears it. Page/filter state lives in the URL and works with browser back/forward and direct links. It is not stored in localStorage. Forms validate required fields, lengths, phones and invalid characters before calling the backend; the backend still performs authoritative validation. Duplicate design numbers appear as a useful save error, retaining the entered form values.

## Dashboard meanings

The dashboard reads `/api/v1/reports/dashboard`; it does not calculate financial totals in the browser. Optional inclusive date ranges select orders by order date. Current payments/expenses against those orders are included even when recorded later. Supplier due is the lifetime payable for suppliers represented in the selected orders. Monthly figures are the current India calendar month intersected with the selected date range.

Money is formatted from decimal strings without floating-point conversion. Known profit is labelled as a subtotal when buying prices are missing. Cancelled orders remain in total-order counts but are excluded from sales, profit and customer dues. See the backend PHASE7.md for full report semantics.

## Sessions and permissions

- Requests use `credentials: 'include'` with the backend's existing HttpOnly session cookie.
- The client restores sessions with `/auth/me` and keeps the CSRF token only in React/module memory. It adds `X-CSRF-Token` to authenticated writes.
- A 401 on a protected request clears the frontend session and returns to login. Failed login credentials remain on the login page with a useful error.
- Sessions refresh on window focus and every minute; a local expiry timer clears expired sessions. A BroadcastChannel, when supported, helps other tabs refresh after login/logout/password changes.
- Role/password-change guards control all routes. A DELIVERY user opening an ADMIN URL returns to `/workspace` without requesting ADMIN data. Backend permissions still enforce every API request.
- Role/CSRF denials trigger a session refresh; writes are never retried automatically. If another tab changed the session, retry the action after refresh. Logout errors retain the session and show an error rather than pretending logout succeeded.
- No tokens, passwords or business data go into localStorage/sessionStorage. No database or blob-storage access occurs from the browser. Never add secrets to `VITE_*` variables: those are public build values.

The local proxy preserves the browser Origin so the backend's trusted-origin/CSRF checks remain active. The development and preview servers use the same proxy setup.

## Build and tests

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

The build outputs `dist/`. Preview opens the compiled frontend at http://localhost:5173 and still requires the backend. Stop the dev server before starting preview on that port. Vite preview is for local checks. Production uses the compiled frontend served by Express in Azure App Service; see the root release builder and Azure guide.

Browser tests use an isolated in-memory PostgreSQL engine and real Express routes. They never read the private backend `.env` or connect to your live database. Stop the normal frontend server first; tests reserve frontend port 5173 and test backend port 3180. Install dependencies in both folders before running:

```bash
npx playwright install chromium
npm run test:e2e
```

On Linux, Playwright may require its browser system dependencies; follow its installation output. An existing Chromium executable can optionally be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The disposable test accounts and seed records exist only in `tests/start-backend.ts`; they are not part of normal frontend startup. See VALIDATION.md for checked behavior and limits.

## Folder structure

```text
divyashilla-frontend/
  src/
    api/                  API client, contracts, cancellable read hook
    auth/                 Session provider, login/password forms, validation
    components/           Shared layout, controls and feedback states
    modules/
      dashboard/          Report summary, exact money formatting, date validation
      masters/            Customers/designs/suppliers screen definitions and CRUD
      orders/             ADMIN orders, selectors, snapshots and status changes
      finance/            Payments, expenses, balances, voids and allocations
      delivery/           Assigned dashboard, safe details, assignment and updates
      files/              Private record files, upload, download and image preview
    styles/global.css     Responsive business UI
    App.tsx               Authentication and role route guards
    main.tsx              React entry point
  tests/                  Unit, route and real-API browser checks
  vite.config.ts          Local proxy and build setup
  .env.example            Backend proxy target, no secrets
```

The shared master-screen code handles presentation only. The three module definitions keep their fields, limits, columns and filters explicit. PostgreSQL rules and audit logging stay in the backend. Native dialogs keep confirmation/navigation focus contained; labels, inline errors, keyboard focus, a skip link, loading/empty/error states and reduced-motion styles are included. Mobile record tables become readable cards while retaining their table markup.

Official references: [Vite server proxy](https://vite.dev/config/server-options#server-proxy), [Vite preview options](https://vite.dev/config/preview-options), [React Router BrowserRouter](https://reactrouter.com/api/declarative-routers/BrowserRouter).

## Production frontend

Run the root npm run release:build on Linux or use the CI artifact. The build is copied into the release public/ folder and served by Express with React deep-link fallback. API requests remain relative /api/v1 requests on the same HTTPS host. No frontend secret or production Vite server is required. Do not deploy this source folder or a separate cross-site static app without following the reviewed hosting guide.
