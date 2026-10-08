

CREATE TABLE ops.payment_simulator (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('checkout_session', 'payment_intent', 'idempotency_key')),
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payment_simulator_updated_at BEFORE UPDATE ON ops.payment_simulator
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
