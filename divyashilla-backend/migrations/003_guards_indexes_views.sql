BEGIN;
SET LOCAL search_path = divyashilla, pg_catalog;

CREATE FUNCTION guard_order_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Order ID and order number are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.version := OLD.version + 1;
  IF NEW.assigned_delivery_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM divyashilla.users WHERE id = NEW.assigned_delivery_user_id AND role = 'DELIVERY' AND is_active
  ) THEN
    RAISE EXCEPTION 'Assign an active DELIVERY user' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_order_identity BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_identity();

CREATE FUNCTION create_order_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  IF NEW.assigned_delivery_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM divyashilla.users WHERE id = NEW.assigned_delivery_user_id AND role = 'DELIVERY' AND is_active
  ) THEN
    RAISE EXCEPTION 'Assign an active DELIVERY user' USING ERRCODE = '23514';
  END IF;
  INSERT INTO divyashilla.deliveries(order_id, delivery_status, updated_by)
    VALUES (NEW.id, CASE WHEN NEW.order_status = 'READY_FOR_DELIVERY'
      THEN 'READY_FOR_DELIVERY'::divyashilla.delivery_status
      ELSE 'NOT_ASSIGNED'::divyashilla.delivery_status END, NEW.created_by);
  RETURN NEW;
END;
$$;
CREATE TRIGGER create_order_delivery AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION create_order_delivery();

-- Deferred: backend can update both rows in either order inside one transaction.
CREATE FUNCTION check_delivered_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
DECLARE target_id uuid; o divyashilla.order_status; d divyashilla.delivery_status;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN target_id := NEW.id; ELSE target_id := NEW.order_id; END IF;
  SELECT order_status INTO o FROM divyashilla.orders WHERE id = target_id;
  SELECT delivery_status INTO d FROM divyashilla.deliveries WHERE order_id = target_id;
  IF d IS NULL OR ((o = 'DELIVERED') <> (d = 'DELIVERED')) THEN
    RAISE EXCEPTION 'Order and delivery Delivered statuses must agree' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER order_delivered_consistency AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_delivered_consistency();
CREATE CONSTRAINT TRIGGER delivery_delivered_consistency AFTER INSERT OR UPDATE ON deliveries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_delivered_consistency();

CREATE FUNCTION guard_posted_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  -- Only POSTED -> VOID plus void metadata is editable. Correct by void-and-replace.
  IF OLD.status = 'VOID' OR NEW.status <> 'VOID' OR
    (to_jsonb(NEW) - ARRAY['status','void_reason','voided_at','voided_by','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','void_reason','voided_at','voided_by','updated_at']) THEN
    RAISE EXCEPTION 'Posted ledger rows cannot be edited; void with a reason and create a correction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_customer_payment BEFORE UPDATE ON customer_payments FOR EACH ROW EXECUTE FUNCTION guard_posted_ledger();
CREATE TRIGGER immutable_supplier_payment BEFORE UPDATE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION guard_posted_ledger();
CREATE TRIGGER immutable_order_expense BEFORE UPDATE ON order_expenses FOR EACH ROW EXECUTE FUNCTION guard_posted_ledger();

CREATE FUNCTION lock_customer_payment_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  PERFORM 1 FROM divyashilla.orders WHERE id = NEW.order_id FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lock_customer_payment_order BEFORE INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION lock_customer_payment_order();

CREATE FUNCTION check_customer_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
DECLARE target_id uuid; net numeric; price numeric;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN target_id := NEW.id; ELSE target_id := NEW.order_id; END IF;
  SELECT selling_price INTO price FROM divyashilla.orders WHERE id = target_id;
  SELECT coalesce(sum(CASE WHEN direction = 'RECEIPT' THEN amount ELSE -amount END),0)
    INTO net FROM divyashilla.customer_payments WHERE order_id = target_id AND status = 'POSTED';
  IF net < 0 OR net > price THEN
    RAISE EXCEPTION 'Net customer receipts must be between zero and selling price' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER customer_balance AFTER INSERT OR UPDATE ON customer_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_customer_balance();
CREATE CONSTRAINT TRIGGER order_customer_balance AFTER UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_customer_balance();

