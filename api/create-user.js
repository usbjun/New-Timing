import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // 呼び出し元の JWT を取得
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 呼び出し元ユーザーが admin か確認
  const { data: { user: caller }, error: callerErr } = await supabaseAdmin.auth.getUser(token)
  if (callerErr || !caller) return res.status(401).json({ error: 'Invalid token' })

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', caller.id).single()
  if (callerProfile?.role !== 'admin') {
    return res.status(403).json({ error: '管理者のみがユーザーを作成できます' })
  }

  // 入力検証
  const { email, password, name, team, role } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードは必須です' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上で設定してください' })
  }

  // ユーザー作成（メール確認済みとして登録）
  const { data: newUserData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name || '', team: team || '' }
  })
  if (createErr) return res.status(400).json({ error: createErr.message })

  // profiles テーブルの role を更新（admin の場合のみ）
  if (role === 'admin') {
    await supabaseAdmin.from('profiles')
      .update({ role: 'admin' }).eq('id', newUserData.user.id)
  }

  return res.status(200).json({ ok: true, userId: newUserData.user.id })
}
