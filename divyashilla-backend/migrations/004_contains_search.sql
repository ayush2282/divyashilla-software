-- pg_trgm must be allowed/enabled on your PostgreSQL service.
-- Core prefix/equality searches already work after migration 003.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX customers_name_contains_idx ON divyashilla.customers USING gin (name public.gin_trgm_ops);
CREATE INDEX customers_phone_contains_idx ON divyashilla.customers USING gin (phone public.gin_trgm_ops);
CREATE INDEX suppliers_name_contains_idx ON divyashilla.suppliers USING gin (name public.gin_trgm_ops);
COMMIT;
