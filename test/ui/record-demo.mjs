// Records a scripted session of demo.html with Playwright, producing a WebM + cursor log.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const out = path.resolve('test/ui/data/demo')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const W = 1440,
  H = 900
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: out, size: { width: W, height: H } }
})
const page = await ctx.newPage()
const t0 = Date.now()
await page.goto('file://' + path.resolve('test/ui/demo.html'))
const navOffset = (Date.now() - t0) / 1000
const m = page.mouse
const wait = (ms) => page.waitForTimeout(ms)
const glide = async (x, y, ms = 700) => {
  const steps = Math.round(ms / 16)
  await m.move(x, y, { steps })
}
await m.move(700, 500)
await wait(800)
await glide(80, 136, 900)
await wait(350)
await m.down()
await m.up()
await wait(1300) // Payments
await glide(1300, 60, 1000)
await wait(300)
await m.down()
await m.up()
await wait(900) // Create invoice
await glide(720, 400, 700)
await wait(250)
await m.down()
await m.up()
await wait(200) // email field
await page.keyboard.type('kofi@studio.co', { delay: 70 })
await wait(300)
await glide(720, 468, 400)
await m.down()
await m.up()
await page.keyboard.type('$860.00', { delay: 80 })
await wait(500)
await glide(880, 535, 600)
await wait(250)
await m.down()
await m.up()
await wait(1400) // Send
await glide(900, 650, 900)
await wait(1500)
const log = await page.evaluate(() => window.__log)
const duration = (Date.now() - t0) / 1000
await ctx.close()
await browser.close()
const vid = fs.readdirSync(out).find((f) => f.endsWith('.webm'))
fs.renameSync(path.join(out, vid), path.join(out, 'screen.webm'))
const shift = (t) => +(t + navOffset).toFixed(4)
const cursor = {
  tracked: true,
  samples: log.samples.map(([t, x, y]) => [shift(t), x, y]),
  clicks: log.clicks.map((c) => ({ ...c, t: shift(c.t) }))
}
fs.writeFileSync(path.join(out, 'cursor.json'), JSON.stringify(cursor))
const meta = {
  id: 'demo',
  name: 'Built-in Display 2026-11-08 18:42',
  createdAt: Date.now(),
  status: 'raw',
  source: { kind: 'screen', name: 'Built-in Display', width: W, height: H },
  files: { screen: 'screen.webm' },
  cameraOffset: 0,
  duration
}
fs.writeFileSync(path.join(out, 'project.json'), JSON.stringify(meta, null, 2))
console.log('recorded', duration.toFixed(1), 's,', cursor.clicks.length, 'clicks,', cursor.samples.length, 'samples')

// Synthetic "webcam" track: a person-like silhouette in a warm room, gently swaying.
{
  const { execFileSync } = await import('node:child_process')
  const geq =
    "r='if(lte(pow((X-320-12*sin(T*1.3))/62,2)+pow((Y-150)/78,2),1),215,if(lte(pow((X-320-8*sin(T*1.3))/150,2)+pow((Y-380)/150,2),1),40,90+60*Y/H))':" +
    "g='if(lte(pow((X-320-12*sin(T*1.3))/62,2)+pow((Y-150)/78,2),1),170,if(lte(pow((X-320-8*sin(T*1.3))/150,2)+pow((Y-380)/150,2),1),55,70+40*Y/H))':" +
    "b='if(lte(pow((X-320-12*sin(T*1.3))/62,2)+pow((Y-150)/78,2),1),140,if(lte(pow((X-320-8*sin(T*1.3))/150,2)+pow((Y-380)/150,2),1),90,60+20*X/W))'"
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=640x360:r=30:d=${duration.toFixed(2)},format=rgb24,geq=${geq}`,
    '-c:v',
    'libvpx',
    '-b:v',
    '1M',
    path.join(out, 'camera.webm')
  ])
  meta.files.camera = 'camera.webm'
  fs.writeFileSync(path.join(out, 'project.json'), JSON.stringify(meta, null, 2))
}
