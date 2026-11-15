CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('USER', 'AGENT', 'ADMIN');
CREATE TYPE kyc_status AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE pay_method_type AS ENUM ('MONCASH', 'NATCASH', 'BANK');
CREATE TYPE ad_side AS ENUM ('SELL', 'BUY');
CREATE TYPE ad_status AS ENUM ('ACTIVE', 'PAUSED', 'SOLD_OUT', 'CLOSED');
CREATE TYPE order_state AS ENUM (
  'ORDER_CREATED', 'AWAITING_PAYMENT', 'PAID_CLAIMED', 'DISPUTED',
  'RELEASING', 'COMPLETED', 'REFUNDING', 'REFUNDED', 'CANCELLED_TIMEOUT');
CREATE TYPE refund_reason AS ENUM ('BUYER_CANCEL', 'PAY_TIMEOUT', 'DISPUTE_SELLER_WINS');
CREATE TYPE dispute_status AS ENUM ('OPEN', 'RESOLVED_BUYER', 'RESOLVED_SELLER');
CREATE TYPE escrow_tx_kind AS ENUM ('LOCK', 'RELEASE', 'REFUND');
CREATE TYPE escrow_tx_status AS ENUM ('SENT', 'CONFIRMED', 'FAILED');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  role          user_role NOT NULL DEFAULT 'USER',
  tier          smallint NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 3),
  banned        boolean NOT NULL DEFAULT false,
  strikes       smallint NOT NULL DEFAULT 0,
  wallet_addr   text,
  suspended_until timestamptz,
  display_name  text,                   -- optional public name, e.g. a company
  bio           text,
  avatar        bytea,
  avatar_mime   text,
  kyc_challenge text,                   -- code the person must say in their ID video
  binance_uid   text,                   -- where to receive crypto by Binance internal transfer
  payout_network text,
  payout_addr   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  status        kyc_status NOT NULL DEFAULT 'PENDING',
  id_doc_ref    text NOT NULL,          -- pointer to the stored ID image, not the image
  name_on_id    text NOT NULL,
  id_type       text,                   -- NATIONAL_ID, PASSPORT or DRIVER_LICENSE
  id_number     text,
  challenge     text,                   -- the words the person had to say in their video
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Linked accounts: a user may receive gourdes into another REGISTERED, ID-checked person's MonCash/NatCash/bank
-- account, only after that person accepts. Each link costs LINK_FEE_USDT every 30 days.
CREATE TABLE account_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES users(id),   -- the trader who uses the account
  member_id         uuid NOT NULL REFERENCES users(id),   -- the person who owns the account
  payment_method_id uuid,                                 -- the member's account, set when they accept
  status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','ENDED')),
  paid_until        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_id <> member_id)
);
CREATE UNIQUE INDEX account_links_open ON account_links (owner_id, member_id) WHERE status <> 'ENDED';

-- ID photos and the video. Drafts (kyc_id NULL) until the person presses Send.
CREATE TABLE kyc_files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  kyc_id     uuid REFERENCES kyc(id),
  kind       text NOT NULL CHECK (kind IN ('FRONT', 'BACK', 'VIDEO')),
  mime       text NOT NULL,
  size       int NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kyc_files_draft ON kyc_files (user_id, kind) WHERE kyc_id IS NULL;
CREATE INDEX kyc_files_kyc ON kyc_files (kyc_id);

CREATE TABLE payment_methods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  type          pay_method_type NOT NULL,
  account_name  text NOT NULL,          -- must match name_on_id
  account_ref   text NOT NULL,          -- MonCash/NatCash number or bank account
  verified      boolean NOT NULL DEFAULT false,
  bank_name     text,                   -- for BANK accounts: which bank
  -- Family receiver: an account of someone else (family in Haiti) the user sends money to.
  is_receiver   boolean NOT NULL DEFAULT false,
  receiver_phone text,                  -- their phone, they get an SMS to confirm the money arrived
  paid_until    timestamptz,            -- extra receivers are paid monthly; the first one is free (NULL)
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One MonCash/NatCash/bank account belongs to one user. Family receivers are the exception.
CREATE UNIQUE INDEX payment_methods_account_uniq ON payment_methods (type, account_ref) WHERE NOT is_receiver;

