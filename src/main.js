import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import './style.css'

// ============================================================
//  Supabase 初期化
// ============================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;color:#1e293b;">
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:18px;font-weight:700">Supabase の環境変数が設定されていません</div>
      <div style="font-size:13px;color:#64748b;text-align:center;line-height:1.8;">
        プロジェクトルートに <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">.env.local</code> を作成し、<br>
        <code>VITE_SUPABASE_URL</code> と <code>VITE_SUPABASE_ANON_KEY</code> を設定してください。
      </div>
    </div>`
  throw new Error('Supabase env vars missing')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ============================================================
//  状態
// ============================================================
let products     = []
let currentUser  = null   // { id, email, name, team, role }
let appReady     = false  // 二重初期化防止

let editingId    = null
let selectedCat  = null
let selectedTeam = null

// ユーザー管理
let editingUserId    = null
let editUserTeamSel  = ''
let editUserRoleSel  = ''
let profileTeamSel   = ''

// ユーザー作成
let createUserTeamSel = ''
let createUserRoleSel = 'viewer'

// Excel取り込み
let importCatSel = 0
let importRows   = []

// ============================================================
//  月リスト (2026年4月 〜 2027年8月)
// ============================================================
function buildMonths() {
  const list = []
  for (let y = 2026; y <= 2027; y++) {
    const start = y === 2026 ? 4 : 1
    const end   = y === 2027 ? 8 : 12
    for (let m = start; m <= end; m++)
      list.push({ y, m, key: `${y}-${String(m).padStart(2,'0')}` })
  }
  return list
}
const MONTHS = buildMonths()

const NOW       = new Date()
const TODAY_KEY = `${NOW.getFullYear()}-${String(NOW.getMonth()+1).padStart(2,'0')}`

function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${y}年${parseInt(m)}月`
}

function announceLabel(releaseKey, offset) {
  const [ys, ms] = releaseKey.split('-').map(Number)
  let m = ms - offset, y = ys
  while (m <= 0) { m += 12; y-- }
  return `${y}年${m}月案内`
}

function teamBgClass(team) {
  return team ? `team-${team}` : 'team-none'
}

function avatarColor(team) {
  return { A: '#8b5cf6', B: '#f59e0b', C: '#14b8a6' }[team] || '#94a3b8'
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ============================================================
//  ローディング
// ============================================================
function setLoading(on) {
  document.getElementById('loadingBar').classList.toggle('active', on)
  const btn = document.getElementById('btnAddMain')
  if (btn) btn.disabled = on
}

// ============================================================
//  トースト
// ============================================================
let _toastTimer = null
function showToast(msg, isError = false) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.toggle('error', isError)
  t.classList.add('show')
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2400)
}

// ============================================================
//  AUTH — ログイン画面の表示切替
// ============================================================
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden')
  document.getElementById('mainApp').style.display = 'none'
  clearLoginError()
}

function showMainApp() {
  document.getElementById('loginScreen').classList.add('hidden')
  const app = document.getElementById('mainApp')
  app.style.display    = 'flex'
  app.style.flexDirection = 'column'
  app.style.height     = '100vh'
}

function showLoginError(msg) {
  const el = document.getElementById('loginError')
  el.textContent = msg
  el.classList.add('show')
}
function clearLoginError() {
  document.getElementById('loginError').classList.remove('show')
}

// ログイン
async function doLogin() {
  clearLoginError()
  const email    = document.getElementById('loginEmail').value.trim()
  const password = document.getElementById('loginPassword').value
  if (!email || !password) { showLoginError('メールとパスワードを入力してください'); return }

  const btn = document.getElementById('btnLogin')
  btn.disabled = true; btn.textContent = 'ログイン中…'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  btn.disabled = false; btn.textContent = 'ログイン'
  if (error) showLoginError('ログインに失敗しました：' + error.message)
}
window.doLogin = doLogin

// ログアウト
async function doLogout() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch { /* ignore */ } finally {
    // signOut が失敗・ハングしても強制的にログイン画面へ
    appReady = false
    currentUser = null
    showLoginScreen()
  }
}
window.doLogout = doLogout

// ============================================================
//  ユーザー情報の読み込み
// ============================================================
async function loadCurrentUser(user) {
  try {
    if (!user) {
      const { data, error: userErr } = await supabase.auth.getUser()
      if (userErr || !data?.user) return null
      user = data.user
    }
    // 8秒でタイムアウト（ハング対策）
    const profileFetch = supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    const timeoutFetch = new Promise(resolve => setTimeout(() => resolve({ data: null }), 8000))
    const { data: profile } = await Promise.race([profileFetch, timeoutFetch])
    return { id: user.id, email: user.email, ...(profile || {}) }
  } catch {
    return null
  }
}

