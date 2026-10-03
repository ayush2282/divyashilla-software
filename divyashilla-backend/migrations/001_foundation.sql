-- PostgreSQL 15+. Apply once, in numeric order, using a migration owner.
BEGIN;
CREATE SCHEMA divyashilla;
REVOKE ALL ON SCHEMA divyashilla FROM PUBLIC;
SET LOCAL search_path = divyashilla, pg_catalog;

CREATE TYPE user_role AS ENUM ('ADMIN', 'DELIVERY');
CREATE TYPE order_status AS ENUM ('NEW', 'IN_WORK', 'READY_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
CREATE TYPE delivery_status AS ENUM ('NOT_ASSIGNED', 'READY_FOR_DELIVERY', 'SENT', 'DELIVERED', 'ISSUE');
CREATE TYPE payment_method AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE customer_payment_direction AS ENUM ('RECEIPT', 'REFUND');
CREATE TYPE supplier_payment_direction AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE payment_purpose AS ENUM ('ADVANCE', 'INSTALLMENT', 'FINAL', 'OTHER');
CREATE TYPE ledger_status AS ENUM ('POSTED', 'VOID');
CREATE TYPE expense_category AS ENUM ('DELIVERY', 'OTHER');
CREATE TYPE file_category AS ENUM ('DESIGN_IMAGE', 'ORDER_PRODUCT_IMAGE', 'CUSTOMER_PAYMENT_DOCUMENT',
  'SUPPLIER_PAYMENT_DOCUMENT', 'EXPENSE_DOCUMENT', 'ORDER_DOCUMENT');
CREATE TYPE file_state AS ENUM ('PENDING', 'ACTIVE', 'DELETED');

-- PostgreSQL NUMERIC accepts NaN; explicitly disallow it as well as negative money.
CREATE DOMAIN money_amount AS NUMERIC(14,2)
  CHECK (VALUE >= 0 AND VALUE < 'Infinity'::numeric AND VALUE <> 'NaN'::numeric);

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  RAISE EXCEPTION 'History must be retained in %. Use deactivate, cancel, or void.', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;
COMMIT;
