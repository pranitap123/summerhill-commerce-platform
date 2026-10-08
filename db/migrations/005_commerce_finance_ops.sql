

CREATE TABLE finance.fee_schedules (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id         bigint REFERENCES merchant.merchants(id),
  mode                text NOT NULL CHECK (mode IN ('flat', 'marginal')),

  tiers               jsonb NOT NULL CHECK (jsonb_typeof(tiers) = 'array' AND jsonb_array_length(tiers) > 0),
  hst_on_commission   boolean NOT NULL DEFAULT false,
  effective_from      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fee_schedules_lookup ON finance.fee_schedules(merchant_id, effective_from DESC);

INSERT INTO finance.fee_schedules (merchant_id, mode, tiers, effective_from) VALUES (
  NULL, 'flat',
  '[{"minCents": 10001, "rateBp": 1000}, {"minCents": 5000, "rateBp": 1500}, {"minCents": 0, "rateBp": 2000}]',
  '2026-01-01T00:00:00Z'
);

CREATE TABLE commerce.carts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text,
  merchant_id     bigint REFERENCES merchant.merchants(id),
  location_id     bigint REFERENCES merchant.locations(id),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'saved', 'merged', 'converted', 'expired')),
  last_quote_hash text,
  last_quoted_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((merchant_id IS NULL) = (location_id IS NULL))
);

CREATE UNIQUE INDEX uq_carts_active_user ON commerce.carts(user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX idx_carts_updated_at ON commerce.carts(updated_at) WHERE status = 'active';

CREATE TABLE commerce.cart_items (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cart_id                 uuid NOT NULL REFERENCES commerce.carts(id) ON DELETE CASCADE,
  product_id              text NOT NULL REFERENCES catalog.products(id),
  quantity                integer CHECK (quantity BETWEEN 1 AND 99),
  requested_weight_lb     numeric(7, 3) CHECK (requested_weight_lb > 0 AND requested_weight_lb <= 50),
  replacement_preference  text NOT NULL DEFAULT 'best_match' CHECK (replacement_preference IN ('best_match', 'specific', 'refund')),
  replacement_product_ids text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(replacement_product_ids) <= 3),
  note                    text CHECK (char_length(note) <= 140),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id),

  CHECK ((quantity IS NULL) <> (requested_weight_lb IS NULL))
);

