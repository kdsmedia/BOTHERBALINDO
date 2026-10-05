-- ============================================
-- DATABASE BOT WHATSAPP
-- CLOUDFLARE D1
-- ============================================

PRAGMA foreign_keys = ON;

-- ============================================
-- TABEL MEMBER
-- ============================================

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL UNIQUE,
    whatsapp TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'blocked')),
    referred_by TEXT DEFAULT NULL,
    daily_login_date TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABEL PRODUK
-- ============================================

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    reward_points INTEGER NOT NULL DEFAULT 50000,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABEL TRANSAKSI
-- ============================================

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL,
    type TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    description TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(member_id)
);

-- ============================================
-- TABEL WITHDRAW
-- ============================================

CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    withdrawal_id TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL
        CHECK (method IN ('DANA', 'OVO', 'GOPAY')),
    account_number TEXT NOT NULL,
    account_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT DEFAULT NULL,
    processed_by TEXT DEFAULT NULL,
    FOREIGN KEY (member_id) REFERENCES members(member_id)
);

-- ============================================
-- TABEL PENGATURAN BOT
-- ============================================

CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PENGATURAN DEFAULT
-- ============================================

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('admin_whatsapp', '085813899649');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('points_per_rupiah', '100');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('points_conversion', '1000=10');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('daily_login_reward', '100');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('referral_reward', '1000');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('purchase_reward', '500');

INSERT OR IGNORE INTO settings
    (setting_key, setting_value)
VALUES
    ('download_app_url',
     'https://play.google.com/store/apps/details?id=com.altomedia.herbalindo');

-- ============================================
-- INDEX
-- ============================================

CREATE INDEX IF NOT EXISTS idx_members_whatsapp
ON members(whatsapp);

CREATE INDEX IF NOT EXISTS idx_members_member_id
ON members(member_id);

CREATE INDEX IF NOT EXISTS idx_transactions_member
ON transactions(member_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_member
ON withdrawals(member_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);
