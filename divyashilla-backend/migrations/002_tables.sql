BEGIN;
SET LOCAL search_path = divyashilla, pg_catalog;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  username TEXT NOT NULL CHECK (username ~ '^[a-zA-Z0-9_.-]{3,64}$'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) >= 32),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  phone TEXT NOT NULL CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  city TEXT NOT NULL CHECK (btrim(city) <> ''),
  address TEXT, notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_number TEXT NOT NULL UNIQUE CHECK (btrim(design_number) <> ''),
  design_name TEXT NOT NULL CHECK (btrim(design_name) <> ''),
  size TEXT NOT NULL CHECK (btrim(size) <> ''),
  material TEXT NOT NULL CHECK (btrim(material) <> ''),
  image_file_id UUID,
  notes TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  phone TEXT NOT NULL CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  city TEXT, address TEXT, notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001 INCREMENT BY 1 NO CYCLE) UNIQUE,
  order_date DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
  expected_delivery_date DATE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  design_id UUID NOT NULL REFERENCES designs(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  additional_work TEXT,
  buying_price money_amount,
  selling_price money_amount NOT NULL,
  -- Agreed target only. Actual advance receipts live in customer_payments.
  advance_amount money_amount NOT NULL DEFAULT 0,
  order_status order_status NOT NULL DEFAULT 'NEW',
  assigned_delivery_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  delivery_name TEXT NOT NULL CHECK (btrim(delivery_name) <> ''),
  delivery_phone TEXT NOT NULL CHECK (delivery_phone ~ '^\+?[0-9]{7,15}$'),
  delivery_city TEXT NOT NULL CHECK (btrim(delivery_city) <> ''),
  delivery_address TEXT,
  design_number_snapshot TEXT NOT NULL CHECK (btrim(design_number_snapshot) <> ''),
  design_name_snapshot TEXT NOT NULL CHECK (btrim(design_name_snapshot) <> ''),
  size_snapshot TEXT NOT NULL CHECK (btrim(size_snapshot) <> ''),
  material_snapshot TEXT NOT NULL CHECK (btrim(material_snapshot) <> ''),
  design_image_file_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, supplier_id),
  CHECK (order_number >= 1001),
  CHECK (advance_amount <= selling_price),
  CHECK (expected_delivery_date IS NULL OR expected_delivery_date >= order_date),
  CHECK (order_status IN ('NEW', 'CANCELLED') OR (supplier_id IS NOT NULL AND buying_price IS NOT NULL))
);

CREATE TABLE customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount money_amount NOT NULL CHECK (amount > 0),
  direction customer_payment_direction NOT NULL DEFAULT 'RECEIPT',
  purpose payment_purpose,
  payment_date DATE NOT NULL,
  payment_method payment_method NOT NULL,
  note TEXT,
  received_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  processed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status ledger_status NOT NULL DEFAULT 'POSTED',
  void_reason TEXT, voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((direction = 'RECEIPT' AND purpose IS NOT NULL AND received_by IS NOT NULL)
     OR (direction = 'REFUND' AND purpose IS NULL AND received_by IS NULL)),
  CHECK ((status = 'POSTED' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL)
     OR (status = 'VOID' AND btrim(void_reason) <> '' AND void_reason IS NOT NULL
       AND voided_at IS NOT NULL AND voided_by IS NOT NULL))
);

CREATE TABLE supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount money_amount NOT NULL CHECK (amount > 0),
  direction supplier_payment_direction NOT NULL DEFAULT 'PAYMENT',
  payment_date DATE NOT NULL,
  payment_method payment_method NOT NULL,
  note TEXT,
  paid_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  processed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status ledger_status NOT NULL DEFAULT 'POSTED',
  void_reason TEXT, voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, supplier_id),
  CHECK ((direction = 'PAYMENT' AND paid_by IS NOT NULL)
     OR (direction = 'REFUND' AND paid_by IS NULL)),
  CHECK ((status = 'POSTED' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL)
     OR (status = 'VOID' AND void_reason IS NOT NULL AND btrim(void_reason) <> ''
       AND voided_at IS NOT NULL AND voided_by IS NOT NULL))
);