// ============================================================
//  ヘッダーのユーザーエリア更新
// ============================================================
function updateHeaderUser() {
  if (!currentUser) return
  const area = document.getElementById('headerUserArea')
  const teamCls   = teamBgClass(currentUser.team)
  const teamLabel = currentUser.team || '—'
  const isAdmin   = currentUser.role === 'admin'

  // 管理者のみ追加ボタン・Excel取込ボタンを表示
  const btnAdd = document.getElementById('btnAddMain')
  if (btnAdd) btnAdd.style.display = isAdmin ? '' : 'none'
  const btnImport = document.getElementById('btnImportExcel')
  if (btnImport) btnImport.style.display = isAdmin ? '' : 'none'

  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;">
      <div class="header-user-chip" onclick="openProfileModal()" title="プロフィール編集">
        <div class="header-team-badge ${teamCls}">${teamLabel}</div>
        <span class="header-user-name">${esc(currentUser.name || currentUser.email)}</span>
      </div>
      ${isAdmin ? `<button class="header-icon-btn admin-btn" onclick="openUserMgmt()" title="ユーザー管理">👑</button>` : ''}
      <button class="header-icon-btn" onclick="doLogout()" title="ログアウト">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>`
}

// ============================================================
//  月ナビ
// ============================================================
function buildMonthNav() {
  const nav = document.getElementById('monthNav')
  nav.innerHTML = ''
  MONTHS.forEach(mo => {
    const chip = document.createElement('div')
    chip.className = 'month-chip' + (mo.key === TODAY_KEY ? ' today-month' : '')
    chip.dataset.key = mo.key
    chip.textContent = mo.y === 2027 ? `${mo.m}月 '27` : `${mo.m}月`
    chip.onclick = () => jumpToMonth(mo.key)
    nav.appendChild(chip)
  })
}

function setActiveChip(key) {
  document.querySelectorAll('.month-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.key === key)
  )
}

function jumpToMonth(key) {
  const el = document.getElementById('col-' + key)
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  setActiveChip(key)
}

function scrollToInitialPosition() {
  const tl = document.getElementById('timeline')
  // 当月の3か月後・4か月後のキーを計算
  const d3 = new Date(TODAY_KEY + '-01')
  d3.setMonth(d3.getMonth() + 3)
  const key3 = d3.getFullYear() + '-' + String(d3.getMonth() + 1).padStart(2, '0')
  const d4 = new Date(TODAY_KEY + '-01')
  d4.setMonth(d4.getMonth() + 4)
  const key4 = d4.getFullYear() + '-' + String(d4.getMonth() + 1).padStart(2, '0')

  const col4 = document.getElementById('col-' + key4)
  if (col4) {
    const tlRect   = tl.getBoundingClientRect()
    const col4Rect = col4.getBoundingClientRect()
    // 4か月後の列の中央が画面中央に来るよう調整
    const midX    = (col4Rect.left + col4Rect.right) / 2
    const centerX = tlRect.left + tlRect.width / 2
    tl.scrollLeft += midX - centerX
    setActiveChip(key4)
  } else {
    jumpToMonth(TODAY_KEY)
  }
}

// ============================================================
//  タイムライン描画
// ============================================================
function buildTimeline() {
  const tl = document.getElementById('timeline')
  tl.innerHTML = ''
  MONTHS.forEach(mo => {
    const key    = mo.key
    const prods4 = products.filter(p => p.release === key && p.cat === 1)
    const prods3 = products.filter(p => p.release === key && (p.cat === 2 || p.cat === 3))

    // 案内タイル（left-cell）の商品数: 当月4か月前 + 前月3か月前（同じ案内月に属する）
    const [ys, ms] = key.split('-').map(Number)
    let pm = ms - 1, py = ys
    if (pm <= 0) { pm += 12; py-- }
    const prevKey = `${py}-${String(pm).padStart(2, '0')}`
    const prevProds3 = products.filter(p => p.release === prevKey && (p.cat === 2 || p.cat === 3))
    const announceTileCount = prods4.length + prevProds3.length

    const col = document.createElement('div')
    col.className = 'month-column'
    col.id = 'col-' + key
    col.innerHTML = `
      <div class="month-column-header ${key === TODAY_KEY ? 'is-today' : ''}">
        ${key === TODAY_KEY ? '<div class="today-dot"></div>' : ''}
        <div class="month-label">${mo.m}月 <span class="year-label">${mo.y}年</span></div>
        <div class="month-tag">発売月</div>
        <div class="release-count">${prods4.length + prods3.length}商品</div>
      </div>
      <div class="announce-band">
        <div class="announce-band-cell"><span class="announce-label">${announceLabel(key, 4)}<span class="announce-count">${announceTileCount}商品</span></span></div>
        <div class="announce-band-cell"></div>
      </div>
      <div class="sub-columns">
        <div class="sub-col">
          <div class="sub-col-header type-4">
            <div class="sub-col-title">① 4か月前案内</div>
            <div class="sub-col-announce">${announceLabel(key, 4)}</div>
          </div>
          <div class="tile-area" id="area4-${key}">
            ${prods4.length ? prods4.map(tileHtml).join('') : emptyState()}
          </div>
          ${currentUser?.role === 'admin' ? `<button class="btn-in-col" data-release="${key}" data-defaultcat="1">＋ 追加</button>` : ''}
        </div>
        <div class="sub-col">
          <div class="sub-col-header type-3">
            <div class="sub-col-title">②③ 3か月前案内</div>
            <div class="sub-col-announce">${announceLabel(key, 3)}（未案内）</div>
          </div>
          <div class="tile-area" id="area3-${key}">
            ${prods3.length ? prods3.map(tileHtml).join('') : emptyState()}
          </div>
          ${currentUser?.role === 'admin' ? `<button class="btn-in-col" data-release="${key}" data-defaultcat="23">＋ 追加</button>` : ''}
        </div>
      </div>`
    tl.appendChild(col)
  })

  tl.querySelectorAll('.btn-in-col').forEach(btn => {
    btn.addEventListener('click', () =>
      openAddModal(btn.dataset.release, btn.dataset.defaultcat === '1' ? 1 : 23)
    )
  })
  attachTileDragListeners()
}

