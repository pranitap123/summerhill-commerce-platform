-- Back office and finance (G5): refunds with the liability matrix, disputes, payouts,
-- reconciliation, support issues, staff MFA, merchant lifecycle, catalogue requests for the
-- pipeline, privacy requests, and richer audit entries. Test mode only (PAYMENTS §6–§10).

-- ---- audit log: who, from where (threat T6) ---------------------------------------------------
ALTER TABLE ops.audit_log
  ADD COLUMN ip          text,
  ADD COLUMN user_agent  text CHECK (char_length(user_agent) <= 300);
CREATE INDEX idx_audit_log_at ON ops.audit_log(at DESC);
CREATE INDEX idx_audit_log_actor ON ops.audit_log(actor_id, at DESC);
CREATE INDEX idx_audit_log_action ON ops.audit_log(action, at DESC);

-- ---- merchant lifecycle (G5-02, A1/A2) ----------------------------------------------------------
-- draft → live (go-live gate: charges enabled + a published catalogue) ⇄ paused → offboarding →
-- offboarded. `accepting_orders` stays the switch checkout reads; the lifecycle drives it.
ALTER TABLE merchant.merchants
  ADD COLUMN lifecycle_status     text NOT NULL DEFAULT 'live'
                                  CHECK (lifecycle_status IN ('draft', 'live', 'paused', 'offboarding', 'offboarded')),
  ADD COLUMN lifecycle_reason     text CHECK (char_length(lifecycle_reason) <= 200),
  ADD COLUMN stripe_account_type  text CHECK (stripe_account_type IN ('custom', 'express')),
  ADD COLUMN requirements_due     text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN went_live_at         timestamptz,
  ADD COLUMN offboarded_at        timestamptz;
UPDATE merchant.merchants SET stripe_account_type = 'custom' WHERE stripe_account_id IS NOT NULL;
UPDATE merchant.merchants SET went_live_at = created_at WHERE lifecycle_status = 'live';

-- ---- refunds (G5-04, PAYMENTS §6, ORDERS §9) ----------------------------------------------------
-- merchant_cents is what the merchant bears (transfer reversal), platform_cents what the platform
-- bears; fee_refund_cents the commission given back to the merchant on its share.
ALTER TABLE finance.refunds
  ADD COLUMN scenario                     text NOT NULL DEFAULT 'goodwill' CHECK (scenario IN (
                                            'missing_item', 'wrong_substitute', 'damaged', 'quality',
                                            'price_error', 'goodwill', 'cancellation')),
  ADD COLUMN source                       text NOT NULL DEFAULT 'admin'
                                          CHECK (source IN ('admin', 'support_issue', 'cancellation')),
  ADD COLUMN merchant_cents               bigint NOT NULL DEFAULT 0 CHECK (merchant_cents >= 0),
  ADD COLUMN platform_cents               bigint NOT NULL DEFAULT 0 CHECK (platform_cents >= 0),
  ADD COLUMN fee_refund_cents             bigint CHECK (fee_refund_cents >= 0),
  ADD COLUMN lines                        jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array'),
  ADD COLUMN issue_id                     bigint,
  ADD COLUMN stripe_transfer_reversal_id  text,
  ADD COLUMN failure_reason               text,
  ADD COLUMN succeeded_at                 timestamptz,
  ADD CONSTRAINT refunds_shares_add_up CHECK (merchant_cents + platform_cents = amount_cents),
  ADD CONSTRAINT refunds_liability_matches CHECK (
    (liability = 'merchant' AND platform_cents = 0)
    OR (liability = 'platform' AND merchant_cents = 0)
    OR (liability = 'split' AND merchant_cents > 0 AND platform_cents > 0));
CREATE INDEX idx_refunds_order ON finance.refunds(order_id);
CREATE INDEX idx_refunds_created_by ON finance.refunds(created_by, created_at);

