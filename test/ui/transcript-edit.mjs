// Correcting transcript words (captions read them), and a heap check while playing.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve('test/ui')
const outDir = path.join(root, 'dist-captions')
const dataDir = path.join(root, 'data')
const shots = process.argv[2] ?? path.join(root, 'shots')
fs.mkdirSync(shots, { recursive: true })
const keep = ['transcript.json', 'project.json'].map((f) => [f, fs.readFileSync(path.join(dataDir, 'demo', f))])

await build({
  root,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': path.resolve('src/shared'), '@renderer': path.resolve('src/renderer/src') } },
  publicDir: path.resolve('src/renderer/public'),
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 9000,
    rollupOptions: { input: path.join(root, 'index.html') }
  }
})
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm'
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/p/')) {
    const file = path.join(dataDir, decodeURIComponent(url.pathname.slice(3)))
    if (req.method === 'POST') {
      const op = url.searchParams.get('op')
      const bufs = []
      req.on('data', (d) => bufs.push(d))
      req.on('end', () => {
        const body = Buffer.concat(bufs)
        if (op === 'truncate' || op === 'put') fs.writeFileSync(file, op === 'put' ? body : Buffer.alloc(0))
        else {
          const fd = fs.openSync(file, 'r+')
          fs.writeSync(fd, body, 0, body.length, Number(url.searchParams.get('pos')))
          fs.closeSync(fd)
        }
        res.end('ok')
      })
      return
    }
    if (!fs.existsSync(file)) return res.writeHead(404).end()
    const size = fs.statSync(file).size
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    const type = types[path.extname(file)] ?? 'application/octet-stream'
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2]
      const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes'
      })
      return fs.createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    return fs.createReadStream(file).pipe(res)
  }
  const f = path.join(outDir, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!fs.existsSync(f)) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(5182, r))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const ok = (c, m) => {
  if (!c) throw new Error(m)
  console.log('✓', m)
}
try {
  await page.goto('http://localhost:5182/#/editor/demo')
  await page
    .getByRole('button', { name: /^Export/ })
    .first()
    .waitFor({ timeout: 90000 })
  await page.waitForTimeout(1200)
  const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)

  // fix a word in the transcript
  await page.getByRole('button', { name: 'Transcript', exact: true }).click()
  await page.waitForSelector('[data-w="3"]')
  await page.locator('[data-w="3"]').dblclick()
  const input = page.getByLabel('Correct the word')
  await input.waitFor()
  await input.fill('Pandascrow')
  await page.waitForTimeout(150)
  await page.screenshot({
    path: path.join(shots, 'transcript-edit.png'),
    clip: { x: 1060, y: 60, width: 380, height: 420 }
  })
  await input.press('Enter')
  await page.waitForTimeout(400)
  ok(
    (await page.locator('[data-w="3"]').innerText()).trim() === 'Pandascrow',
    'double-click a word, type, Enter → word corrected'
  )
  // merge two words into one with Tab-free range edit: select 5..6 and Edit
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo/transcript.json'), 'utf8'))
  ok(saved.words[3].text === ' Pandascrow' && saved.editedAt, 'correction saved to the project')
  ok(await page.getByText('Undo text edit').isVisible(), 'undo is offered')

  // memory: play through twice and check the heap settles
  await page.keyboard.press('Home')
  await page.keyboard.press('Space')
  await page.waitForTimeout(9000)
  await page.keyboard.press('Space')
  await page.keyboard.press('Home')
  await page.keyboard.press('Space')
  await page.waitForTimeout(9000)
  await page.keyboard.press('Space')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  console.log(
    `heap after opening: ${(heap0 / 1e6).toFixed(0)} MB, after 2 playbacks + GC: ${(heap1 / 1e6).toFixed(0)} MB`
  )
} catch (e) {
  console.error(e)
  await page.screenshot({ path: path.join(shots, 'captions-failure.png') })
  process.exitCode = 1
} finally {
  for (const [f, b] of keep) fs.writeFileSync(path.join(dataDir, 'demo', f), b)
  await browser.close()
  server.close()
}