function emptyState() {
  return `<div class="empty-placeholder">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/>
    </svg><span>商品なし</span></div>`
}

function tileHtml(p) {
  const price    = p.price ? `¥${Number(p.price).toLocaleString()}` : '—'
  const box      = p.box   || '—'
  const ctn      = p.ctn   || '—'
  const person   = esc(p.person || '—')
  const teamCls  = teamBgClass(p.team)
  const teamLbl  = p.team || '?'
  const noteIcon = p.note ? `<span class="tile-note-badge" title="${esc(p.note)}">備考</span>` : ''
  return `
    <div class="product-tile cat-${p.cat}" data-id="${p.id}">
      <div class="tile-badge cat-${p.cat}">${p.cat}</div>
      <div class="tile-name">${esc(p.name)}</div>
      <div class="tile-row">
        <div class="tile-field">BOX入 <strong>${box}</strong></div>
        <div class="tile-field">CTN入 <strong>${ctn}</strong></div>
      </div>
      <div class="tile-footer">
        <span class="team-badge ${teamCls}">${teamLbl}</span>
        <span class="tile-person" title="${person}">${person}</span>
        ${noteIcon}
        <span class="tile-price">${price}</span>
      </div>
    </div>`
}

// ============================================================
//  Supabase CRUD
// ============================================================
async function dbLoadAll() {
  const fetchPromise = supabase
    .from('products').select('*').order('sort_order', { ascending: true })
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('接続タイムアウト')), 10000)
  )
  const { data, error } = await Promise.race([fetchPromise, timeout])
  if (error) throw error
  return data || []
}

async function dbUpsert(p) {
  const { error } = await supabase.from('products').upsert(p)
  if (error) throw error
}

async function dbDelete(id) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

async function dbSyncOrder() {
  if (!products.length) return
  // 部分データの upsert は NOT NULL 制約に違反するため全フィールドを含める
  const { error } = await supabase.from('products')
    .upsert(products.map((p, i) => ({ ...p, sort_order: i })))
  if (error) throw error
}

// ============================================================
//  月セレクト
// ============================================================
function buildReleaseSelect() {
  const sel = document.getElementById('fRelease')
  sel.innerHTML = ''
  MONTHS.forEach(mo => {
    const opt = document.createElement('option')
    opt.value = mo.key; opt.textContent = monthLabel(mo.key)
    sel.appendChild(opt)
  })
}

// ============================================================
//  商品モーダル
// ============================================================
function openAddModal(releaseKey, defaultCat) {
  editingId = null
  resetProductForm()
  document.getElementById('modalTitle').textContent = '商品を追加'
  document.getElementById('btnDelete').style.display = 'none'
  if (releaseKey) document.getElementById('fRelease').value = releaseKey
  if (defaultCat === 1)  selectCat(1)
  if (defaultCat === 23) selectCat(2)
  document.getElementById('overlay').classList.add('open')
  setTimeout(() => document.getElementById('fName').focus(), 80)
}
window.openAddModal = openAddModal

function openEditModal(id) {
  const p = products.find(x => x.id === id)
  if (!p) return
  editingId = id
  resetProductForm()
  document.getElementById('modalTitle').textContent  = '商品を編集'
  document.getElementById('btnDelete').style.display = 'block'
  document.getElementById('fName').value    = p.name
  document.getElementById('fRelease').value = p.release
  document.getElementById('fPrice').value   = p.price  || ''
  document.getElementById('fBox').value     = p.box    || ''
  document.getElementById('fCtn').value     = p.ctn    || ''
  document.getElementById('fPerson').value  = p.person || ''
  document.getElementById('fNote').value    = p.note   || ''
  if (p.team) selectTeam(p.team)
  selectCat(p.cat)
  document.getElementById('overlay').classList.add('open')

  // viewer の場合：読み取り専用モードにする
  const isViewer = currentUser?.role !== 'admin'
  ;['fName', 'fRelease', 'fPrice', 'fBox', 'fCtn', 'fPerson', 'fNote'].forEach(inputId => {
    document.getElementById(inputId).disabled = isViewer
  })
  document.querySelectorAll('#overlay .cat-opt, #overlay .team-opt').forEach(el => {
    el.style.pointerEvents = isViewer ? 'none' : ''
  })
  document.getElementById('btnSave').style.display = isViewer ? 'none' : ''
  document.getElementById('btnDelete').style.display = isViewer ? 'none' : 'block'
  const btnCancel = document.querySelector('#overlay .btn-cancel')
  if (btnCancel) btnCancel.textContent = isViewer ? '閉じる' : 'キャンセル'
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open')
  editingId = null; selectedCat = null; selectedTeam = null
}
window.closeModal = closeModal

