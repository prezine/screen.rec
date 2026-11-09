// Builds the harness, serves it with a tiny range-capable file server, and runs it in Chromium.
import { build } from 'vite'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve('test/pipeline')
const outDir = path.join(root, 'dist')
const dataDir = path.join(root, 'data')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.join(dataDir, 'test'), { recursive: true })

await build({
  root,
  logLevel: 'warn',
  resolve: { alias: { '@shared': path.resolve('src/shared'), '@renderer': path.resolve('src/renderer/src') } },
  build: { outDir, emptyOutDir: true, target: 'es2022' }
})

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
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2]
      const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes'
      })
      return fs.createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    return fs.createReadStream(file).pipe(res)
  }
  const f = path.join(outDir, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!fs.existsSync(f)) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(5179, r))

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(
  'http://localhost:5179/' +
    ('#' +
      (process.env.CROP ? 'crop' : '') +
      (process.env.CUT ? 'cut' : '') +
      (process.env.SOUNDS ? 'sounds' : '') +
      (process.env.SPEED ? 'speed' : ''))
)
try {
  const result = await page.evaluate(() => window.runPipeline())
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  server.close()
}
