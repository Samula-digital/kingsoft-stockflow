BEGIN;

CREATE TABLE IF NOT EXISTS app_configuration (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state_version INTEGER NOT NULL DEFAULT 1,
  product_name TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  brand_logo_url TEXT NOT NULL DEFAULT '',
  brand_accent_color VARCHAR(7) NOT NULL DEFAULT '#1f3b63',
  brand_sidebar_color VARCHAR(7) NOT NULL DEFAULT '#1f3b63',
  finance_email TEXT NOT NULL DEFAULT '',
  as_of_date DATE NOT NULL,
  next_requisition_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  requisition_start_number INTEGER NOT NULL DEFAULT 1,
  is_main_store BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  uom TEXT NOT NULL,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14, 2) NULL,
  selling_price NUMERIC(14, 2) NULL,
  min_stock NUMERIC(14, 2) NULL,
  max_stock NUMERIC(14, 2) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NULL
);

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_name_key;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'store', 'finance')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ NULL,
  approved_by TEXT NOT NULL DEFAULT '',
  last_signed_in_at TIMESTAMPTZ NULL,
  force_password_reset BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  movement_date DATE NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'ADJ')),
  department_id TEXT NOT NULL REFERENCES departments(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity NUMERIC(14, 2) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14, 2) NULL,
  adjustment_mode TEXT NOT NULL DEFAULT 'INCREASE' CHECK (adjustment_mode IN ('INCREASE', 'DECREASE')),
  requisition_number TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_file TEXT NOT NULL DEFAULT '',
  source_sheet TEXT NOT NULL DEFAULT '',
  source_row INTEGER NULL,
  workbook_category TEXT NOT NULL DEFAULT '',
  department_mapping_version TEXT NOT NULL DEFAULT '',
  import_signature TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TIMESTAMPTZ NULL,
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS movement_audit_events (
  id BIGSERIAL PRIMARY KEY,
  movement_id TEXT NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  event_order INTEGER NOT NULL,
  action TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  event_by TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  UNIQUE (movement_id, event_order)
);

CREATE TABLE IF NOT EXISTS movement_audit_changes (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES movement_audit_events(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  before_value TEXT NOT NULL DEFAULT '',
  after_value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_departments_active ON departments (is_active);
CREATE INDEX IF NOT EXISTS idx_items_active ON items (is_active);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_name_uom ON items (LOWER(name), LOWER(uom));
CREATE INDEX IF NOT EXISTS idx_movements_date ON movements (movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_movements_item_date ON movements (item_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_movements_department_date ON movements (department_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_movements_type_date ON movements (movement_type, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_movements_deleted_at ON movements (deleted_at);
CREATE INDEX IF NOT EXISTS idx_movements_import_signature ON movements (import_signature);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_movement_audit_events_movement_id ON movement_audit_events (movement_id, event_order);
CREATE INDEX IF NOT EXISTS idx_movement_audit_changes_event_id ON movement_audit_changes (event_id);

COMMIT;