function resetProductForm() {
  ;['fName','fPrice','fBox','fCtn','fPerson','fNote'].forEach(id => {
    const el = document.getElementById(id)
    el.value = ''; el.classList.remove('error'); el.disabled = false
  })
  document.getElementById('fRelease').value = TODAY_KEY
  document.getElementById('fRelease').disabled = false
  selectedCat = null; selectedTeam = null
  document.querySelectorAll('.cat-opt').forEach(el => el.className = 'cat-opt')
  document.querySelectorAll('#overlay .team-opt').forEach(el => el.className = 'team-opt')
}

function selectCat(n) {
  selectedCat = n
  document.querySelectorAll('#overlay .cat-opt').forEach(el => {
    el.className = 'cat-opt'
    if (Number(el.dataset.cat) === n) el.classList.add('sel-' + n)
  })
}
window.selectCat = selectCat

function selectTeam(t) {
  selectedTeam = t
  document.querySelectorAll('#overlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === t) el.classList.add('sel-' + t)
  })
}
window.selectTeam = selectTeam

async function saveProduct() {
  const name = document.getElementById('fName').value.trim()
  if (!name) { document.getElementById('fName').classList.add('error'); showToast('商品名を入力してください', true); return }
  if (!selectedCat) { showToast('案内区分を選択してください', true); return }

  const existing = editingId ? products.find(x => x.id === editingId) : null
  const p = {
    id:         editingId || uid(),
    name,
    release:    document.getElementById('fRelease').value,
    price:      document.getElementById('fPrice').value,
    box:        document.getElementById('fBox').value,
    ctn:        document.getElementById('fCtn').value,
    person:     document.getElementById('fPerson').value.trim(),
    note:       document.getElementById('fNote').value.trim(),
    team:       selectedTeam || '',
    cat:        selectedCat,
    sort_order: existing ? existing.sort_order : products.length,
  }

  setSaveLoading(true)
  try {
    await dbUpsert(p)
    if (editingId) {
      const i = products.findIndex(x => x.id === editingId)
      if (i >= 0) products[i] = p
    } else {
      products.push(p)
    }
    closeModal(); buildTimeline()
    showToast(editingId ? '商品を更新しました' : '商品を追加しました')
  } catch(err) {
    showToast('保存に失敗しました: ' + err.message, true)
  } finally {
    setSaveLoading(false)
  }
}
window.saveProduct = saveProduct

async function confirmDelete() {
  if (!confirm('この商品を削除しますか？')) return
  setSaveLoading(true)
  try {
    await dbDelete(editingId)
    products = products.filter(p => p.id !== editingId)
    products.forEach((p, i) => { p.sort_order = i })
    await dbSyncOrder()
    closeModal(); buildTimeline()
    showToast('商品を削除しました')
  } catch(err) {
    showToast('削除に失敗しました: ' + err.message, true)
  } finally {
    setSaveLoading(false)
  }
}
window.confirmDelete = confirmDelete

function setSaveLoading(on) {
  const btn = document.getElementById('btnSave')
  if (btn) { btn.disabled = on; btn.textContent = on ? '保存中…' : '保存する' }
}

// ============================================================
//  プロフィール編集モーダル
// ============================================================
function openProfileModal() {
  if (!currentUser) return
  profileTeamSel = currentUser.team || ''
  document.getElementById('profileName').value = currentUser.name || ''
  document.getElementById('profileEmail').textContent = currentUser.email || ''
  document.querySelectorAll('#profileOverlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === profileTeamSel) el.classList.add('sel-' + profileTeamSel)
  })
  document.getElementById('profileOverlay').classList.add('open')
}
window.openProfileModal = openProfileModal

function closeProfileModal() {
  document.getElementById('profileOverlay').classList.remove('open')
}
window.closeProfileModal = closeProfileModal

function selectProfileTeam(t) {
  profileTeamSel = t
  document.querySelectorAll('#profileOverlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === t) el.classList.add('sel-' + t)
  })
}
window.selectProfileTeam = selectProfileTeam

async function saveProfile() {
  const name = document.getElementById('profileName').value.trim()
  const btn  = document.getElementById('btnProfileSave')
  btn.disabled = true; btn.textContent = '保存中…'
  try {
    const { error } = await supabase.from('profiles')
      .update({ name, team: profileTeamSel })
      .eq('id', currentUser.id)
    if (error) throw error
    currentUser.name = name
    currentUser.team = profileTeamSel
    updateHeaderUser()
    closeProfileModal()
    showToast('プロフィールを更新しました')
  } catch(err) {
    showToast('更新に失敗しました: ' + err.message, true)
  } finally {
    btn.disabled = false; btn.textContent = '保存する'
  }
}
window.saveProfile = saveProfile

// ============================================================
//  ユーザー管理（管理者専用）
// ============================================================
async function openUserMgmt() {
  if (currentUser?.role !== 'admin') { showToast('管理者のみ利用可能です', true); return }
  document.getElementById('userMgmtOverlay').classList.add('open')
  await reloadUserList()
}
window.openUserMgmt = openUserMgmt

function closeUserMgmt() {
  document.getElementById('userMgmtOverlay').classList.remove('open')
}
window.closeUserMgmt = closeUserMgmt