CREATE TABLE ads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  side            ad_side NOT NULL,
  asset           text NOT NULL DEFAULT 'USDT' CHECK (asset IN ('USDT', 'USDC')),
  price_htg       numeric(14,2) NOT NULL CHECK (price_htg > 0),   -- HTG per 1 unit
  total_amount    numeric(18,6) NOT NULL CHECK (total_amount > 0),
  remaining       numeric(18,6) NOT NULL CHECK (remaining >= 0),
  min_order_htg   numeric(14,2) NOT NULL CHECK (min_order_htg > 0),
  max_order_htg   numeric(14,2) NOT NULL,
  pay_type        pay_method_type NOT NULL,
  payment_method_id uuid REFERENCES payment_methods(id),   -- SELL ads: where the seller is paid. BUY ads: null.
  pay_types       text[],                -- all payment types this ad accepts (MONCASH, NATCASH, BANK)
  pay_methods     uuid[],                -- SELL ads: all the seller's accounts the buyer may pay into
  fee_rate        numeric(7,5) NOT NULL DEFAULT 0,
  reserved        numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0), -- SELL ads: USDT held for this ad
  status          ad_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (max_order_htg >= min_order_htg),
  CHECK (remaining <= total_amount),
  CHECK ((side = 'SELL') = (payment_method_id IS NOT NULL))
);
CREATE INDEX ads_book_idx ON ads (side, asset, price_htg) WHERE status = 'ACTIVE';

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id           uuid NOT NULL REFERENCES ads(id),
  buyer_id        uuid NOT NULL REFERENCES users(id),
  seller_id       uuid NOT NULL REFERENCES users(id),
  asset           text NOT NULL,
  amount          numeric(18,6) NOT NULL CHECK (amount > 0),
  price_htg       numeric(14,2) NOT NULL,           -- price frozen at order time
  total_htg       numeric(14,2) NOT NULL,
  fee_amount      numeric(18,6) NOT NULL DEFAULT 0, -- taken from the seller, in USDT
  payment_method_id uuid NOT NULL REFERENCES payment_methods(id),
  receiver_token_hash text,              -- SMS link for a family receiver to confirm the money arrived
  receiver_said   text,                  -- RECEIVED or NOT_RECEIVED
  receiver_at     timestamptz,
  pay_reference   text NOT NULL,                    -- code the buyer must put in the payment note
  state           order_state NOT NULL DEFAULT 'ORDER_CREATED',
  refund_reason   refund_reason,
  state_deadline  timestamptz,                      -- next timer for this state
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id),
  CHECK ((state IN ('REFUNDING', 'REFUNDED')) = (refund_reason IS NOT NULL))
);
CREATE INDEX orders_deadline_idx ON orders (state_deadline)
  WHERE state IN ('ORDER_CREATED', 'AWAITING_PAYMENT', 'PAID_CLAIMED');

-- Only these moves are legal. A trigger enforces them.
CREATE TABLE order_transitions (
  from_state order_state NOT NULL,
  to_state   order_state NOT NULL,
  PRIMARY KEY (from_state, to_state)
);
INSERT INTO order_transitions VALUES
  ('ORDER_CREATED',    'AWAITING_PAYMENT'),
  ('ORDER_CREATED',    'CANCELLED_TIMEOUT'),
  ('AWAITING_PAYMENT', 'PAID_CLAIMED'),
  ('AWAITING_PAYMENT', 'REFUNDING'),
  ('PAID_CLAIMED',     'RELEASING'),
  ('PAID_CLAIMED',     'DISPUTED'),
  ('DISPUTED',         'RELEASING'),
  ('DISPUTED',         'REFUNDING'),
  ('RELEASING',        'COMPLETED'),
  ('REFUNDING',        'REFUNDED');

-- Append-only log of everything that happens to an order.
CREATE TABLE order_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  actor_id    uuid REFERENCES users(id),            -- null = system
  from_state  order_state,
  to_state    order_state,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE FUNCTION order_events_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_events is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER order_events_no_update BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION order_events_block_change();

CREATE FUNCTION orders_check_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.state <> OLD.state THEN
    IF NOT EXISTS (SELECT 1 FROM order_transitions
                   WHERE from_state = OLD.state AND to_state = NEW.state) THEN
      RAISE EXCEPTION 'illegal order move % -> %', OLD.state, NEW.state;
    END IF;
    INSERT INTO order_events (order_id, actor_id, from_state, to_state, note)
      VALUES (NEW.id,
              NULLIF(current_setting('app.actor', true), '')::uuid,
              OLD.state, NEW.state,
              NULLIF(current_setting('app.note', true), ''));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_transition BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_check_transition();

