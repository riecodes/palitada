// palitada picker, injected into dev pages by the palitada proxy.
// Alt+P (or the pill) toggles it. Click an element, then Ref / Edit / Delete / Comment.
const API = '/__palitada/'
const post = (route, body) => fetch(API + route, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) }))

const host = document.createElement('palitada-root')
const root = host.attachShadow({ mode: 'open' })
root.innerHTML = `<style>
:host { all: initial }
* { box-sizing: border-box; font: 13px/1.4 system-ui, sans-serif }
.box { position: fixed; pointer-events: none; z-index: 2147483646; border-radius: 3px }
.hover { outline: 2px dashed #2563eb; background: rgb(37 99 235 / .08) }
.sel { outline: 2px solid #2563eb }
.bar, .panel, .pill, .toasts, .editor { position: fixed; z-index: 2147483647 }
.bar { display: flex; gap: 4px; align-items: center; padding: 4px; background: #111; color: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / .3); max-width: calc(100vw - 16px); flex-wrap: wrap }
.where { padding: 0 6px; color: #cbd5e1; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
button { cursor: pointer; border: 0; border-radius: 6px; padding: 5px 9px; background: #262626; color: #fff }
button:hover { background: #404040 }
button:disabled { opacity: .4; cursor: default }
button.warn { background: #b91c1c }
.panel { width: 340px; max-width: calc(100vw - 16px); padding: 10px; background: #fff; color: #111; border-radius: 10px; box-shadow: 0 8px 28px rgb(0 0 0 / .25) }
.panel .t { font-weight: 600; margin-bottom: 6px }
.panel textarea { width: 100%; min-height: 70px; padding: 6px; border: 1px solid #ccc; border-radius: 6px; resize: vertical; color: #111; background: #fff }
.panel .row { display: flex; gap: 8px; align-items: center; margin-top: 6px }
.panel .hint { color: #666; font-size: 12px }
.panel .c { display: block; width: 100%; text-align: left; margin: 4px 0; background: #f4f4f5; color: #111 }
.panel .c:hover { background: #e4e4e7 }
.panel .c small { display: block; color: #555; font: 12px ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.editor { padding: 0; margin: 0; border: 0; outline: 2px solid #16a34a; border-radius: 3px; resize: none; overflow: hidden }
.pill { right: 8px; top: 50%; padding: 7px 12px; border-radius: 999px; background: #111; color: #fff; box-shadow: 0 2px 10px rgb(0 0 0 / .3); opacity: .55 }
.pill.on { background: #2563eb; opacity: 1 }
.toasts { left: 50%; bottom: 16px; transform: translateX(-50%); display: grid; gap: 6px; justify-items: center; pointer-events: none }
.toast { pointer-events: auto; display: flex; gap: 10px; align-items: center; padding: 8px 12px; background: #111; color: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / .3); max-width: min(560px, calc(100vw - 32px)) }
.toast.err { background: #b91c1c }
[hidden] { display: none !important }
</style>
<div class="box hover" hidden></div><div class="box sel" hidden></div>
<div class="bar" hidden><span class="where"></span>
<button data-a="ref" title="Copy a reference for Claude">Ref</button><button data-a="edit">Edit</button><button data-a="delete">Delete</button><button data-a="comment">Comment</button><button data-a="close" title="Esc">✕</button></div>
<div class="panel" hidden></div>
<textarea class="editor" hidden spellcheck="false"></textarea>
<div class="toasts"></div>
<button class="pill" title="Alt+P">palitada</button>`
document.documentElement.appendChild(host)

const $ = s => root.querySelector(s)
const hoverBox = $('.hover'), selBox = $('.sel'), bar = $('.bar'), where = $('.where'), panel = $('.panel'), editor = $('.editor'), pill = $('.pill')
let active = false, selected = null, info = null, mode = null

// ---------- element facts ----------

