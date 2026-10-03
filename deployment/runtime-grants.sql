-- Run once AFTER the four existing migrations, as their owner.
-- Create the login separately with psql \password; no password belongs in this file.
-- The role must already exist as divyashilla_runtime (NOSUPERUSER NOCREATEDB NOCREATEROLE).
BEGIN;
GRANT CONNECT ON DATABASE divyashilla TO divyashilla_runtime;
GRANT USAGE ON SCHEMA divyashilla TO divyashilla_runtime;
GRANT SELECT, INSERT, UPDATE ON divyashilla.users, divyashilla.sessions,
  divyashilla.customers, divyashilla.designs, divyashilla.suppliers,
  divyashilla.orders, divyashilla.deliveries,
  divyashilla.customer_payments, divyashilla.supplier_payments,
  divyashilla.order_expenses TO divyashilla_runtime;
GRANT DELETE ON divyashilla.sessions TO divyashilla_runtime;
GRANT SELECT, INSERT ON divyashilla.supplier_payment_allocations,
  divyashilla.files, divyashilla.idempotency_requests TO divyashilla_runtime;
GRANT UPDATE (id) ON divyashilla.files, divyashilla.idempotency_requests TO divyashilla_runtime;
GRANT INSERT ON divyashilla.activity_logs TO divyashilla_runtime;
GRANT SELECT (id,entity_type,entity_id,action,reason,after_data,created_at)
  ON divyashilla.activity_logs TO divyashilla_runtime;
GRANT SELECT ON divyashilla.order_financials, divyashilla.supplier_balances,
  divyashilla.delivery_order_details, public.divyashilla_migrations TO divyashilla_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA divyashilla TO divyashilla_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA divyashilla TO divyashilla_runtime;
COMMIT;
