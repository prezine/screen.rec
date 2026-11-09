// Builds the UI harness, serves it + test/ui/data, and takes screenshots of the real editor.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve('test/ui')
const outDir = path.join(root, 'dist')
const dataDir = path.join(root, 'data')
const shots = process.argv[2] ?? path.join(root, 'shots')
fs.mkdirSync(shots, { recursive: true })

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
    chunkSizeWarningLimit: 5000,
    rollupOptions: { input: { index: path.join(root, 'index.html'), render: path.join(root, 'render.html') } }
  }
})

const types = {
  '.otf': 'font/otf',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/nm/')) {
    // bundled OCR files, as the app's main process would hand them over
    const f = path.resolve('node_modules', decodeURIComponent(url.pathname.slice(4)))
    if (!f.startsWith(path.resolve('node_modules')) || !fs.existsSync(f)) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    return fs.createReadStream(f).pipe(res)
  }
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
    const type = types[path.extname(file)] ?? 'application/octet-stream'
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
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
await new Promise((r) => server.listen(5180, r))

const browser = await chromium.launch({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream'
  ]
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('console', (m) => ['error', 'warning', 'debug'].includes(m.type()) && console.log('[page]', m.type(), m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = (name) => page.screenshot({ path: path.join(shots, name) })

try {
  // ---- compositor renders
  await page.goto('http://localhost:5180/render.html')
  await page.waitForFunction(() => window.renderAll)
  const renders = await page.evaluate(() => window.renderAll())
  for (const [name, url] of Object.entries(renders))
    fs.writeFileSync(path.join(shots, `r-${name}.png`), Buffer.from(url.split(',')[1], 'base64'))
  if (process.env.ONLY_RENDER) throw new Error('done')

  // Home
  await page.goto('http://localhost:5180/#/')
  await page.waitForTimeout(1200)
  await shot('home.png')

  // Editor (first open → remux + auto zoom)
  await page.goto('http://localhost:5180/#/editor/demo')
  await page.waitForSelector('text=Export', { timeout: 90000 })
  await page.waitForTimeout(1500)
  const proj = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo/project.json'), 'utf8'))
  console.log('status', proj.status, 'files', JSON.stringify(proj.files), 'zooms', proj.edit?.zooms?.length)
  const seek = async (sec) => {
    await page.keyboard.press('Home')
    for (let i = 0; i < Math.round(sec); i++) await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(900)
  }
  const rail = (name) => page.getByRole('button', { name, exact: true }).click()

  // camera layouts: split as default
  await rail('Camera & layout')
  await page.getByText('Split screen', { exact: true }).click()
  await seek(13)
  await shot('editor-camera-split.png')
  // fullscreen-camera layout change on the timeline
  await page.getByText('Camera overlay', { exact: true }).click()
  await page.getByRole('button', { name: /Layout change/ }).click()
  await page.waitForTimeout(400)
  await seek(1)
  await shot('editor-layout-change.png')
  await page.keyboard.press('Escape')

  // split the clip at 7s and delete the second half's first part → shows a cut gap
  await seek(7)
  await page.keyboard.press('s')
  await seek(9)
  await page.keyboard.press('s')
  await page.waitForTimeout(300)

  // cursor panel with glass effect
  await rail('Cursor')
  await page.getByRole('button', { name: 'Glass', exact: true }).click()
  await page.getByRole('button', { name: 'Ring', exact: true }).click()
  await seek(2)
  await shot('editor-cursor.png')

  // transcript (mock) → select words and cut them
  fs.copyFileSync(process.env.TRANSCRIPT, path.join(dataDir, 'demo/transcript.json'))
  await rail('Transcript')
  await page.waitForSelector('[data-w="9"]')
  const a = page.locator('[data-w="13"]')
  const b = page.locator('[data-w="19"]')
  await a.dispatchEvent('pointerdown', { button: 0 })
  await b.dispatchEvent('pointerenter')
  await page.mouse.up()
  await page.waitForTimeout(300)
  await shot('editor-transcript-select.png')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(600)
  await shot('editor-transcript.png')

  // privacy mask
  await rail('Privacy masks')
  await seek(3)
  await page.getByRole('button', { name: /Add mask at playhead/ }).click()
  await page.waitForTimeout(400)
  {
    const handle = await page.locator('[style*="nwse-resize"]').nth(1).boundingBox()
    if (handle) {
      await page.mouse.move(handle.x + 6, handle.y + 6)
      await page.mouse.down()
      await page.mouse.move(handle.x + 120, handle.y + 40, { steps: 6 })
      await page.mouse.up()
    }
  }
  await page.waitForTimeout(500)
  await shot('editor-mask.png')
  await page.getByRole('button', { name: 'Pixelate', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await shot('editor-mask-pixelate.png')

  // audio & music
  await rail('Audio & music')
  await seek(0)
  await page.waitForTimeout(300)
  await shot('editor-audio.png')
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.waitForTimeout(2500)
  await seek(4)
  await page.locator('button[title="Add Whoosh at the playhead"]').click()
  await page.waitForTimeout(1200)
  await seek(9)
  await page.locator('button[title="Add Success at the playhead"]').click()
  await page.waitForTimeout(1200)
  await shot('editor-audio-added.png')
  // voice-over with the fake microphone
  await seek(1)
  await page.getByRole('button', { name: /Record from/ }).click()
  await page.waitForTimeout(3200)
  await page.waitForTimeout(2500)
  await shot('editor-voiceover-recording.png')
  await page.locator('button[title="Stop"]').click()
  await page.waitForTimeout(2500)
  const vo = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo/project.json'), 'utf8')).edit.sounds.filter(
    (x) => x.kind === 'voice'
  )
  console.log(
    'voice',
    JSON.stringify(vo.map((x) => [x.source.file, +x.start.toFixed(2), +x.end.toFixed(2)])),
    vo[0] && fs.statSync(path.join(dataDir, 'demo', vo[0].source.file)).size
  )
  await shot('editor-voiceover.png')
  await page.keyboard.press('Escape')

  // automatic privacy scan (real OCR on the demo recording)
  await rail('Privacy masks')
  await page.getByRole('button', { name: /Scan recording/ }).click()
  for (let i = 0; i < 40; i++) {
    const label = await page.evaluate(
      () =>
        [...document.querySelectorAll('span')]
          .map((x) => x.textContent)
          .find((x) => x && x.endsWith('…') && /Reading|Starting|Loading|Done/.test(x)) ?? null
    )
    const again = await page.locator('text=Scan again').count()
    console.log('scan', i, label, again)
    if (again) break
    await page.waitForTimeout(5000)
  }
  await page.screenshot({ path: path.join(shots, 'scan-debug.png') })
  await page.waitForTimeout(500)
  const scanned = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo/project.json'), 'utf8')).edit
  console.log(
    'auto masks',
    JSON.stringify(
      (scanned.masks ?? []).filter((m) => m.auto).map((m) => [m.auto, +m.start.toFixed(1), +m.end.toFixed(1)])
    )
  )
  await seek(8)
  await shot('editor-privacy-scan.png')

  // auto zoom feedback
  await page.getByRole('button', { name: 'Auto zoom', exact: true }).first().click()
  await page.waitForTimeout(500)
  await shot('editor-autozoom.png')

  // background tabs (scrollable strip)
  await rail('Background')
  await page.waitForTimeout(300)
  await shot('editor-background.png')

  // background → Unsplash
  await rail('Background')
  await page.getByRole('button', { name: 'Unsplash', exact: true }).click()
  await page.waitForTimeout(400)
  await shot('editor-unsplash-key.png')
  await page.evaluate(() => window.__setSettings({ integrations: { unsplashKey: 'demo' } }))
  await page.waitForTimeout(900)
  await shot('editor-unsplash.png')
  await page.keyboard.press('Escape')

  // ---- launcher bar on a "desktop"
  const desk = 'html.toolbar body{background:url(/p/demo/desk.png) center/cover no-repeat !important}'
  await page.goto('http://localhost:5180/#/launcher')
  await page.addStyleTag({ content: desk })
  await page.waitForTimeout(800)
  await shot('launcher.png')
  const bar = (name) => page.getByRole('button', { name, exact: true })
  await bar('Display').click()
  await page.waitForTimeout(700)
  await shot('launcher-display.png')
  await bar('Window').click()
  await page.waitForTimeout(700)
  await shot('launcher-window.png')
  await bar('Window').click()
  await page.getByText('No camera').click()
  await page.waitForTimeout(400)
  await page
    .getByRole('button', { name: /fake_device/ })
    .first()
    .click()
  await page.waitForTimeout(1500)
  await shot('launcher-camera.png')
  await page.getByText('Default mic').click()
  await page.waitForTimeout(1200)
  await shot('launcher-mic.png')
  await page.locator('button[title="Settings"]').click()
  await page.waitForTimeout(500)
  await shot('launcher-settings.png')
  await page.locator('button[title="Recent recordings"]').click()
  await page.waitForTimeout(500)
  await shot('launcher-recents.png')

  // ---- area overlay
  await page.goto('http://localhost:5180/#/area/1')
  await page.addStyleTag({ content: desk })
  await page.evaluate(() => localStorage.clear())
  await page.waitForTimeout(500)
  await shot('area-empty.png')
  await page.mouse.move(260, 140)
  await page.mouse.down()
  await page.mouse.move(700, 400, { steps: 8 })
  await page.mouse.move(1120, 640, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await shot('area.png')

  // ---- dynamic island
  const top = 'html.toolbar body{background:url(/p/demo/desk.png) top center/1440px auto no-repeat !important}'
  for (const notch of ['1', '0']) {
    await page.setViewportSize({ width: 560, height: 200 })
    await page.goto(`http://localhost:5180/?notch=${notch}#/island`)
    await page.addStyleTag({ content: top })
    await page.waitForTimeout(400)
    await page.evaluate(() => window.__emitRec({ phase: 'countdown', elapsed: 0, countdown: 3 }))
    await page.waitForTimeout(700)
    await shot(`island-${notch}-countdown.png`)
    await page.evaluate(() => window.__emitRec({ phase: 'recording', elapsed: 83.4 }))
    await page.waitForTimeout(700)
    await shot(`island-${notch}-recording.png`)
    await page.locator('[data-interactive]').first().hover()
    await page.waitForTimeout(700)
    await shot(`island-${notch}-expanded.png`)
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await page.waitForTimeout(500)
    await shot(`island-${notch}-discard.png`)
  }

  // ---- settings window (CSS glass, and on native glass over a desktop)
  await page.setViewportSize({ width: 760, height: 660 })
  for (const sec of ['general', 'appearance', 'recording', 'editing', 'export', 'shortcuts', 'advanced']) {
    await page.goto(`http://localhost:5180/#/settings/${sec}`)
    await page.waitForTimeout(500)
    await shot(`settings-${sec}.png`)
  }
  await page.goto('http://localhost:5180/#/settings/appearance')
  await page.waitForTimeout(400)
  for (const [name, patch] of [
    ['tinted', { glass: 'tinted' }],
    ['clear-strong', { glass: 'clear', transparency: 0.9, refraction: 1, blur: 0.15 }],
    ['refraction-off', { refraction: 0 }],
    ['solid', { glass: 'solid' }]
  ]) {
    await page.evaluate((p) => window.__setSettings({ appearance: p }), patch)
    await page.waitForTimeout(500)
    await page
      .locator('.glass')
      .first()
      .screenshot({ path: path.join(shots, `glass-${name}.png`) })
      .catch(() => undefined)
    await shot(`settings-appearance-${name}.png`)
  }
  await page.evaluate(() =>
    window.__setSettings({
      appearance: { glass: 'clear', transparency: 0.55, blur: 0.45, refraction: 0.6, highlights: 0.7 }
    })
  )
  await page.goto('http://localhost:5180/?glass=liquid#/settings/recording')
  await page.addStyleTag({
    content:
      'html.toolbar body{background:url(/p/demo/desk.png) center/cover no-repeat !important} html.toolbar #root{backdrop-filter:blur(40px) saturate(1.6)}'
  })
  await page.waitForTimeout(600)
  await shot('settings-native-glass.png')

  // ---- library
  await page.setViewportSize({ width: 1040, height: 720 })
  await page.goto('http://localhost:5180/#/library')
  await page.waitForTimeout(900)
  await shot('library.png')
} finally {
  await browser.close()
  server.close()
}