const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim()
function firstText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) if (n.nodeValue.trim().length > 1) return n.nodeValue.replace(/\s+/g, ' ').trim()
  return ''
}
const SKIP = /Router|Boundary|Handler|Provider|Context|Template|Overlay|Suspense|Segment|Redirect|NotFound|HTTPAccess|Loading|HotReload|DevRoot|ServerRoot|^(Html|Head|Body|Root|Fragment)$/
function components(el) {
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  const out = [], add = n => { if (n && /^[A-Z]/.test(n) && !SKIP.test(n) && !out.includes(n)) out.push(n) }
  for (let f = key && el[key]; f && out.length < 10; f = f.return) {
    const t = f.type
    add(typeof t === 'function' ? t.displayName || t.name : t?.displayName || t?.render?.displayName || t?.render?.name || t?.type?.name)
    for (const d of f._debugInfo || []) add(d?.name) // server components (React 19 dev)
  }
  return out
}
function hints(el) {
  const a = el.closest('[data-astro-source-file]')
  // Bilingual sites that render both languages as span.lang-fil + span.lang-en: say which half was clicked.
  const lang = el.closest('.lang-fil, .lang-en')?.className.match(/lang-(fil|en)/)[1]
  return { components: components(el), astroFile: a?.getAttribute('data-astro-source-file'), astroLoc: a?.getAttribute('data-astro-source-loc'), lang }
}
function selector(el) {
  const parts = []
  for (; el && el.nodeType === 1 && el !== document.documentElement; el = el.parentElement) {
    if (el.id && !/[:«»]|\d{4,}/.test(el.id)) { parts.unshift('#' + CSS.escape(el.id)); break }
    const sibs = el.parentElement ? [...el.parentElement.children].filter(c => c.localName === el.localName) : []
    parts.unshift(sibs.length > 1 ? `${el.localName}:nth-of-type(${sibs.indexOf(el) + 1})` : el.localName)
  }
  return parts.join(' > ')
}
function bg(el) {
  for (; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor
    if (c && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) return c
  }
  return '#fff'
}
// Screenshot the surrounding block (at least 480x200, at most 1.5 screens tall) with the
// element outlined in red, so Claude sees what it is and where.
async function snap(el) {
  try {
    const { domToCanvas } = await import(API + 'shot.js')
    let box = el
    for (let r = box.getBoundingClientRect(); (r.width < 480 || r.height < 200) && box.parentElement && box !== document.body; r = box.getBoundingClientRect()) {
      if (box.parentElement.getBoundingClientRect().height > innerHeight * 1.5) break
      box = box.parentElement
    }
    const scale = Math.min(2, devicePixelRatio || 1), a = box.getBoundingClientRect(), b = el.getBoundingClientRect()
    const timeout = new Promise(r => setTimeout(() => r(null), 8000))
    const canvas = await Promise.race([domToCanvas(box, { scale, backgroundColor: bg(box) }), timeout])
    if (!canvas) return null
    if (box !== el) {
      const g = canvas.getContext('2d')
      g.strokeStyle = '#e11d48'; g.lineWidth = 3 * scale
      g.strokeRect((b.left - a.left - 3) * scale, (b.top - a.top - 3) * scale, (b.width + 6) * scale, (b.height + 6) * scale)
    }
    return canvas.toDataURL('image/png')
  } catch { return null }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ---------- ui ----------

function place(box, el) {
  const r = el.getBoundingClientRect()
  Object.assign(box.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' })
  box.hidden = false
}
// Bar goes under the selection, panels under the bar; flip above when there is no room.
function placeNear(node) {
  const r = (node === bar ? selected : bar).getBoundingClientRect(), n = node.getBoundingClientRect()
  node.style.top = (r.bottom + 6 + n.height < innerHeight ? r.bottom + 6 : Math.max(8, r.top - n.height - 6)) + 'px'
  node.style.left = Math.max(8, Math.min(r.left, innerWidth - n.width - 8)) + 'px'
}
function reposition() {
  if (!selected) return
  if (!selected.isConnected) return deselect()
  place(selBox, selected); placeNear(bar)
  if (!panel.hidden) placeNear(panel)
}
function toast(msg, err, action) {
  const t = document.createElement('div')
  t.className = 'toast' + (err ? ' err' : '')
  t.textContent = msg
  if (action) {
    const b = document.createElement('button')
    b.textContent = action.label
    b.onclick = () => { t.remove(); action.run() }
    t.append(b)
  }
  $('.toasts').append(t)
  setTimeout(() => t.remove(), err || action ? 9000 : 4000)
}
function setActive(on) {
  active = on
  pill.classList.toggle('on', on)
  if (!on) { deselect(); hoverBox.hidden = true }
}
function closeMode() {
  mode = null; editor.hidden = true; panel.hidden = true
  const del = bar.querySelector('[data-a=delete]')
  del.textContent = 'Delete'; del.classList.remove('warn')
}
function deselect() { closeMode(); selected = null; info = null; selBox.hidden = true; bar.hidden = true }

async function select(el) {
  closeMode()
  selected = el; info = null; hoverBox.hidden = true
  place(selBox, el)
  bar.querySelector('[data-a=edit]').disabled = !ownText(el)
  where.textContent = `<${el.localName}> finding source...`
  bar.hidden = false; placeNear(bar)
  const r = await post('locate', { text: ownText(el) || firstText(el), hints: hints(el) }).catch(() => null)
  if (selected !== el) return
  info = r
  const chain = r?.components?.map(c => c.name).join(' < ') || ''
  where.textContent = `<${el.localName}> ${r?.source || (chain ? `${chain}${r.note ? ' (text is data?)' : ''}` : 'source unknown')}`
  where.title = chain
  placeNear(bar)
}

function openPanel(html) {
  panel.innerHTML = html
  panel.hidden = false
  placeNear(panel)
}
function choose(cands, note, pick) {
  openPanel('<div class="t"></div>')
  panel.querySelector('.t').textContent = note || 'This text is in several places. Which one?'
  for (const c of cands) {
    const b = document.createElement('button')
    b.className = 'c'
    b.innerHTML = `<b></b><small></small>`
    b.querySelector('b').textContent = `${c.file}:${c.line}`
    b.querySelector('small').textContent = c.snippet
    b.onclick = () => pick(c)
    panel.append(b)
  }
  placeNear(panel)
}

// ---------- actions ----------

async function queue(el, type, extra = {}, id = newId()) {
  const shot = await snap(el)
  return post('item', {
    id, type, ...extra, url: location.href, tag: el.localName, text: ownText(el) || firstText(el),
    selector: selector(el), html: el.outerHTML.slice(0, 1500), hints: hints(el), shot,
  })
}

function refText(el, id) {
  const t = ownText(el) || firstText(el), sep = info?.dir?.includes('\\') ? '\\' : '/'
  const comps = info?.components?.length ? `\ncomponents: ${info.components.map(c => c.at ? `${c.name} (${c.at})` : c.name).join(' < ')}` : ''
  return [
    `[palitada ref] <${el.localName}>${t ? ` "${t.slice(0, 120)}"` : ''}`,
    `source: ${info?.source || 'unknown'}${comps}`,
    `selector: ${selector(el)}`,
    info?.dir && `screenshot: ${info.dir}${sep}shots${sep}${id}.png`,
    `page: ${location.href}`,
  ].filter(Boolean).join('\n')
}

const actions = {
  ref() {
    const el = selected, id = newId(), text = refText(el, id)
    // Copy first, while the click still counts as a user gesture; the screenshot follows.
    navigator.clipboard.writeText(text).then(
      () => toast('Ref copied. Paste it into Claude Code.'),
      () => { openPanel('<div class="t">Copy this ref</div><textarea readonly></textarea>'); panel.querySelector('textarea').value = text })
    queue(el, 'ref', {}, id).then(r => r.status !== 200 ? toast(r.error, true) : r.listening && toast('Your Claude session has the ref too.'))
  },
  edit() {
    const el = selected, r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    closeMode(); mode = 'edit'
    Object.assign(editor.style, {
      top: r.top + 'px', left: r.left + 'px', width: Math.max(r.width, 160) + 'px', height: Math.max(r.height, 28) + 'px',
      font: cs.font, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign, textTransform: cs.textTransform,
      color: cs.color, background: bg(el), padding: cs.padding,
    })
    editor.value = ownText(el)
    editor.hidden = false; editor.focus(); editor.select()
  },
  delete(btn) {
    if (!btn.classList.contains('warn')) { btn.textContent = 'Sure? Delete'; btn.classList.add('warn'); return }
    const el = selected
    deselect()
    queue(el, 'delete').then(r => {
      if (r.status !== 200) return toast(r.error, true)
      el.style.setProperty('display', 'none', 'important')
      toast(`Hidden here. Delete #${r.id} ${r.listening ? 'sent to Claude.' : 'is queued: run /palitada in Claude Code.'}`)
    })
  },
  comment() {
    closeMode(); mode = 'comment'
    openPanel('<div class="t">Comment for Claude</div><textarea placeholder="What should change here?"></textarea><div class="row"><button class="go">Send</button><span class="hint">Enter sends, Shift+Enter new line</span></div>')
    const ta = panel.querySelector('textarea'), el = selected
    const go = async () => {
      const comment = ta.value.trim()
      if (!comment) return
      closeMode()
      const r = await queue(el, 'comment', { comment })
      toast(r.status !== 200 ? r.error : `Comment #${r.id} ${r.listening ? 'sent to Claude.' : 'queued: run /palitada in Claude Code.'}`, r.status !== 200)
      if (selected === el) deselect()
    }
    panel.querySelector('.go').onclick = go
    ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } if (e.key === 'Escape') closeMode() }
    ta.focus()
  },
  close: deselect,
}