CREATE TABLE chat_messages (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  sender_id   uuid REFERENCES users(id),            -- null = system message
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_order_idx ON chat_messages (order_id, id);

CREATE TABLE disputes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL UNIQUE REFERENCES orders(id),
  opened_by    uuid REFERENCES users(id),           -- null = system (seller silent)
  reason       text NOT NULL,
  status       dispute_status NOT NULL DEFAULT 'OPEN',
  agent_id     uuid REFERENCES users(id),
  decision_note text,
  evidence_due timestamptz NOT NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('RECEIPT', 'STATEMENT', 'CHAT_EXPORT', 'OTHER')),
  file_ref    text NOT NULL,                 -- a link, or 'upload:<id>' for a stored file
  mime        text,
  orig_name   text,
  data        bytea,                         -- the stored file itself (kept in the database so it survives redeploys)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escrow_txs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  kind        escrow_tx_kind NOT NULL,
  tx_hash     text,
  status      escrow_tx_status NOT NULL DEFAULT 'SENT',
  attempts    smallint NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
-- One successful lock, and only one successful final move, per order.
CREATE UNIQUE INDEX escrow_one_lock ON escrow_txs (order_id) WHERE kind = 'LOCK' AND status <> 'FAILED';
CREATE UNIQUE INDEX escrow_one_exit ON escrow_txs (order_id) WHERE kind IN ('RELEASE', 'REFUND') AND status <> 'FAILED';

CREATE TABLE ratings (
  order_id    uuid NOT NULL REFERENCES orders(id),
  rater_id    uuid NOT NULL REFERENCES users(id),
  rated_id    uuid NOT NULL REFERENCES users(id),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, rater_id)
);

CREATE TABLE tier_limits (
  tier              smallint PRIMARY KEY CHECK (tier BETWEEN 0 AND 3),
  max_order_htg     numeric(14,2) NOT NULL,
  max_daily_htg     numeric(14,2) NOT NULL,
  max_open_orders   smallint NOT NULL
);

CREATE TABLE screening_hits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  list_name   text NOT NULL,
  matched_name text NOT NULL,
  resolved    boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blocklist (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('PHONE', 'WALLET', 'PAY_ACCOUNT', 'NAME')),
  value       text NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

-- Dispute votes: big orders need two agents to agree. An admin vote is final.
CREATE TABLE dispute_votes (
  dispute_id  uuid NOT NULL REFERENCES disputes(id),
  agent_id    uuid NOT NULL REFERENCES users(id),
  decision    text NOT NULL CHECK (decision IN ('BUYER', 'SELLER')),
  note        text,
  fake_proof  boolean NOT NULL DEFAULT false,
  penalize    boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, agent_id)
);

-- Internal USDT/USDC ledger used by the simulated escrow (MOCK_ESCROW=true).
-- With a real on-chain escrow, balances live in the contract instead.
CREATE TABLE wallet_balances (
  user_id    uuid NOT NULL REFERENCES users(id),
  asset      text NOT NULL CHECK (asset IN ('USDT', 'USDC')),
  available  numeric(18,6) NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked     numeric(18,6) NOT NULL DEFAULT 0 CHECK (locked >= 0),
  PRIMARY KEY (user_id, asset)
);

INSERT INTO tier_limits (tier, max_order_htg, max_daily_htg, max_open_orders) VALUES
  (0, 0, 0, 0),
  (1, 10000, 25000, 1),
  (2, 50000, 150000, 3),
  (3, 250000, 750000, 5);

-- The platform's own fee account (receives fees in USDT/USDC only).
INSERT INTO users (id, phone, full_name, role)
  VALUES ('00000000-0000-0000-0000-000000000001', 'platform', 'Platform fees', 'ADMIN');

-- One-time SMS codes. Only a hash of the code is stored.
CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  used        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (phone, created_at DESC);

-- ---- On-chain escrow (ESCROW_MODE=EVM) ----
-- One wallet belongs to one account.
CREATE UNIQUE INDEX users_wallet_unique ON users (lower(wallet_addr)) WHERE wallet_addr IS NOT NULL;
-- The seller's signed approval to release, kept until the release is sent.
ALTER TABLE orders ADD COLUMN release_sig text, ADD COLUMN release_deadline bigint;
-- Deposits and withdrawals seen on the chain. One row per log, applied to wallet_balances once.
CREATE TABLE chain_events (
  id           bigserial PRIMARY KEY,
  tx_hash      text NOT NULL,
  log_index    int  NOT NULL,
  block_number bigint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('DEPOSIT','WITHDRAW')),
  token        text NOT NULL,
  address      text NOT NULL,
  amount       numeric(18,6) NOT NULL,
  applied      boolean NOT NULL DEFAULT false,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);
CREATE TABLE chain_state (key text PRIMARY KEY, value text NOT NULL);