CREATE TABLE supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id UUID NOT NULL,
  order_id UUID NOT NULL,
  -- Composite foreign keys guarantee that order and payment use the same supplier.
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount money_amount NOT NULL CHECK (amount > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (supplier_payment_id, order_id),
  FOREIGN KEY (supplier_payment_id, supplier_id) REFERENCES supplier_payments(id, supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, supplier_id) REFERENCES orders(id, supplier_id) ON DELETE RESTRICT
);

CREATE TABLE order_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  category expense_category NOT NULL,
  amount money_amount NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  note TEXT,
  status ledger_status NOT NULL DEFAULT 'POSTED',
  void_reason TEXT, voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'POSTED' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL)
     OR (status = 'VOID' AND void_reason IS NOT NULL AND btrim(void_reason) <> ''
       AND voided_at IS NOT NULL AND voided_by IS NOT NULL))
);

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  driver_number TEXT CHECK (driver_number IS NULL OR driver_number ~ '^\+?[0-9]{7,15}$'),
  driver_or_bus_name TEXT CHECK (driver_or_bus_name IS NULL OR btrim(driver_or_bus_name) <> ''),
  bus_number TEXT CHECK (bus_number IS NULL OR btrim(bus_number) <> ''),
  delivery_status delivery_status NOT NULL DEFAULT 'NOT_ASSIGNED',
  delivered_at TIMESTAMPTZ,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (delivery_status NOT IN ('SENT', 'DELIVERED')
      OR (driver_number IS NOT NULL AND driver_or_bus_name IS NOT NULL)),
  CHECK ((delivery_status = 'DELIVERED') = (delivered_at IS NOT NULL))
);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_key TEXT NOT NULL UNIQUE CHECK (btrim(blob_key) <> ''),
  original_name TEXT NOT NULL CHECK (btrim(original_name) <> ''),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  category file_category NOT NULL,
  state file_state NOT NULL DEFAULT 'PENDING',
  order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  design_id UUID REFERENCES designs(id) ON DELETE RESTRICT,
  customer_payment_id UUID REFERENCES customer_payments(id) ON DELETE RESTRICT,
  supplier_payment_id UUID REFERENCES supplier_payments(id) ON DELETE RESTRICT,
  expense_id UUID REFERENCES order_expenses(id) ON DELETE RESTRICT,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(order_id, design_id, customer_payment_id, supplier_payment_id, expense_id) = 1),
  CHECK ((category = 'DESIGN_IMAGE' AND design_id IS NOT NULL)
    OR (category IN ('ORDER_PRODUCT_IMAGE', 'ORDER_DOCUMENT') AND order_id IS NOT NULL)
    OR (category = 'CUSTOMER_PAYMENT_DOCUMENT' AND customer_payment_id IS NOT NULL)
    OR (category = 'SUPPLIER_PAYMENT_DOCUMENT' AND supplier_payment_id IS NOT NULL)
    OR (category = 'EXPENSE_DOCUMENT' AND expense_id IS NOT NULL)),
  CHECK (category NOT IN ('DESIGN_IMAGE', 'ORDER_PRODUCT_IMAGE') OR mime_type LIKE 'image/%')
);
ALTER TABLE designs ADD CONSTRAINT designs_image_file_fk FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD CONSTRAINT orders_design_image_file_fk FOREIGN KEY (design_image_file_id) REFERENCES files(id) ON DELETE RESTRICT;

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (btrim(action) <> ''),
  entity_type TEXT NOT NULL CHECK (btrim(entity_type) <> ''),
  entity_id UUID,
  before_data JSONB, after_data JSONB,
  reason TEXT, request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (updated_at = created_at)
);

CREATE TABLE idempotency_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (btrim(operation) <> ''),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) >= 32),
  resource_id UUID, result JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, operation, key),
  CHECK (expires_at > created_at)
);

-- One automatic timestamp trigger per table. Audit rows are immutable instead.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','sessions','customers','designs','suppliers','orders',
    'customer_payments','supplier_payments','supplier_payment_allocations','order_expenses',
    'deliveries','files','idempotency_requests']
  LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON divyashilla.%I FOR EACH ROW EXECUTE FUNCTION divyashilla.touch_updated_at()', table_name);
  END LOOP;
END;
$$;
COMMIT;