async function saveEdit(pick) {
  const el = selected, old = ownText(el), text = editor.value.replace(/\s+/g, ' ').trim()
  if (!text || text === old) return closeMode()
  const r = await post('edit', { text: old, newText: text, hints: hints(el), pick })
  if (r.status === 300) return choose(r.candidates, r.note, c => saveEdit({ file: c.file, index: c.index }))
  if (r.status !== 200) return toast(r.error, true)
  closeMode()
  // Show it now (pages without hot reload); HMR re-renders from source anyway.
  const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim())
  if (nodes.length === 1) nodes[0].nodeValue = nodes[0].nodeValue.replace(nodes[0].nodeValue.trim(), text)
  reposition()
  toast(`Saved to ${r.file}:${r.line}`, false, {
    label: 'Undo',
    run: async () => { const u = await post('undo', {}); toast(u.status === 200 ? `Undone in ${u.file}:${u.line}` : u.error, u.status !== 200) },
  })
}

editor.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
  if (e.key === 'Escape') closeMode()
})
bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) actions[b.dataset.a](b) })
pill.addEventListener('click', () => setActive(!active))

// ---------- page events (capture phase, so the app never sees picker clicks) ----------

const ours = e => e.composedPath().includes(host)
addEventListener('mousemove', e => {
  if (!active || ours(e)) return
  if (e.target === selected) return (hoverBox.hidden = true)
  place(hoverBox, e.target)
}, true)
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
  addEventListener(type, e => {
    if (!active || ours(e)) return
    e.preventDefault(); e.stopImmediatePropagation()
    if (type === 'click') select(e.target)
  }, true)
}
addEventListener('keydown', e => {
  if (e.altKey && e.code === 'KeyP') { e.preventDefault(); return setActive(!active) }
  if (e.key !== 'Escape' || !active) return
  if (mode) closeMode(); else if (selected) deselect(); else setActive(false)
}, true)
addEventListener('scroll', reposition, true)
addEventListener('resize', reposition)
