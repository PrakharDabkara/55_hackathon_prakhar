-- Up Migration
CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  role       text NOT NULL CHECK (role IN ('seeker', 'shop', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  -- Plain code for the demo inbox. Written only when OTP_MODE=simulated; drop with real SMS.
  dev_code    text,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_phone_created ON otp_codes (phone, created_at DESC);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user ON sessions (user_id);

-- One shop per owner for now. Nullable so rows from before this migration stay valid.
ALTER TABLE shops
  ADD COLUMN owner_user_id uuid UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  ALTER COLUMN categories DROP DEFAULT;

-- Keep the list in step with CATEGORIES in packages/shared. NOT VALID: old rows are not re-checked.
ALTER TABLE shops
  ADD CONSTRAINT shops_categories_valid CHECK (
    cardinality(categories) BETWEEN 1 AND 2
    AND categories <@ ARRAY[
      'grocery', 'hardware', 'electrical', 'stationery',
      'mobile_accessories', 'household_kitchen', 'personal_care', 'general_store'
    ]::text[]
  ) NOT VALID;

-- Down Migration
ALTER TABLE shops
  DROP CONSTRAINT shops_categories_valid,
  DROP COLUMN owner_user_id,
  ALTER COLUMN categories SET DEFAULT '{}';
DROP TABLE sessions;
DROP TABLE otp_codes;
DROP TABLE users;
