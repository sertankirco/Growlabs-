-- ─────────────────────────────────────────────────────────────────────────────
-- World Cup 2026: Live Stock & Manager — PostgreSQL Şeması
-- v0.6 — Transactional kilit + ACID garantisi
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Oyuncular (statik bilgi) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS players (
  player_id         TEXT PRIMARY KEY,
  name              TEXT    NOT NULL,
  position          TEXT    NOT NULL CHECK (position IN ('GK','DEF','MID','FWD')),
  base_market_price BIGINT  NOT NULL,
  perf_score        INTEGER NOT NULL DEFAULT 0
);

-- ── Cüzdanlar ────────────────────────────────────────────────────────────────
--
-- balance  : onaylanmış bakiye (commitReservation sonrası düşer)
-- reserved : bekleyen rezervasyonların toplamı (çift harcama kalkanı)
-- version  : optimistik kilit sayacı (DB katmanında WHERE version=$N güvencesi)

CREATE TABLE IF NOT EXISTS wallets (
  user_id    TEXT   PRIMARY KEY,
  balance    BIGINT NOT NULL DEFAULT 0,
  reserved   BIGINT NOT NULL DEFAULT 0,
  version    BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── İşlemler (transactions) ──────────────────────────────────────────────────
--
-- idempotency_key UNIQUE + NULL yapılabilir:
--   • NULL değerler UNIQUE kısıtlamasında çakışmaz (PostgreSQL davranışı)
--   • Rollback sırasında key NULL yapılır → aynı key ile yeniden denenebilir

CREATE TABLE IF NOT EXISTS transactions (
  tx_id           TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES wallets(user_id),
  type            TEXT    NOT NULL
                  CHECK (type IN ('DEPOSIT','BUY_PLAYER','SELL_PLAYER',
                                  'PERFORMANCE_EARNINGS','WITHDRAWAL')),
  amount          BIGINT  NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','COMMITTED','ROLLED_BACK')),
  idempotency_key TEXT    UNIQUE,        -- NULL = iptal edilmiş, yeniden denenebilir
  player_id       TEXT    REFERENCES players(player_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_user       ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_idempotent ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Kadro ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS squad_versions (
  user_id  TEXT   PRIMARY KEY REFERENCES wallets(user_id),
  version  BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS squad_members (
  user_id    TEXT NOT NULL REFERENCES wallets(user_id),
  player_id  TEXT NOT NULL REFERENCES players(player_id),
  slot       TEXT NOT NULL CHECK (slot IN ('starting','bench')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, player_id)
);

-- ── Piyasa ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_prices (
  player_id    TEXT   PRIMARY KEY REFERENCES players(player_id),
  current_price BIGINT NOT NULL,
  total_buys   BIGINT NOT NULL DEFAULT 0,
  total_sells  BIGINT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Son SCORE_HISTORY_SIZE (3) performans event puanı — volatilite hesabı için
CREATE TABLE IF NOT EXISTS perf_events (
  id         BIGSERIAL PRIMARY KEY,
  player_id  TEXT   NOT NULL REFERENCES players(player_id),
  coins      BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perf_player ON perf_events(player_id, id DESC);

-- Son TRANSACTION_WINDOW (20) alım/satım — talep baskısı için kayan pencere
CREATE TABLE IF NOT EXISTS demand_events (
  id         BIGSERIAL PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(player_id),
  tx_type    TEXT NOT NULL CHECK (tx_type IN ('BUY','SELL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demand_player ON demand_events(player_id, id DESC);

-- Tüm fiyat değişikliklerinin geçmişi (grafik, 24h değişim vb.)
CREATE TABLE IF NOT EXISTS price_history (
  id         BIGSERIAL PRIMARY KEY,
  player_id  TEXT   NOT NULL REFERENCES players(player_id),
  price      BIGINT NOT NULL,
  reason     TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_history_player ON price_history(player_id, id DESC);
