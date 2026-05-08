-- ============================================================
-- 新商品発売タイミング管理 - Supabase テーブル定義
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  release     TEXT        NOT NULL,          -- 発売月 YYYY-MM
  price       TEXT,
  box         TEXT,
  ctn         TEXT,
  person      TEXT        DEFAULT '',        -- 担当者
  team        TEXT        DEFAULT '',        -- チーム A / B / C
  cat         INTEGER     NOT NULL CHECK (cat IN (1, 2, 3)),
  sort_order  INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security を有効化
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 認証不要・全操作を許可（社内ツールのため）
CREATE POLICY "allow_all" ON products
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- sort_order でソートするインデックス
CREATE INDEX IF NOT EXISTS products_sort_order_idx ON products (sort_order ASC);