CREATE TABLE commerce.orders (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  public_id                   text NOT NULL UNIQUE CHECK (public_id ~ '^SH-[0-9A-Z]{6}$'),
  status                      text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                                'pending_payment', 'placed', 'abandoned', 'accepted', 'picking', 'picked',
                                'ready', 'payment_issue', 'collected', 'no_show', 'cancelled')),
  merchant_id                 bigint NOT NULL REFERENCES merchant.merchants(id),
  location_id                 bigint NOT NULL REFERENCES merchant.locations(id),
  cart_id                     uuid REFERENCES commerce.carts(id),
  user_id                     text,
  email                       text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  pickup_name                 text CHECK (char_length(pickup_name) <= 100),
  currency                    char(3) NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),

  item_subtotal_cents         bigint NOT NULL CHECK (item_subtotal_cents >= 0),
  deposit_cents               bigint NOT NULL CHECK (deposit_cents >= 0),
  tax_cents                   bigint NOT NULL CHECK (tax_cents >= 0),
  estimated_total_cents       bigint NOT NULL CHECK (estimated_total_cents >= 0),
  weight_buffer_cents         bigint NOT NULL CHECK (weight_buffer_cents >= 0),
  authorization_cents         bigint NOT NULL CHECK (authorization_cents >= 0),

  final_item_subtotal_cents   bigint CHECK (final_item_subtotal_cents >= 0),
  final_deposit_cents         bigint CHECK (final_deposit_cents >= 0),
  final_tax_cents             bigint CHECK (final_tax_cents >= 0),
  final_total_cents           bigint CHECK (final_total_cents >= 0),

  fee_schedule_id             bigint NOT NULL REFERENCES finance.fee_schedules(id),
  fee_estimate_cents          bigint NOT NULL CHECK (fee_estimate_cents >= 0),
  fee_final_cents             bigint CHECK (fee_final_cents >= 0),
  quote_hash                  text NOT NULL,

  access_version              integer NOT NULL DEFAULT 1,
  refund_status               text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'partial', 'full')),
  placed_at                   timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (estimated_total_cents = item_subtotal_cents + deposit_cents + tax_cents),
  CHECK (authorization_cents = estimated_total_cents + weight_buffer_cents),
  CHECK (final_total_cents IS NULL OR final_total_cents = final_item_subtotal_cents + final_deposit_cents + final_tax_cents)
);
CREATE INDEX idx_orders_user_id ON commerce.orders(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_orders_status ON commerce.orders(status, created_at);
CREATE INDEX idx_orders_email ON commerce.orders(lower(email));
CREATE UNIQUE INDEX uq_orders_cart_pending ON commerce.orders(cart_id) WHERE status = 'pending_payment';

CREATE TABLE commerce.order_lines (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id                  bigint NOT NULL REFERENCES commerce.orders(id),
  line_no                   integer NOT NULL CHECK (line_no > 0),

  product_id                text NOT NULL,
  name                      text NOT NULL,
  pricing_model             text NOT NULL CHECK (pricing_model IN ('each', 'per_weight')),
  sell_by                   text NOT NULL CHECK (sell_by IN ('quantity', 'weight')),
  unit                      text NOT NULL CHECK (unit IN ('ea', 'lb')),
  regular_unit_price_cents  bigint NOT NULL CHECK (regular_unit_price_cents >= 0),
  unit_price_cents          bigint NOT NULL CHECK (unit_price_cents >= 0),
  promo_label               text,
  quantity                  integer CHECK (quantity > 0),
  requested_weight_lb       numeric(7, 3) CHECK (requested_weight_lb > 0),
  estimated_weight_lb       numeric(8, 3) CHECK (estimated_weight_lb > 0),
  is_weighed                boolean NOT NULL,
  tax_code                  text NOT NULL CHECK (tax_code IN ('ZERO_RATED', 'HST_STANDARD')),
  tax_rate_bp               integer NOT NULL CHECK (tax_rate_bp >= 0),
  line_total_cents          bigint NOT NULL CHECK (line_total_cents >= 0),
  tax_cents                 bigint NOT NULL CHECK (tax_cents >= 0),
  deposit_cents             bigint NOT NULL CHECK (deposit_cents >= 0),
  replacement_preference    text NOT NULL CHECK (replacement_preference IN ('best_match', 'specific', 'refund')),
  replacement_product_ids   text[] NOT NULL DEFAULT ARRAY[]::text[],
  note                      text,

  status                    text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'picked', 'unavailable', 'substituted')),
  substitutes_line_id       bigint REFERENCES commerce.order_lines(id),
  picked_quantity           integer CHECK (picked_quantity >= 0),
  actual_weight_lb          numeric(8, 3) CHECK (actual_weight_lb >= 0),
  final_line_total_cents    bigint CHECK (final_line_total_cents >= 0),
  final_tax_cents           bigint CHECK (final_tax_cents >= 0),
  final_deposit_cents       bigint CHECK (final_deposit_cents >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_no)
);

CREATE TABLE commerce.order_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES commerce.orders(id),
  type         text NOT NULL,
  from_status  text,
  to_status    text,
  actor_type   text NOT NULL CHECK (actor_type IN ('customer', 'merchant_staff', 'admin', 'system', 'stripe')),
  actor_id     text,
  reason       text,
  data         jsonb NOT NULL DEFAULT '{}',
  request_id   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_events_order ON commerce.order_events(order_id, id);

