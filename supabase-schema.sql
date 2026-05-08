-- ============================================================
-- 新商品発売タイミング管理 - Supabase スキーマ（完全版）
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ※ products テーブルが既に存在する環境向け
-- ============================================================

-- ============================================================
-- 1. products テーブル（既存）
--    ※ 既にある場合はスキップ。カラムが不足していれば追加してください。
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  release     TEXT        NOT NULL,
  price       TEXT,
  box         TEXT,
  ctn         TEXT,
  person      TEXT        DEFAULT '',
  team        TEXT        DEFAULT '',
  cat         INTEGER     NOT NULL CHECK (cat IN (1, 2, 3)),
  sort_order  INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_sort_order_idx ON products (sort_order ASC);

-- ============================================================
-- 2. profiles テーブル（ユーザー情報）
--    ロール：admin（管理者） / viewer（閲覧者）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name       TEXT        NOT NULL DEFAULT '',
  team       TEXT        NOT NULL DEFAULT '' CHECK (team IN ('', 'A', 'B', 'C')),
  role       TEXT        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 新規ユーザー登録時にプロフィールを自動生成するトリガー
--    ※ 管理者がユーザーを作成した際も自動実行される
--    ※ デフォルトロールは 'viewer'（閲覧者）
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, team, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'team', ''),
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. 管理者用：全ユーザー情報を取得する RPC 関数
--    （auth.users の email にアクセスするため SECURITY DEFINER が必要）
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE (
  id         UUID,
  email      TEXT,
  name       TEXT,
  team       TEXT,
  role       TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id,
    u.email,
    COALESCE(p.name, '')   AS name,
    COALESCE(p.team, '')   AS team,
    p.role,
    p.created_at
  FROM public.profiles p
  JOIN auth.users u ON p.id = u.id
  ORDER BY p.created_at ASC;
$$;

-- ============================================================
-- 5. 管理者チェック用ヘルパー関数
--    SECURITY DEFINER で RLS をバイパスして再帰クエリを防ぐ
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- 6. Row Level Security (RLS)
-- ============================================================

-- ---------- products ----------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーをすべて削除してから再作成
DROP POLICY IF EXISTS "allow_all"            ON products;
DROP POLICY IF EXISTS "authenticated_select" ON products;
DROP POLICY IF EXISTS "authenticated_insert" ON products;
DROP POLICY IF EXISTS "authenticated_update" ON products;
DROP POLICY IF EXISTS "authenticated_delete" ON products;
DROP POLICY IF EXISTS "admin_insert"         ON products;
DROP POLICY IF EXISTS "admin_update"         ON products;
DROP POLICY IF EXISTS "admin_delete"         ON products;

-- 全認証ユーザーが閲覧可能
CREATE POLICY "authenticated_select" ON products
  FOR SELECT TO authenticated USING (true);

-- 管理者のみ追加・更新・削除可能（is_admin() で再帰クエリを回避）
CREATE POLICY "admin_insert" ON products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_update" ON products FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_delete" ON products FOR DELETE TO authenticated
  USING (public.is_admin());

-- ---------- profiles ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

-- 全認証ユーザーが閲覧可（チーム情報の表示に必要）
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated USING (true);

-- 新規登録時の自動挿入（trigger 経由）
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated WITH CHECK (true);

-- 自分自身か管理者のみ更新可（is_admin() で再帰クエリを回避）
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin());

-- ============================================================
-- 7. 初期管理者の設定（初回のみ実行）
--    1. まず下記 SQL でユーザー一覧を確認し、管理者にするユーザーの UUID を取得
--       SELECT id, email FROM auth.users;
--    2. 次の行の UUID を書き換えて実行
-- ============================================================
-- UPDATE profiles SET role = 'admin' WHERE id = 'YOUR_USER_UUID_HERE';
