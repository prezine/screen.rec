// Renders the demo recording through Toom's real compositor and encodes the website's hero video:
//   node test/ui/site-video.mjs <out-dir>
// Writes toom-after.{mp4,webm} (what Toom exports), toom-before.{mp4,webm} (the raw recording) and posters.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve('test/ui')
const outDir = path.join(root, 'dist-site')
const dataDir = path.join(root, 'data')
const dest = path.resolve(process.argv[2] ?? 'site-video')
fs.mkdirSync(dest, { recursive: true })
const FPS = 30
const SHORT = 900
// a sharp frame for the poster: zoomed into the invoice dialog (output seconds)
const POSTER_AT = 8.6

await build({
  root,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': path.resolve('src/shared'), '@renderer': path.resolve('src/renderer/src') } },
  publicDir: path.resolve('src/renderer/public'),
  build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000, rollupOptions: { input: { v: path.join(root, 'site-video.html'), r: path.join(root, 'render.html') } } }
})

const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png', '.otf': 'font/otf', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const f = url.pathname.startsWith('/p/') ? path.join(dataDir, decodeURIComponent(url.pathname.slice(3))) : path.join(outDir, url.pathname)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end()
  const size = fs.statSync(f).size
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  const type = types[path.extname(f)] ?? 'application/octet-stream'
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2]
    const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' })
    return fs.createReadStream(f, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(5181, r))

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()))

function encoder(file, w, h) {
  // frames in as JPEG; H.264 for Safari, VP9 for everyone else
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-']
  const mp4 = spawn('ffmpeg', [...args, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', `${file}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] })
  return mp4
}

async function render(name, edit) {
  await page.goto('http://localhost:5181/site-video.html')
  const info = await page.evaluate((o) => window.siteVideo(o), { shortSide: SHORT, fps: FPS, edit })
  console.log(name, info)
  const enc = encoder(path.join(dest, name), info.w, info.h)
  let n = 0
  for (;;) {
    const b64 = await page.evaluate(() => window.nextFrame())
    if (!b64) break
    const jpg = Buffer.from(b64, 'base64')
    if (n === Math.round(POSTER_AT * FPS)) fs.writeFileSync(path.join(dest, `${name}-poster.jpg`), jpg)
    if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r))
    n++
  }
  enc.stdin.end()
  await new Promise((r) => enc.on('close', r))
  const webm = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dest, `${name}.mp4`), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-an', path.join(dest, `${name}.webm`)])
  if (webm.status !== 0) console.log(webm.stderr.toString())
  console.log(`${name}: ${n} frames`)
}

try {
  // the real demo project: auto zooms, glass clicks, privacy masks, camera, keycaps, a cut — plus captions
  // (the demo webcam is a synthetic test face, so the hero leaves the camera out)
  const project = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo/project.json'), 'utf8'))
  await render('toom-after', {
    captions: { enabled: true, style: 'karaoke', animation: 'pop', position: 'bottom', size: 1, highlight: '#bc82f3' },
    camera: { ...project.edit.camera, visible: false, layout: 'screen' },
    layouts: [],
    // the auto-detected email mask ends a moment before the dialog closes in this take
    masks: project.edit.masks.map((m) => (m.auto === 'email' && m.end < 11 ? { ...m, end: 10.95 } : m))
  })
  // the same recording, untouched (scaled to the same height)
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dataDir, 'demo/screen.webm'), '-vf', `scale=-2:${SHORT}`, '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(dest, 'toom-before.mp4')], { stdio: 'inherit' })
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dest, 'toom-before.mp4'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-an', path.join(dest, 'toom-before.webm')], { stdio: 'inherit' })
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '8.9', '-i', path.join(dest, 'toom-before.mp4'), '-frames:v', '1', '-q:v', '3', path.join(dest, 'toom-before-poster.jpg')], { stdio: 'inherit' })
  // feature stills, through the same compositor at 1920×1080
  await page.goto('http://localhost:5181/render.html?scale=2')
  const stills = await page.evaluate(() => window.renderAll())
  for (const [k, v] of Object.entries(stills)) fs.writeFileSync(path.join(dest, `still-${k}.png`), Buffer.from(v.split(',')[1], 'base64'))
  console.log('stills:', Object.keys(stills).join(' '))
} finally {
  await browser.close()
  server.close()
}