async function reloadUserList() {
  const area = document.getElementById('userListArea')
  area.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">読み込み中…</div>'
  try {
    const { data: users, error } = await supabase.rpc('get_all_users')
    if (error) throw error
    if (!users || users.length === 0) {
      area.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">ユーザーがいません</div>'
      return
    }
    area.innerHTML = `<div class="user-list">${users.map(userRowHtml).join('')}</div>`
    // ボタンにイベント割り当て
    area.querySelectorAll('[data-userid]').forEach(btn => {
      btn.addEventListener('click', () => openEditUser(btn.dataset.userid, users))
    })
  } catch(err) {
    area.innerHTML = `<div style="text-align:center;color:#dc2626;padding:20px;">読み込み失敗: ${err.message}</div>`
  }
}

function userRowHtml(u) {
  const teamCls  = teamBgClass(u.team)
  const teamLbl  = u.team || '?'
  const isSelf   = u.id === currentUser?.id
  const roleClass = u.role === 'admin' ? 'admin' : 'viewer'
  const roleLabel = u.role === 'admin' ? '管理者' : '閲覧者'
  return `
    <div class="user-row">
      <div class="user-row-avatar" style="background:${avatarColor(u.team)}">${teamLbl}</div>
      <div class="user-row-info">
        <div class="user-row-name">${esc(u.name || '(名前未設定)')} ${isSelf ? '<span style="font-size:10px;color:#94a3b8;">(自分)</span>' : ''}</div>
        <div class="user-row-email">${esc(u.email)}</div>
      </div>
      <div class="user-row-badges">
        <span class="role-badge ${roleClass}">${roleLabel}</span>
      </div>
      <button class="btn-user-edit" data-userid="${u.id}">編集</button>
    </div>`
}

function openEditUser(userId, users) {
  const u = users.find(x => x.id === userId)
  if (!u) return
  editingUserId   = userId
  editUserTeamSel = u.team || ''
  editUserRoleSel = u.role || 'viewer'

  document.getElementById('editUserTitle').textContent = `${esc(u.name || u.email)} を編集`
  document.getElementById('editUserName').value = u.name || ''

  // チームセレクタ
  document.querySelectorAll('#editUserOverlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === editUserTeamSel) el.classList.add('sel-' + editUserTeamSel)
  })
  // 権限セレクタ
  document.querySelectorAll('.role-opt').forEach(el => {
    el.className = 'role-opt'
    if (el.dataset.role === editUserRoleSel) el.classList.add('sel-' + editUserRoleSel)
  })

  document.getElementById('editUserOverlay').classList.add('open')
}

function closeEditUser() {
  document.getElementById('editUserOverlay').classList.remove('open')
  editingUserId = null
}
window.closeEditUser = closeEditUser

function selectEditUserTeam(t) {
  editUserTeamSel = t
  document.querySelectorAll('#editUserOverlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === t) el.classList.add('sel-' + t)
  })
}
window.selectEditUserTeam = selectEditUserTeam

function selectEditUserRole(r) {
  editUserRoleSel = r
  document.querySelectorAll('.role-opt').forEach(el => {
    el.className = 'role-opt'
    if (el.dataset.role === r) el.classList.add('sel-' + r)
  })
}
window.selectEditUserRole = selectEditUserRole

async function saveUserEdit() {
  if (!editingUserId) return
  const name = document.getElementById('editUserName').value.trim()
  const btn  = document.getElementById('btnEditUserSave')
  btn.disabled = true; btn.textContent = '保存中…'
  try {
    const { error } = await supabase.from('profiles')
      .update({ name, team: editUserTeamSel, role: editUserRoleSel })
      .eq('id', editingUserId)
    if (error) throw error
    // 自分自身を編集した場合はヘッダーも更新
    if (editingUserId === currentUser?.id) {
      currentUser.name = name
      currentUser.team = editUserTeamSel
      currentUser.role = editUserRoleSel
      updateHeaderUser()
    }
    closeEditUser()
    await reloadUserList()
    showToast('ユーザーを更新しました')
  } catch(err) {
    showToast('更新に失敗しました: ' + err.message, true)
  } finally {
    btn.disabled = false; btn.textContent = '保存する'
  }
}
window.saveUserEdit = saveUserEdit

// ============================================================
//  ユーザー作成（管理者専用）
// ============================================================
function openCreateUser() {
  createUserTeamSel = ''
  createUserRoleSel = 'viewer'
  document.getElementById('createUserName').value     = ''
  document.getElementById('createUserEmail').value    = ''
  document.getElementById('createUserPassword').value = ''
  document.querySelectorAll('#createUserOverlay .team-opt').forEach(el => el.className = 'team-opt')
  document.querySelectorAll('#createUserOverlay .role-opt').forEach(el => {
    el.className = 'role-opt'
    if (el.dataset.role === 'viewer') el.classList.add('sel-viewer')
  })
  document.getElementById('createUserOverlay').classList.add('open')
  setTimeout(() => document.getElementById('createUserName').focus(), 80)
}
window.openCreateUser = openCreateUser

function closeCreateUser() {
  document.getElementById('createUserOverlay').classList.remove('open')
}
window.closeCreateUser = closeCreateUser

function selectCreateUserTeam(t) {
  createUserTeamSel = t
  document.querySelectorAll('#createUserOverlay .team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === t) el.classList.add('sel-' + t)
  })
}
window.selectCreateUserTeam = selectCreateUserTeam