-- ---- disputes (G5-06, PAYMENTS §7) --------------------------------------------------------------
CREATE TABLE finance.disputes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_dispute_id   text NOT NULL UNIQUE,
  payment_id          bigint NOT NULL REFERENCES finance.payments(id),
  order_id            bigint NOT NULL REFERENCES commerce.orders(id),
  amount_cents        bigint NOT NULL CHECK (amount_cents >= 0),
  fee_cents           bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  reason              text NOT NULL,
  -- Stripe's statuses (warning_* for inquiries)
  status              text NOT NULL CHECK (status IN (
                        'warning_needs_response', 'warning_under_review', 'warning_closed',
                        'needs_response', 'under_review', 'won', 'lost')),
  evidence_due_by     timestamptz,
  evidence            jsonb,
  evidence_built_at   timestamptz,
  submitted_at        timestamptz,
  submitted_by        text,
  -- Who ends up paying, per the liability matrix (ORDERS §9)
  liability           text CHECK (liability IN ('merchant', 'platform')),
  recovered_cents     bigint NOT NULL DEFAULT 0 CHECK (recovered_cents >= 0),
  reinstated_cents    bigint NOT NULL DEFAULT 0 CHECK (reinstated_cents >= 0),
  alerted_72h_at      timestamptz,
  alerted_24h_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz
);
CREATE INDEX idx_disputes_due ON finance.disputes(evidence_due_by) WHERE status IN ('needs_response', 'warning_needs_response');
CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON finance.disputes
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- ---- payouts (G5-07, PAYMENTS §8) ---------------------------------------------------------------
CREATE TABLE finance.payouts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id       bigint NOT NULL REFERENCES merchant.merchants(id),
  stripe_payout_id  text UNIQUE,
  method            text NOT NULL CHECK (method IN ('manual', 'automatic')),
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  currency          char(3) NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  status            text NOT NULL CHECK (status IN (
                      'pending_approval', 'rejected', 'requested', 'pending', 'in_transit', 'paid',
                      'failed', 'canceled')),
  reason            text CHECK (char_length(reason) <= 200),
  requested_by      text,
  approved_by       text,
  approved_at       timestamptz,
  arrival_date      date,
  failure_code      text,
  failure_message   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Four eyes: nobody approves their own payout (threat T6)
  CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM requested_by)
);
CREATE INDEX idx_payouts_merchant ON finance.payouts(merchant_id, created_at DESC);
CREATE TRIGGER trg_payouts_updated_at BEFORE UPDATE ON finance.payouts
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- ---- reconciliation (G5-05, PAYMENTS §10) -------------------------------------------------------
CREATE TABLE finance.recon_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The business day reconciled (America/Toronto); one run per day and trigger
  run_date     date NOT NULL,
  trigger      text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'clean', 'mismatches', 'failed')),
  matched      integer NOT NULL DEFAULT 0,
  mismatches   integer NOT NULL DEFAULT 0,
  summary      jsonb NOT NULL DEFAULT '{}',
  error        text,
  requested_by text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE UNIQUE INDEX uq_recon_runs_scheduled ON finance.recon_runs(run_date) WHERE trigger = 'schedule';

CREATE TABLE finance.recon_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      bigint NOT NULL REFERENCES finance.recon_runs(id) ON DELETE CASCADE,
  -- balance transactions that didn't match, or an invariant that failed
  kind        text NOT NULL CHECK (kind IN ('unmatched_stripe', 'missing_in_stripe', 'amount_mismatch', 'invariant')),
  check_name  text NOT NULL,
  order_id    bigint REFERENCES commerce.orders(id),
  reference   text,
  expected    bigint,
  actual      bigint,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_items_run ON finance.recon_items(run_id);

