// End-to-end check against a running proxy: node test.mjs [proxy url] [project root] [backup dir]
// Edits one text in a clean git file, verifies the file, undoes it (byte-equal), then queues a
// comment, a delete and a ref, checks the queue and screenshots, and marks the test items done.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const [url = 'http://localhost:4747/', root = process.cwd(), backup = os.tmpdir()] = process.argv.slice(2)
const dirty = new Set(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).map(l => l.slice(3).trim()))
const queueFile = path.join(os.homedir(), '.palitada', path.basename(root), 'queue.jsonl')
const queued = () => fs.existsSync(queueFile) ? fs.readFileSync(queueFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
// The test queues a real delete: a listening Claude session would carry it out.
const listeners = path.join(path.dirname(queueFile), 'listeners')
if (fs.existsSync(listeners) && fs.readdirSync(listeners).length) {
  console.error(`A Claude session listens on the palitada channel (${listeners}). Close it first: the test's delete would reach it.`)
  process.exit(1)
}

// Writes must come from the page itself.
const evil = await fetch(new URL('/__palitada/undo', url), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' })
assert.equal(evil.status, 403)
const plain = await fetch(new URL('/__palitada/undo', url), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
assert.equal(plain.status, 403)

// Your installed Chrome; CHROME_PATH points at another Chromium build.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await ctx.newPage()
const errors = [], sockets = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
page.on('websocket', ws => sockets.push(ws.url()))
await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
await page.waitForSelector('palitada-root', { state: 'attached' })

const ui = s => page.locator(`palitada-root ${s}`)
async function pick(el) {
  const box = await el.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await ui('.where').filter({ hasNotText: 'finding source' }).waitFor()
}

// Find a visible leaf text whose source is unique and in a clean file.
const target = await page.evaluate(async dirty => {
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim()
  for (const el of document.querySelectorAll('main h1, main h2, main h3, main p, main a, main button, main span, main li')) {
    const t = own(el), r = el.getBoundingClientRect()
    if (t.length < 8 || t.length > 80 || /[<>{}]/.test(t) || r.top < 0 || r.bottom > innerHeight || !r.width) continue
    const loc = await fetch('/__palitada/locate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, hints: { lang: el.closest('.lang-fil, .lang-en')?.className.match(/lang-(fil|en)/)[1] } }) }).then(r => r.json())
    if (loc.candidates.length === 1 && !dirty.includes(loc.candidates[0].file)) {
      el.setAttribute('data-palitada-test', '')
      return { text: t, file: loc.candidates[0].file }
    }
  }
}, [...dirty])
assert.ok(target, 'no editable text with a unique source in a clean file')
const file = path.join(root, target.file)
const original = fs.readFileSync(file)
fs.copyFileSync(file, path.join(backup, path.basename(file) + '.palitada-backup'))
console.log(`edit target: "${target.text}" in ${target.file}`)

try {
  await page.keyboard.press('Alt+KeyP')
  const el = page.locator('[data-palitada-test]')
  await pick(el)
  assert.match(await ui('.where').textContent(), new RegExp(target.file.replace(/[.[\]()]/g, '\\$&')))
  await ui('[data-a=edit]').click()
  const next = target.text + ' "palitada"' // a quote: must stay valid inside fil="..." or a JS string
  await ui('.editor').fill(next)
  await ui('.editor').press('Enter')
  await ui('.toast').filter({ hasText: 'Saved to' }).waitFor()
  const edited = fs.readFileSync(file, 'utf8')
  assert.ok(edited.includes('palitada'), 'file not edited')
  await page.screenshot({ path: path.join(backup, 'palitada-edit.png') })
  await ui('.toast button').filter({ hasText: 'Undo' }).click()
  await ui('.toast').filter({ hasText: 'Undone in' }).waitFor()
  assert.ok(Buffer.compare(fs.readFileSync(file), original) === 0, 'undo did not restore the file byte for byte')
  console.log('edit + undo: ok')
} finally {
  if (Buffer.compare(fs.readFileSync(file), original) !== 0) { fs.writeFileSync(file, original); console.log('restored file from memory') }
}

// Comment, delete and ref on the first heading.
const before = queued().length
const heading = page.locator('main h1, main h2').first()
await pick(heading)
await ui('[data-a=comment]').click()
await ui('.panel textarea').fill('palitada test comment: make this bigger')
await ui('.panel textarea').press('Enter')
await ui('.toast').filter({ hasText: /Comment #\w+ queued: run/ }).waitFor({ timeout: 20_000 })

await pick(heading)
await page.screenshot({ path: path.join(backup, 'palitada-bar.png') })
await ui('[data-a=ref]').click()
await ui('.toast').filter({ hasText: 'Ref copied' }).waitFor()
const ref = await page.evaluate(() => navigator.clipboard.readText())
assert.match(ref, /^\[palitada ref\] </)
assert.match(ref, /screenshot: .*\.png/)

await pick(heading)
await ui('[data-a=delete]').click()
await ui('[data-a=delete]').click()
await ui('.toast').filter({ hasText: /Delete #\w+ is queued: run/ }).waitFor({ timeout: 20_000 })
assert.equal(await heading.isVisible(), false)

await page.waitForTimeout(1500) // ref item posts after its screenshot
const mine = queued().slice(before)
for (const type of ['comment', 'ref', 'delete']) {
  const it = mine.find(i => i.type === type)
  assert.ok(it, `no ${type} item`)
  assert.ok(it.source || it.components?.some(c => c.at), `${type} has no source or component`)
  assert.ok(it.shot && fs.statSync(it.shot).size > 500, `${type} has no screenshot`)
}
console.log('comment, ref, delete queued with screenshot:', mine.map(i => `${i.type} ${i.source || i.components.map(c => c.name).join(' < ')}${i.note ? ' (data)' : ''}`).join(' | '))
const listed = execFileSync('node', [path.join(import.meta.dirname, 'palitada.mjs'), 'queue', '--root', root], { encoding: 'utf8' })
assert.match(listed, /palitada test comment/)
execFileSync('node', [path.join(import.meta.dirname, 'palitada.mjs'), 'done', ...mine.map(i => i.id), '--root', root])

assert.ok(sockets.some(s => /hmr|webpack|vite|turbopack/i.test(s)), `no HMR websocket through proxy: ${sockets}`)
const real = errors.filter(e => !/favicon|Failed to load resource/.test(e))
assert.deepEqual(real, [], 'page errors')
await browser.close()
console.log('all checks passed')
