import { createClient } from '@supabase/supabase-js'
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
let products    = []
let editingId   = null
let selectedCat  = null
let selectedTeam = null

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

// ============================================================
//  今月
// ============================================================
const NOW = new Date()
const TODAY_KEY = `${NOW.getFullYear()}-${String(NOW.getMonth()+1).padStart(2,'0')}`

// ============================================================
//  ローディング制御
// ============================================================
function setLoading(on) {
  document.getElementById('loadingBar').classList.toggle('active', on)
  const btn = document.getElementById('btnAddMain')
  if (btn) btn.disabled = on
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

// ============================================================
//  タイムライン描画
// ============================================================
function buildTimeline() {
  const tl = document.getElementById('timeline')
  tl.innerHTML = ''
  MONTHS.forEach(mo => {
    const key = mo.key
    const prods4 = products.filter(p => p.release === key && p.cat === 1)
    const prods3 = products.filter(p => p.release === key && (p.cat === 2 || p.cat === 3))

    const col = document.createElement('div')
    col.className = 'month-column'
    col.id = 'col-' + key
    col.innerHTML = `
      <div class="month-column-header ${key === TODAY_KEY ? 'is-today' : ''}">
        ${key === TODAY_KEY ? '<div class="today-dot"></div>' : ''}
        <div class="month-label">${mo.m}月 <span class="year-label">${mo.y}年</span></div>
        <div class="month-tag">発売月</div>
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
          <button class="btn-in-col" data-release="${key}" data-defaultcat="1">＋ 追加</button>
        </div>
        <div class="sub-col">
          <div class="sub-col-header type-3">
            <div class="sub-col-title">②③ 3か月前案内</div>
            <div class="sub-col-announce">${announceLabel(key, 3)}（未案内）</div>
          </div>
          <div class="tile-area" id="area3-${key}">
            ${prods3.length ? prods3.map(tileHtml).join('') : emptyState()}
          </div>
          <button class="btn-in-col" data-release="${key}" data-defaultcat="23">＋ 追加</button>
        </div>
      </div>`
    tl.appendChild(col)
  })

  // btn-in-col クリック
  tl.querySelectorAll('.btn-in-col').forEach(btn => {
    btn.addEventListener('click', () => {
      openAddModal(btn.dataset.release, btn.dataset.defaultcat === '1' ? 1 : 23)
    })
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
  const price   = p.price  ? `¥${Number(p.price).toLocaleString()}` : '—'
  const box     = p.box    || '—'
  const ctn     = p.ctn    || '—'
  const person  = esc(p.person || '—')
  const teamCls = p.team   ? `team-${p.team}` : 'team-none'
  const teamLbl = p.team   || '?'
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
        <span class="tile-price">${price}</span>
      </div>
    </div>`
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ============================================================
//  月セレクト
// ============================================================
function buildReleaseSelect() {
  const sel = document.getElementById('fRelease')
  sel.innerHTML = ''
  MONTHS.forEach(mo => {
    const opt = document.createElement('option')
    opt.value = mo.key
    opt.textContent = monthLabel(mo.key)
    sel.appendChild(opt)
  })
}

// ============================================================
//  Supabase CRUD
// ============================================================
async function dbLoadAll() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
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

// sort_order を products 配列のインデックスに基づいて一括同期
async function dbSyncOrder() {
  if (products.length === 0) return
  const updates = products.map((p, i) => ({ id: p.id, sort_order: i }))
  const { error } = await supabase.from('products').upsert(updates)
  if (error) throw error
}

// ============================================================
//  モーダル
// ============================================================
function openAddModal(releaseKey, defaultCat) {
  editingId = null
  resetForm()
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
  resetForm()
  document.getElementById('modalTitle').textContent = '商品を編集'
  document.getElementById('btnDelete').style.display = 'block'
  document.getElementById('fName').value    = p.name
  document.getElementById('fRelease').value = p.release
  document.getElementById('fPrice').value   = p.price  || ''
  document.getElementById('fBox').value     = p.box    || ''
  document.getElementById('fCtn').value     = p.ctn    || ''
  document.getElementById('fPerson').value  = p.person || ''
  if (p.team) selectTeam(p.team)
  selectCat(p.cat)
  document.getElementById('overlay').classList.add('open')
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open')
  editingId = null; selectedCat = null; selectedTeam = null
}
window.closeModal = closeModal

function resetForm() {
  ;['fName','fPrice','fBox','fCtn','fPerson'].forEach(id => {
    const el = document.getElementById(id)
    el.value = ''
    el.classList.remove('error')
  })
  document.getElementById('fRelease').value = TODAY_KEY
  selectedCat = null; selectedTeam = null
  document.querySelectorAll('.cat-opt').forEach(el => el.className = 'cat-opt')
  document.querySelectorAll('.team-opt').forEach(el => el.className = 'team-opt')
}

function selectCat(n) {
  selectedCat = n
  document.querySelectorAll('.cat-opt').forEach(el => {
    el.className = 'cat-opt'
    if (Number(el.dataset.cat) === n) el.classList.add('sel-' + n)
  })
}
window.selectCat = selectCat

function selectTeam(t) {
  selectedTeam = t
  document.querySelectorAll('.team-opt').forEach(el => {
    el.className = 'team-opt'
    if (el.dataset.team === t) el.classList.add('sel-' + t)
  })
}
window.selectTeam = selectTeam

async function saveProduct() {
  const name = document.getElementById('fName').value.trim()
  if (!name) {
    document.getElementById('fName').classList.add('error')
    showToast('商品名を入力してください', true); return
  }
  if (!selectedCat) { showToast('案内区分を選択してください', true); return }

  // 新規の場合は現在の末尾に追加
  const existingSortOrder = editingId
    ? (products.find(x => x.id === editingId)?.sort_order ?? products.length)
    : products.length

  const p = {
    id:         editingId || uid(),
    name,
    release:    document.getElementById('fRelease').value,
    price:      document.getElementById('fPrice').value,
    box:        document.getElementById('fBox').value,
    ctn:        document.getElementById('fCtn').value,
    person:     document.getElementById('fPerson').value.trim(),
    team:       selectedTeam || '',
    cat:        selectedCat,
    sort_order: existingSortOrder,
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
    closeModal()
    buildTimeline()
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
    // sort_order を再整理
    products.forEach((p, i) => { p.sort_order = i })
    await dbSyncOrder()
    closeModal()
    buildTimeline()
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
  if (btn) {
    btn.disabled = on
    btn.textContent = on ? '保存中…' : '保存する'
  }
}

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
  if (document.getElementById('overlay').classList.contains('open')) return
  e.preventDefault()
  const tile = e.currentTarget
  const rect = tile.getBoundingClientRect()
  drag = {
    id: tile.dataset.id,
    tile,
    ghost: null,
    startX: e.clientX, startY: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    moved: false,
    srcRect: rect,
    dropArea: null,
    insertBeforeId: undefined,
  }
}

// ---- 挿入ライン ----
function showInsertLine(refTile, position) {
  removeInsertLine()
  const r = refTile.getBoundingClientRect()
  const line = document.createElement('div')
  line.id = 'insert-line'
  const y = position === 'before' ? r.top - 3 : r.bottom + 1
  Object.assign(line.style, {
    position: 'fixed',
    left: r.left + 'px', top: y + 'px',
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

  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY

  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) {
    drag.moved = true
    const p = products.find(x => x.id === drag.id)
    const ghost = drag.tile.cloneNode(true)
    ghost.className = `product-tile cat-${p?.cat ?? 1} drag-ghost`
    Object.assign(ghost.style, {
      width: drag.srcRect.width + 'px',
      left:  drag.srcRect.left  + 'px',
      top:   drag.srcRect.top   + 'px',
      margin: '0',
    })
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
  drag.dropArea = null
  drag.insertBeforeId = undefined

  if (!area) return

  area.classList.add('drag-over')
  drag.dropArea = area

  const siblings = [...area.querySelectorAll('.product-tile:not(.is-dragging)')]
  if (siblings.length === 0) { drag.insertBeforeId = null; return }

  let decided = false
  for (let i = 0; i < siblings.length; i++) {
    const t = siblings[i]
    const r = t.getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) {
      drag.insertBeforeId = t.dataset.id
      showInsertLine(t, 'before')
      decided = true; break
    }
    if (i === siblings.length - 1) {
      drag.insertBeforeId = null
      showInsertLine(t, 'after')
      decided = true
    }
  }
  if (!decided) drag.insertBeforeId = null

  // タイムライン端での自動スクロール
  const tl = document.getElementById('timeline')
  const tlRect = tl.getBoundingClientRect()
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

  // 配列から取り除いて挿入
  products.splice(srcIdx, 1)

  let insertIdx
  if (insertBeforeId === null) {
    const isGroup = x => x.release === newRelease &&
      (colType === 4 ? x.cat === 1 : (x.cat === 2 || x.cat === 3))
    let lastIdx = -1
    products.forEach((x, i) => { if (isGroup(x)) lastIdx = i })
    insertIdx = lastIdx >= 0 ? lastIdx + 1 : products.length
  } else {
    insertIdx = products.findIndex(x => x.id === insertBeforeId)
    if (insertIdx < 0) insertIdx = products.length
  }

  products.splice(insertIdx, 0, p)

  // sort_order を配列インデックスに揃えて DB 同期
  products.forEach((x, i) => { x.sort_order = i })

  buildTimeline()

  try {
    await dbSyncOrder()
    // 移動した商品自体の release/cat も更新
    await dbUpsert(p)
    showToast('商品を移動しました')
  } catch(err) {
    showToast('同期に失敗しました: ' + err.message, true)
    // 失敗時は DB から再読み込みして整合性を回復
    products = await dbLoadAll()
    buildTimeline()
  }
})

// ============================================================
//  ユーティリティ
// ============================================================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

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
//  スクロールナビ
// ============================================================
document.getElementById('btnLeft').onclick = () =>
  document.getElementById('timeline').scrollBy({ left: -310, behavior: 'smooth' })
document.getElementById('btnRight').onclick = () =>
  document.getElementById('timeline').scrollBy({ left:  310, behavior: 'smooth' })

document.getElementById('overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal()
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
//  初期化
// ============================================================
async function init() {
  buildMonthNav()
  buildReleaseSelect()
  setLoading(true)
  try {
    products = await dbLoadAll()
    buildTimeline()
    setTimeout(() => jumpToMonth(TODAY_KEY), 120)
  } catch(err) {
    showToast('データの読み込みに失敗しました: ' + err.message, true)
    console.error(err)
  } finally {
    setLoading(false)
  }
}

init()