CREATE FUNCTION lock_allocation_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.supplier_payment_id <> OLD.supplier_payment_id OR NEW.order_id <> OLD.order_id
      OR NEW.supplier_id <> OLD.supplier_id OR NEW.id <> OLD.id) THEN
    RAISE EXCEPTION 'Allocation ownership is immutable; replace the allocation' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN target_id := OLD.supplier_payment_id; ELSE target_id := NEW.supplier_payment_id; END IF;
  PERFORM 1 FROM divyashilla.supplier_payments WHERE id = target_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER lock_allocation_payment BEFORE INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION lock_allocation_payment();

CREATE FUNCTION check_allocation_amount() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
DECLARE target_id uuid; total numeric; available numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD.supplier_payment_id; ELSE target_id := NEW.supplier_payment_id; END IF;
  SELECT amount INTO available FROM divyashilla.supplier_payments WHERE id = target_id;
  SELECT coalesce(sum(amount),0) INTO total FROM divyashilla.supplier_payment_allocations WHERE supplier_payment_id = target_id;
  IF total > available THEN
    RAISE EXCEPTION 'Allocations cannot exceed supplier payment amount' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER allocation_amount AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_allocation_amount();

CREATE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, divyashilla AS $$
BEGIN
  RAISE EXCEPTION 'Activity logs are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_activity_log BEFORE UPDATE OR DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','customers','designs','suppliers','orders',
    'customer_payments','supplier_payments','order_expenses','deliveries','files'] LOOP
    EXECUTE format('CREATE TRIGGER retain_history BEFORE DELETE ON divyashilla.%I FOR EACH ROW EXECUTE FUNCTION divyashilla.reject_delete()', table_name);
  END LOOP;
END;
$$;