-- ---- support issues (G5-11, ORDERS §10) --------------------------------------------------------
CREATE TABLE commerce.support_issues (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        bigint NOT NULL REFERENCES commerce.orders(id),
  type            text NOT NULL CHECK (type IN ('missing', 'damaged', 'wrong_item', 'quality', 'other')),
  -- [{"lineId": 12, "quantity": 1}] (quantity null = the whole line)
  lines           jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array'),
  description     text CHECK (char_length(description) <= 1000),
  claimed_cents   bigint NOT NULL CHECK (claimed_cents >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'auto_approved', 'approved', 'rejected')),
  -- The policy engine's answer and why (auditable)
  decision        jsonb NOT NULL DEFAULT '{}',
  liability       text CHECK (liability IN ('merchant', 'platform', 'customer')),
  refund_id       bigint REFERENCES finance.refunds(id),
  resolution_note text CHECK (char_length(resolution_note) <= 500),
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_issues_status ON commerce.support_issues(status, created_at);
CREATE INDEX idx_support_issues_order ON commerce.support_issues(order_id);
CREATE TRIGGER trg_support_issues_updated_at BEFORE UPDATE ON commerce.support_issues
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
ALTER TABLE finance.refunds
  ADD CONSTRAINT refunds_issue_fk FOREIGN KEY (issue_id) REFERENCES commerce.support_issues(id);

-- ---- staff MFA (G5-12, threat T2) --------------------------------------------------------------
-- TOTP secrets encrypted with a key derived from the app secret (AES-256-GCM); never returned by
-- any API after enrolment. last_step blocks replaying a code inside its 30-second window.
CREATE TABLE ops.staff_mfa (
  user_id           text PRIMARY KEY,
  secret_encrypted  text NOT NULL,
  confirmed_at      timestamptz,
  last_step         bigint,
  failures          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_staff_mfa_updated_at BEFORE UPDATE ON ops.staff_mfa
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- ---- catalogue admin (G5-14, A3): requests the pipeline carries out ----------------------------
-- The app can't write catalog.products (ADR-0004), so approving a held run or asking for a re-run
-- is a request row; the pipeline (Dagster sensor or `process-requests`) applies it as ingest_rw.
CREATE TABLE ops.ingest_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id   bigint NOT NULL REFERENCES merchant.merchants(id),
  kind          text NOT NULL CHECK (kind IN ('approve', 'run')),
  run_id        bigint REFERENCES ops.ingest_runs(id),
  mode          text CHECK (mode IN ('full', 'delta')),
  requested_by  text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  result        jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  CHECK ((kind = 'approve') = (run_id IS NOT NULL)),
  CHECK ((kind = 'run') = (mode IS NOT NULL))
);
CREATE INDEX idx_ingest_requests_pending ON ops.ingest_requests(id) WHERE status = 'pending';
-- One open request per held run
CREATE UNIQUE INDEX uq_ingest_requests_open_run ON ops.ingest_requests(run_id) WHERE status = 'pending';

-- ---- privacy requests (G5-17, SECURITY §7.3) ---------------------------------------------------
-- A record that a request was handled, without the personal data itself.
CREATE TABLE ops.privacy_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('export', 'deletion')),
  subject_hash    text NOT NULL,
  requested_by    text NOT NULL,
  summary         jsonb NOT NULL DEFAULT '{}',
  completed_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- feature flags (G5-10, A13) ---------------------------------------------------------------
INSERT INTO ops.feature_flags (key, enabled, description) VALUES
  ('support.auto_refund', true, 'Support issues within the thresholds are refunded automatically'),
  ('delivery.enabled', false, 'Delivery orders (v1.1; pickup only in v1, ADR-0010)')
ON CONFLICT (key) DO NOTHING;

-- ---- grants -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- Append-only like the rest of the money trail
    REVOKE DELETE, TRUNCATE ON finance.refunds, finance.disputes, finance.payouts FROM app_rw;
    REVOKE UPDATE, DELETE, TRUNCATE ON ops.privacy_requests FROM app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest_rw') THEN
    GRANT SELECT, UPDATE ON ops.ingest_requests TO ingest_rw;
  END IF;
END;
$$;

-- ---- payment simulator (G4-18) models the back-office objects too ------------------------------
ALTER TABLE ops.payment_simulator DROP CONSTRAINT payment_simulator_kind_check;
ALTER TABLE ops.payment_simulator ADD CONSTRAINT payment_simulator_kind_check CHECK (kind IN (
  'checkout_session', 'payment_intent', 'idempotency_key', 'account', 'refund', 'payout',
  'balance_transaction', 'dispute'));
CREATE INDEX idx_payment_simulator_kind ON ops.payment_simulator(kind, created_at);