function selectCreateUserRole(r) {
  createUserRoleSel = r
  document.querySelectorAll('#createUserOverlay .role-opt').forEach(el => {
    el.className = 'role-opt'
    if (el.dataset.role === r) el.classList.add('sel-' + r)
  })
}
window.selectCreateUserRole = selectCreateUserRole

async function doCreateUser() {
  const name     = document.getElementById('createUserName').value.trim()
  const email    = document.getElementById('createUserEmail').value.trim()
  const password = document.getElementById('createUserPassword').value

  if (!name)                { showToast('氏名を入力してください', true); return }
  if (!email)               { showToast('メールアドレスを入力してください', true); return }
  if (password.length < 6)  { showToast('パスワードは6文字以上で設定してください', true); return }

  const btn = document.getElementById('btnCreateUserSave')
  btn.disabled = true; btn.textContent = '作成中…'

  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('セッションが切れています')

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ email, password, name, team: createUserTeamSel, role: createUserRoleSel })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || '作成に失敗しました')

    closeCreateUser()
    await reloadUserList()
    showToast('ユーザーを作成しました')
  } catch(err) {
    showToast('作成に失敗しました: ' + err.message, true)
  } finally {
    btn.disabled = false; btn.textContent = '作成する'
  }
}
window.doCreateUser = doCreateUser

