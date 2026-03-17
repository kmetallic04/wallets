BEGIN;

-- ============================================================
-- 1. Custom enum types
-- ============================================================

CREATE TYPE transaction_type   AS ENUM ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE entry_type         AS ENUM ('DEBIT', 'CREDIT');

-- ============================================================
-- 2. better-auth core tables
-- ============================================================

CREATE TABLE "user" (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    image           TEXT,
    role            TEXT DEFAULT 'user',
    banned          BOOLEAN,
    ban_reason      TEXT,
    ban_expires     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "session" (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    impersonated_by TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "account" (
    id                        TEXT PRIMARY KEY,
    user_id                   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    account_id                TEXT NOT NULL,
    provider_id               TEXT NOT NULL,
    access_token              TEXT,
    refresh_token             TEXT,
    access_token_expires_at   TIMESTAMPTZ,
    refresh_token_expires_at  TIMESTAMPTZ,
    scope                     TEXT,
    id_token                  TEXT,
    password                  TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "verification" (
    id              TEXT PRIMARY KEY,
    identifier      TEXT NOT NULL,
    value           TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. better-auth API Key plugin table
-- ============================================================

CREATE TABLE "apikey" (
    id                      TEXT PRIMARY KEY,
    config_id               TEXT NOT NULL DEFAULT 'default',
    name                    TEXT,
    start                   TEXT,
    prefix                  TEXT,
    key                     TEXT NOT NULL,
    reference_id            TEXT NOT NULL,
    refill_interval         INTEGER,
    refill_amount           INTEGER,
    last_refill_at          TIMESTAMPTZ,
    enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
    rate_limit_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    rate_limit_time_window  INTEGER,
    rate_limit_max          INTEGER,
    request_count           INTEGER NOT NULL DEFAULT 0,
    remaining               INTEGER,
    last_request            TIMESTAMPTZ,
    expires_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    permissions             TEXT,
    metadata                TEXT
);

CREATE INDEX idx_apikey_reference_id ON "apikey"(reference_id);
CREATE INDEX idx_apikey_config_id    ON "apikey"(config_id);

-- ============================================================
-- 4. Application tables (mirrors db/schema.ts)
-- ============================================================

CREATE TABLE wallets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'KES',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        transaction_type NOT NULL,
    status      transaction_status NOT NULL DEFAULT 'PENDING',
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount          BIGINT NOT NULL,
    entry_type      entry_type NOT NULL,
    narration       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
    key              TEXT PRIMARY KEY,
    user_id          UUID NOT NULL,
    response_status  BIGINT NOT NULL,
    response_body    JSONB NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- 5. Materialized view for O(1) balance lookups
-- ============================================================

CREATE MATERIALIZED VIEW wallet_balances AS
SELECT
    wallet_id,
    COALESCE(SUM(amount), 0) AS balance
FROM ledger_entries
GROUP BY wallet_id;

CREATE UNIQUE INDEX idx_wallet_balances_wallet_id ON wallet_balances(wallet_id);

-- ============================================================
-- 6. Seed system user and system wallets
-- ============================================================

INSERT INTO "user" (id, name, email, email_verified, role)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'System',
    'system@internal',
    TRUE,
    'admin'
);

INSERT INTO wallets (id, user_id, currency) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'KES'),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'KES'),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'KES');

COMMIT;