CREATE TABLE finance.payments (
  id                                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id                          bigint NOT NULL REFERENCES commerce.orders(id),
  provider                          text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  checkout_session_id               text UNIQUE,
  checkout_url                      text,
  payment_intent_id                 text UNIQUE,
  charge_id                         text,
  status                            text NOT NULL DEFAULT 'pending' CHECK (status IN (
                                      'pending', 'requires_capture', 'captured', 'canceled', 'expired', 'failed')),
  currency                          char(3) NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  amount_authorized_cents           bigint CHECK (amount_authorized_cents >= 0),
  amount_captured_cents             bigint CHECK (amount_captured_cents >= 0),
  application_fee_cents             bigint CHECK (application_fee_cents >= 0),
  processing_fee_cents              bigint CHECK (processing_fee_cents >= 0),

  capture_before                    timestamptz,
  overcapture_status                text,
  overcapture_maximum_cents         bigint CHECK (overcapture_maximum_cents >= 0),
  incremental_authorization_status  text,
  extended_authorization_status     text,
  capture_attempts                  integer NOT NULL DEFAULT 0,
  last_error                        text,
  auth_expiry_alerted_at            timestamptz,
  authorized_at                     timestamptz,
  captured_at                       timestamptz,
  canceled_at                       timestamptz,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_order ON finance.payments(order_id);
CREATE INDEX idx_payments_capture_before ON finance.payments(capture_before) WHERE status = 'requires_capture';

CREATE TABLE finance.refunds (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id              bigint NOT NULL REFERENCES finance.payments(id),
  order_id                bigint NOT NULL REFERENCES commerce.orders(id),
  amount_cents            bigint NOT NULL CHECK (amount_cents > 0),
  liability               text NOT NULL CHECK (liability IN ('merchant', 'platform', 'split')),
  reverse_transfer        boolean NOT NULL,
  refund_application_fee  boolean NOT NULL,
  allocation              jsonb,
  reason                  text NOT NULL,
  stripe_refund_id        text UNIQUE,
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  created_by              text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.transfers (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id          bigint NOT NULL REFERENCES finance.payments(id),
  order_id            bigint NOT NULL REFERENCES commerce.orders(id),
  merchant_id         bigint NOT NULL REFERENCES merchant.merchants(id),
  stripe_transfer_id  text UNIQUE,
  amount_cents        bigint NOT NULL CHECK (amount_cents >= 0),
  status              text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'reversed', 'partially_reversed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.ledger_journals (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key  text NOT NULL UNIQUE,
  event            text NOT NULL,
  order_id         bigint REFERENCES commerce.orders(id),
  external_ref     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.ledger_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id    bigint NOT NULL REFERENCES finance.ledger_journals(id),
  order_id      bigint REFERENCES commerce.orders(id),
  account       text NOT NULL CHECK (account ~ '^(stripe_clearing|merchant_payable:[0-9]+|platform_fee_revenue|hst_on_commission_payable|processing_fee_expense|refund_expense_platform|dispute_expense)$'),
  debit_cents   bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents  bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  currency      char(3) NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX idx_ledger_entries_journal ON finance.ledger_entries(journal_id);
CREATE INDEX idx_ledger_entries_order ON finance.ledger_entries(order_id);
CREATE INDEX idx_ledger_entries_account ON finance.ledger_entries(account);

CREATE OR REPLACE FUNCTION finance.assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  diff bigint;
BEGIN
  SELECT COALESCE(sum(debit_cents), 0) - COALESCE(sum(credit_cents), 0) INTO diff
  FROM finance.ledger_entries WHERE journal_id = NEW.journal_id;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'ledger journal % is unbalanced by % cents', NEW.journal_id, diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON finance.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance.assert_journal_balanced();

CREATE TABLE ops.webhook_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id         text NOT NULL UNIQUE,
  source           text NOT NULL CHECK (source IN ('platform', 'connect')),
  type             text NOT NULL,
  account          text,
  livemode         boolean NOT NULL,
  api_version      text,
  stripe_created_at timestamptz NOT NULL,
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX idx_webhook_events_status ON ops.webhook_events(status, received_at);

CREATE TABLE ops.idempotency_keys (
  scope            text NOT NULL,
  key              text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 255),
  request_hash     text NOT NULL,
  status           text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX idx_idempotency_keys_expires ON ops.idempotency_keys(expires_at);

CREATE TABLE ops.outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  topic         text NOT NULL,
  key           text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX idx_outbox_unpublished ON ops.outbox(id) WHERE published_at IS NULL;

CREATE TABLE ops.jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue         text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  dedupe_key    text,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'dead')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_at        timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (queue, dedupe_key)
);
CREATE INDEX idx_jobs_ready ON ops.jobs(queue, run_at) WHERE status = 'queued';
CREATE INDEX idx_jobs_running ON ops.jobs(locked_at) WHERE status = 'running';

CREATE TABLE ops.processed_events (
  consumer      text NOT NULL,
  event_id      uuid NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE ops.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type   text NOT NULL CHECK (actor_type IN ('customer', 'merchant_staff', 'admin', 'system', 'stripe')),
  actor_id     text,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text,
  data         jsonb NOT NULL DEFAULT '{}',
  request_id   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_target ON ops.audit_log(target_type, target_id, at);

CREATE TABLE ops.feature_flags (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  enabled      boolean NOT NULL,
  description  text NOT NULL,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ops.feature_flags (key, enabled, description) VALUES
  ('checkout.enabled', true, 'Kill switch: new checkouts are refused when off'),
  ('email.enabled', true, 'Transactional email; when off, notifications are logged as skipped');

CREATE TABLE ops.notifications (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key       text NOT NULL UNIQUE,
  template         text NOT NULL,
  template_version integer NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('email')),
  recipient_hash   text NOT NULL,
  order_id         bigint REFERENCES commerce.orders(id),
  subject          text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_id      text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE TABLE ops.rate_limits (
  bucket        text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE ops.alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  dedupe_key  text NOT NULL UNIQUE,
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message     text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON commerce.carts FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON commerce.cart_items FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON commerce.orders FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_order_lines_updated_at BEFORE UPDATE ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON finance.payments FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON finance.refunds FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON finance.transfers FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON finance.ledger_journals, finance.ledger_entries FROM app_rw;
    REVOKE UPDATE, DELETE, TRUNCATE ON commerce.order_events, ops.audit_log FROM app_rw;
    GRANT EXECUTE ON FUNCTION finance.assert_journal_balanced() TO app_rw;
  END IF;
END;
$$;