// ============================================================
//  Excel一括取り込み（管理者専用）
// ============================================================
function excelDateToYYYYMM(val) {
  if (!val) return ''
  if (typeof val === 'number') {
    const date = new Date((val - 25569) * 86400 * 1000)
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }
  const s = String(val).trim()
  const match = s.match(/(\d{4})[\/\-](\d{1,2})/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}`
  return ''
}

function parseExcelRows(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const rows = []
  for (let i = 1; i < data.length; i++) {
    const row = data[i]
    const name = String(row[4] || '').trim()
    if (!name) continue
    const release = excelDateToYYYYMM(row[0])
    const rawTeam = String(row[5] || '').trim().toUpperCase()
    const team    = ['A', 'B', 'C'].includes(rawTeam) ? rawTeam : ''
    const person  = String(row[6] || '').trim()
    const price   = row[7] !== '' ? String(row[7]) : ''
    const bct     = String(row[10] || '').trim()
    let box = '', ctn = ''
    if (bct.includes('*')) {
      const parts = bct.split('*')
      const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10)
      if (!isNaN(a)) box = String(a)
      if (!isNaN(a) && !isNaN(b)) ctn = String(a * b)
    }
    rows.push({ name, release, team, person, price, box, ctn })
  }
  return rows
}

function renderImportPreview(rows) {
  const preview = document.getElementById('importPreview')
  if (!rows.length) {
    preview.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:16px 0;">取り込める商品が見つかりませんでした</div>'
    updateImportBtn(); return
  }
  preview.innerHTML = `
    <div style="margin-top:14px;">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;">${rows.length}件の商品が見つかりました</div>
      <div class="import-preview-wrap">
        <table class="import-preview-table">
          <thead><tr>
            <th>商品名</th><th>発売月</th><th>チーム</th><th>担当</th><th>価格</th><th>BOX</th><th>CTN</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td>${esc(r.name)}</td>
              <td>${r.release || '<span style="color:#ef4444">—</span>'}</td>
              <td>${r.team || '—'}</td>
              <td>${esc(r.person) || '—'}</td>
              <td>${r.price ? '¥' + Number(r.price).toLocaleString() : '—'}</td>
              <td>${r.box || '—'}</td>
              <td>${r.ctn || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`
  updateImportBtn()
}

function updateImportBtn() {
  const btn = document.getElementById('btnDoImport')
  if (!btn) return
  const ok = importRows.length > 0 && importCatSel > 0
  btn.disabled = !ok
  btn.textContent = ok ? `取り込む（${importRows.length}件）` : '取り込む'
}

function openImportModal() {
  if (currentUser?.role !== 'admin') { showToast('管理者のみ利用可能です', true); return }
  importCatSel = 0; importRows = []
  document.getElementById('importFileInput').value = ''
  document.getElementById('importDropZone').classList.remove('has-file')
  document.getElementById('importDropZone').querySelector('.import-drop-text').textContent =
    'Excelファイルをドロップ、またはクリックして選択'
  document.getElementById('importCatArea').style.display = 'none'
  document.getElementById('importPreview').innerHTML = ''
  document.querySelectorAll('#importOverlay .cat-opt').forEach(el => el.className = 'cat-opt')
  updateImportBtn()
  document.getElementById('importOverlay').classList.add('open')
}
window.openImportModal = openImportModal

function closeImportModal() {
  document.getElementById('importOverlay').classList.remove('open')
}
window.closeImportModal = closeImportModal

function selectImportCat(c) {
  importCatSel = c
  document.querySelectorAll('#importOverlay .cat-opt').forEach(el => {
    el.className = 'cat-opt'
    if (Number(el.dataset.cat) === c) el.classList.add('sel-' + c)
  })
  updateImportBtn()
}
window.selectImportCat = selectImportCat

function handleImportFileChange(e) {
  const file = e.target.files[0]
  if (file) handleImportFile(file)
}
window.handleImportFileChange = handleImportFileChange

function handleImportFile(file) {
  const dropZone = document.getElementById('importDropZone')
  const reader = new FileReader()
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      importRows = parseExcelRows(ws)
      const nameText = file.name + `（${importRows.length}件）`
      dropZone.classList.add('has-file')
      dropZone.querySelector('.import-drop-text').textContent = nameText
      document.getElementById('importCatArea').style.display = ''
      renderImportPreview(importRows)
    } catch(err) {
      showToast('ファイルの読み込みに失敗しました: ' + err.message, true)
    }
  }
  reader.readAsArrayBuffer(file)
}

async function doImport() {
  if (!importRows.length) { showToast('取り込む商品がありません', true); return }
  if (!importCatSel) { showToast('案内区分を選択してください', true); return }

  const btn = document.getElementById('btnDoImport')
  btn.disabled = true; btn.textContent = '取り込み中…'

  try {
    const baseOrder = products.length
    const newProducts = importRows.map((r, i) => ({
      id:         uid(),
      name:       r.name,
      release:    r.release,
      price:      r.price,
      box:        r.box,
      ctn:        r.ctn,
      person:     r.person,
      team:       r.team,
      cat:        importCatSel,
      sort_order: baseOrder + i,
    }))
    const { error } = await supabase.from('products').insert(newProducts)
    if (error) throw error
    products.push(...newProducts)
    closeImportModal()
    buildTimeline()
    showToast(`${newProducts.length}件の商品を取り込みました`)
  } catch(err) {
    showToast('取り込みに失敗しました: ' + err.message, true)
    btn.disabled = false
    updateImportBtn()
  }
}
window.doImport = doImport

// ============================================================
//  ドラッグ & ドロップ（並び順変更対応）
// ============================================================
let drag = null

function attachTileDragListeners() {
  document.querySelectorAll('.product-tile').forEach(tile => {
    tile.addEventListener('mousedown', onTileMouseDown)
  })
}

function onTileMouseDown(e) {
  if (e.button !== 0) return
  if (document.querySelector('.overlay.open')) return
  e.preventDefault()
  const tile = e.currentTarget
  const rect = tile.getBoundingClientRect()
  drag = {
    id: tile.dataset.id, tile, ghost: null,
    startX: e.clientX, startY: e.clientY,
    offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
    moved: false, srcRect: rect, dropArea: null, insertBeforeId: undefined,
  }
}

function showInsertLine(refTile, position) {
  removeInsertLine()
  const r = refTile.getBoundingClientRect()
  const line = document.createElement('div')
  line.id = 'insert-line'
  Object.assign(line.style, {
    position: 'fixed', left: r.left + 'px',
    top: (position === 'before' ? r.top - 3 : r.bottom + 1) + 'px',
    width: r.width + 'px', height: '3px',
    background: '#3b82f6', borderRadius: '2px',
    pointerEvents: 'none', zIndex: '9998',
    boxShadow: '0 0 8px rgba(59,130,246,0.7)',
  })
  document.body.appendChild(line)
}

function removeInsertLine() {
  const el = document.getElementById('insert-line')
  if (el) el.remove()
}

document.addEventListener('mousemove', function(e) {
  if (!drag) return
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY

  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) {
    if (currentUser?.role !== 'admin') return
    drag.moved = true
    const p = products.find(x => x.id === drag.id)
    const ghost = drag.tile.cloneNode(true)
    ghost.className = `product-tile cat-${p?.cat ?? 1} drag-ghost`
    Object.assign(ghost.style, { width: drag.srcRect.width + 'px', left: drag.srcRect.left + 'px', top: drag.srcRect.top + 'px', margin: '0' })
    document.body.appendChild(ghost)
    drag.ghost = ghost
    drag.tile.classList.add('is-dragging')
    document.body.style.cursor = 'grabbing'
  }
  if (!drag.moved) return

  drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px'
  drag.ghost.style.top  = (e.clientY - drag.offsetY) + 'px'

  drag.ghost.style.display = 'none'
  const el = document.elementFromPoint(e.clientX, e.clientY)
  drag.ghost.style.display = ''

  const area = el ? el.closest('.tile-area') : null
  document.querySelectorAll('.tile-area').forEach(a => a.classList.remove('drag-over'))
  removeInsertLine()
  drag.dropArea = null; drag.insertBeforeId = undefined
  if (!area) return

  area.classList.add('drag-over'); drag.dropArea = area
  const siblings = [...area.querySelectorAll('.product-tile:not(.is-dragging)')]
  if (!siblings.length) { drag.insertBeforeId = null; return }

  let decided = false
  for (let i = 0; i < siblings.length; i++) {
    const t = siblings[i], r = t.getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) {
      drag.insertBeforeId = t.dataset.id; showInsertLine(t, 'before'); decided = true; break
    }
    if (i === siblings.length - 1) {
      drag.insertBeforeId = null; showInsertLine(t, 'after'); decided = true
    }
  }
  if (!decided) drag.insertBeforeId = null

  const tl = document.getElementById('timeline'), tlRect = tl.getBoundingClientRect()
  const EDGE = 60, SPEED = 14
  if (e.clientX < tlRect.left + EDGE)  tl.scrollLeft -= SPEED
  else if (e.clientX > tlRect.right - EDGE) tl.scrollLeft += SPEED
})

document.addEventListener('mouseup', async function(e) {
  if (!drag) return
  const { id, tile, ghost, moved, dropArea, insertBeforeId } = drag
  drag = null
  if (ghost) ghost.remove()
  tile.classList.remove('is-dragging')
  document.body.style.cursor = ''
  document.querySelectorAll('.tile-area').forEach(a => a.classList.remove('drag-over'))
  removeInsertLine()

  if (!moved) { openEditModal(id); return }
  if (!dropArea || insertBeforeId === undefined) return

  const areaId = dropArea.id
  const m4 = areaId.match(/^area4-(.+)$/)
  const m3 = areaId.match(/^area3-(.+)$/)
  if (!m4 && !m3) return

  const newRelease = m4 ? m4[1] : m3[1]
  const colType    = m4 ? 4 : 3
  const srcIdx = products.findIndex(x => x.id === id)
  if (srcIdx < 0) return

  const p = { ...products[srcIdx] }
  p.release = newRelease
  p.cat = colType === 4 ? 1 : (p.cat === 1 ? 2 : p.cat)

  products.splice(srcIdx, 1)
  let insertIdx
  if (insertBeforeId === null) {
    const isGroup = x => x.release === newRelease && (colType === 4 ? x.cat === 1 : x.cat === 2 || x.cat === 3)
    let lastIdx = -1
    products.forEach((x, i) => { if (isGroup(x)) lastIdx = i })
    insertIdx = lastIdx >= 0 ? lastIdx + 1 : products.length
  } else {
    insertIdx = products.findIndex(x => x.id === insertBeforeId)
    if (insertIdx < 0) insertIdx = products.length
  }
  products.splice(insertIdx, 0, p)
  products.forEach((x, i) => { x.sort_order = i })

  buildTimeline()
  try {
    await dbSyncOrder()
    await dbUpsert(p)
    showToast('商品を移動しました')
  } catch(err) {
    showToast('同期に失敗しました: ' + err.message, true)
    products = await dbLoadAll()
    buildTimeline()
  }
})

// ============================================================
//  スクロールナビ
// ============================================================
document.getElementById('btnLeft').onclick = () =>
  document.getElementById('timeline').scrollBy({ left: -310, behavior: 'smooth' })
document.getElementById('btnRight').onclick = () =>
  document.getElementById('timeline').scrollBy({ left:  310, behavior: 'smooth' })

document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open')
  })
})

// Excel ドロップゾーンのドラッグ&ドロップ
const importDropZone = document.getElementById('importDropZone')
importDropZone.addEventListener('dragover', e => {
  e.preventDefault()
  importDropZone.classList.add('drag-hover')
})
importDropZone.addEventListener('dragleave', () => {
  importDropZone.classList.remove('drag-hover')
})
importDropZone.addEventListener('drop', e => {
  e.preventDefault()
  importDropZone.classList.remove('drag-hover')
  const file = e.dataTransfer.files[0]
  if (file) handleImportFile(file)
})

function updateChipByScroll() {
  const tl = document.getElementById('timeline')
  const tlL = tl.getBoundingClientRect().left
  let closestKey = null, minDist = Infinity
  MONTHS.forEach(mo => {
    const el = document.getElementById('col-' + mo.key)
    if (!el) return
    const d = Math.abs(el.getBoundingClientRect().left - tlL)
    if (d < minDist) { minDist = d; closestKey = mo.key }
  })
  if (closestKey) setActiveChip(closestKey)
}
document.getElementById('timeline').addEventListener('scroll', updateChipByScroll, { passive: true })

// ============================================================
//  データ初期化（ログイン後に呼ぶ）
// ============================================================
async function initData() {
  buildMonthNav()
  buildReleaseSelect()
  setLoading(true)
  try {
    products = await dbLoadAll()
  } catch(err) {
    products = []
    showToast('データの読み込みに失敗しました: ' + err.message, true)
  } finally {
    // 成功・失敗どちらでも必ずタイムラインを描画
    buildTimeline()
    setTimeout(() => scrollToInitialPosition(), 120)
    setLoading(false)
  }
}

// ============================================================
//  Auth ステート監視 & 起動
// ============================================================
supabase.auth.onAuthStateChange((event, session) => {
  if (session && !appReady) {
    appReady = true

    // セッション情報だけで即座に画面表示
    currentUser = { id: session.user.id, email: session.user.email, role: 'viewer' }
    updateHeaderUser()
    showMainApp()

    // データ読み込みとプロフィール取得は await せず独立して実行
    initData()

    loadCurrentUser(session.user).then(user => {
      if (user) {
        currentUser = user
        updateHeaderUser()
        buildTimeline()  // ロール確定後にタイムラインを再描画
      }
    }).catch(() => {})

  } else if (session && appReady) {
    // プロフィール更新などで再発火した場合
    loadCurrentUser(session.user).then(user => {
      if (user) currentUser = user
      updateHeaderUser()
    }).catch(() => {})

  } else if (!session) {
    appReady = false
    currentUser = null
    showLoginScreen()
  }
})

// Enterキーでログイン
document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin()
})
document.getElementById('loginEmail').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin()
})
