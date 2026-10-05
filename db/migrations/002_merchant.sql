-- Merchants (legal entity, Stripe connected account) and their store locations (G1-04).
-- Folds in the former db/migrations/004_add_merchants.sql. No merchant rows are seeded here:
-- demo data comes from db/seed (synthetic), never from migrations.

CREATE TABLE merchant.merchants (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                      text NOT NULL,
  stripe_account_id         text UNIQUE,
  onboarding_status         text NOT NULL DEFAULT 'pending'
                            CHECK (onboarding_status IN ('pending', 'submitted', 'verified', 'failed', 'restricted')),
  charges_enabled           boolean NOT NULL DEFAULT false,
  payouts_enabled           boolean NOT NULL DEFAULT false,
  disabled_reason           text,
  payout_schedule_interval  text NOT NULL DEFAULT 'manual'
                            CHECK (payout_schedule_interval IN ('manual', 'daily', 'weekly', 'monthly')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchant.locations (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id           bigint NOT NULL REFERENCES merchant.merchants(id),
  slug                  text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                  text NOT NULL,
  -- The upstream catalogue is requested per store (the API's LOCATION_ID); null for synthetic data.
  external_location_id  text,
  address_line1         text,
  city                  text,
  province              char(2),
  postal_code           text,
  timezone              text NOT NULL DEFAULT 'America/Toronto',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, slug)
);

CREATE INDEX idx_locations_merchant_id ON merchant.locations(merchant_id);

CREATE TRIGGER trg_merchants_updated_at BEFORE UPDATE ON merchant.merchants
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON merchant.locations
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