-- UNIQUE order_number already creates a B-tree index. Do not create a duplicate.
CREATE INDEX customers_phone_idx ON customers(phone);
CREATE INDEX customers_name_prefix_idx ON customers(lower(name) text_pattern_ops);
CREATE INDEX suppliers_name_prefix_idx ON suppliers(lower(name) text_pattern_ops);
CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX orders_supplier_status_idx ON orders(supplier_id, order_status);
CREATE INDEX orders_status_expected_idx ON orders(order_status, expected_delivery_date);
CREATE INDEX orders_assigned_status_idx ON orders(assigned_delivery_user_id, order_status);
CREATE INDEX orders_order_date_idx ON orders(order_date);
CREATE INDEX orders_design_idx ON orders(design_id);
CREATE INDEX customer_payments_order_status_date_idx ON customer_payments(order_id, status, payment_date);
CREATE INDEX supplier_payments_supplier_status_date_idx ON supplier_payments(supplier_id, status, payment_date);
CREATE INDEX allocations_order_idx ON supplier_payment_allocations(order_id);
CREATE INDEX allocations_supplier_idx ON supplier_payment_allocations(supplier_id);
CREATE INDEX expenses_order_status_idx ON order_expenses(order_id, status);
CREATE INDEX deliveries_status_idx ON deliveries(delivery_status);
CREATE INDEX deliveries_delivered_at_idx ON deliveries(delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX idempotency_expiry_idx ON idempotency_requests(expires_at);
CREATE INDEX activity_entity_date_idx ON activity_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX activity_actor_date_idx ON activity_logs(actor_user_id, created_at DESC);
CREATE INDEX files_order_idx ON files(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX files_design_idx ON files(design_id) WHERE design_id IS NOT NULL;
CREATE INDEX files_customer_payment_idx ON files(customer_payment_id) WHERE customer_payment_id IS NOT NULL;
CREATE INDEX files_supplier_payment_idx ON files(supplier_payment_id) WHERE supplier_payment_id IS NOT NULL;
CREATE INDEX files_expense_idx ON files(expense_id) WHERE expense_id IS NOT NULL;

-- Aggregate each ledger independently: raw joins would multiply money totals.
CREATE VIEW order_financials WITH (security_invoker = true) AS
WITH customer_totals AS (
  SELECT order_id,
    sum(CASE WHEN direction = 'RECEIPT' THEN amount ELSE -amount END) AS customer_net_received,
    sum(CASE WHEN direction = 'RECEIPT' AND purpose = 'ADVANCE' THEN amount ELSE 0 END) AS advance_receipts_recorded
  FROM customer_payments WHERE status = 'POSTED' GROUP BY order_id
), expense_totals AS (
  SELECT order_id,
    sum(CASE WHEN category = 'DELIVERY' THEN amount ELSE 0 END) AS delivery_expense,
    sum(CASE WHEN category = 'OTHER' THEN amount ELSE 0 END) AS other_expense
  FROM order_expenses WHERE status = 'POSTED' GROUP BY order_id
), supplier_totals AS (
  SELECT a.order_id, sum(CASE WHEN p.direction = 'PAYMENT' THEN a.amount ELSE -a.amount END) AS supplier_net_paid
  FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.supplier_payment_id
  WHERE p.status = 'POSTED' GROUP BY a.order_id
)
SELECT o.id AS order_id, o.order_number, o.customer_id, o.supplier_id, o.order_status, o.order_date,
  o.selling_price, o.buying_price, o.advance_amount,
  coalesce(c.advance_receipts_recorded,0) AS advance_receipts_recorded,
  coalesce(c.customer_net_received,0) AS customer_net_received,
  o.selling_price - coalesce(c.customer_net_received,0) AS balance_amount,
  coalesce(e.delivery_expense,0) AS delivery_expense, coalesce(e.other_expense,0) AS other_expense,
  o.selling_price - o.buying_price - coalesce(e.delivery_expense,0) - coalesce(e.other_expense,0) AS profit,
  coalesce(s.supplier_net_paid,0) AS supplier_net_paid,
  o.buying_price - coalesce(s.supplier_net_paid,0) AS supplier_balance_amount,
  d.delivered_at,
  (d.delivered_at AT TIME ZONE 'Asia/Kolkata')::date AS actual_delivery_date
FROM orders o LEFT JOIN customer_totals c ON c.order_id = o.id
LEFT JOIN expense_totals e ON e.order_id = o.id
LEFT JOIN supplier_totals s ON s.order_id = o.id
LEFT JOIN deliveries d ON d.order_id = o.id;

CREATE VIEW supplier_balances WITH (security_invoker = true) AS
WITH liabilities AS (
  SELECT supplier_id, sum(buying_price) AS known_liability,
    count(*) FILTER (WHERE buying_price IS NULL) AS unpriced_orders
  FROM orders WHERE supplier_id IS NOT NULL GROUP BY supplier_id
), payments AS (
  SELECT supplier_id, sum(CASE WHEN direction = 'PAYMENT' THEN amount ELSE -amount END) AS net_paid
  FROM supplier_payments WHERE status = 'POSTED' GROUP BY supplier_id
), allocations AS (
  SELECT a.supplier_id, sum(CASE WHEN p.direction = 'PAYMENT' THEN a.amount ELSE -a.amount END) AS net_allocated
  FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.supplier_payment_id
  WHERE p.status = 'POSTED' GROUP BY a.supplier_id
)
SELECT s.id AS supplier_id, s.name, coalesce(l.known_liability,0) AS known_liability,
  coalesce(l.unpriced_orders,0) AS unpriced_orders, coalesce(p.net_paid,0) AS net_paid,
  coalesce(a.net_allocated,0) AS net_allocated,
  coalesce(p.net_paid,0) - coalesce(a.net_allocated,0) AS unallocated_net_advance,
  coalesce(l.known_liability,0) - coalesce(p.net_paid,0) AS net_position,
  greatest(coalesce(l.known_liability,0) - coalesce(p.net_paid,0),0) AS payable,
  greatest(coalesce(p.net_paid,0) - coalesce(l.known_liability,0),0) AS credit
FROM suppliers s LEFT JOIN liabilities l ON l.supplier_id = s.id
LEFT JOIN payments p ON p.supplier_id = s.id LEFT JOIN allocations a ON a.supplier_id = s.id;

-- SAFE columns only. This view itself is NOT an assignment/role authorization layer.
CREATE VIEW delivery_order_details WITH (security_invoker = true) AS
SELECT o.id AS order_id, o.order_number, o.order_date, o.expected_delivery_date, o.order_status,
  o.assigned_delivery_user_id, o.delivery_name AS customer_name, o.delivery_phone AS customer_phone,
  o.delivery_city AS customer_city, o.delivery_address AS customer_address,
  o.design_number_snapshot AS design_number, o.design_name_snapshot AS design_name,
  o.size_snapshot AS size, o.material_snapshot AS material, o.design_image_file_id,
  o.additional_work, o.version, d.driver_number, d.driver_or_bus_name, d.bus_number,
  d.delivery_status, d.delivered_at, d.updated_by, d.updated_at AS delivery_updated_at
FROM orders o JOIN deliveries d ON d.order_id = o.id;

REVOKE ALL ON ALL TABLES IN SCHEMA divyashilla FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA divyashilla FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA divyashilla FROM PUBLIC;
COMMIT;
