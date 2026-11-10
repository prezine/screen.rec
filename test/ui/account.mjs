// End-to-end check of accounts in the real UI: welcome → email code sign-in → Pro checkout →
// webhook → Pro unlocked, plus Settings → Account and the Free export limits.
// Runs the real API (the toom-api repo, next to this one or at TOOM_API_DIR) on embedded Postgres
// with a fake Bachs behind it.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve('test/ui')
const outDir = path.join(root, 'dist-account')
const dataDir = path.join(root, 'data')
const shots = process.argv[2] ?? path.join(root, 'shots')
fs.mkdirSync(shots, { recursive: true })
const API_PORT = 8799
const API_DIR = path.resolve(process.env.TOOM_API_DIR ?? '../toom-api')
if (!fs.existsSync(path.join(API_DIR, 'src/index.ts')))
  throw new Error(`Toom API not found at ${API_DIR}: clone toom-api next to this repo or set TOOM_API_DIR`)
const SECRET = 'whsec_ui'
const fail = (m) => {
  throw new Error(m)
}

// ---- fake Bachs --------------------------------------------------------------------------
let lastCheckout = null
const bachs = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (d) => (raw += d))
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null
    const send = (s, j) => res.writeHead(s, { 'Content-Type': 'application/json' }).end(JSON.stringify(j))
    const now = new Date().toISOString()
    if (req.method === 'POST' && req.url === '/v1/checkout-sessions') {
      lastCheckout = body
      return send(201, {
        checkout_id: 'chk_ui',
        checkout_url: 'https://checkout.bachs.io/c/chk_ui',
        status: 'open',
        expires_at: now,
        created_at: now,
        reference: body.reference
      })
    }
    if (req.method === 'POST' && req.url === '/v1/products')
      return send(201, { product_id: `prod_ui_${Math.random().toString(36).slice(2, 8)}`, status: 'active' })
    const portal = /^\/v1\/customers\/(cust_\w+)\/portal-sessions$/.exec(req.url ?? '')
    if (portal) return send(200, { id: 'psn', url: `https://portal.bachs.io/s/${portal[1]}` })
    send(404, { error: { message: 'not found' } })
  })
})
await new Promise((r) => bachs.listen(0, r))

// ---- the API -----------------------------------------------------------------------------
const { privateKey } = generateKeyPairSync('ed25519')
let apiLog = ''
if (
  await fetch(`http://localhost:${API_PORT}/health`).then(
    () => true,
    () => false
  )
)
  fail(`something is already running on port ${API_PORT}`)
const PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'toom-ui-db-'))
// an admin, made before the server starts (it holds the database open), to create promo codes
const adminOut = (
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['tsx', 'scripts/create-admin.ts', 'owner@toom.test', 'Owner'], {
      cwd: API_DIR,
      env: { ...process.env, PGLITE_DIR, DATABASE_URL: '' }
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))))
  })
).toString()
const adminTemp = /One-time password: (\S+)/.exec(adminOut)[1]
const api = spawn('npx', ['tsx', 'src/index.ts'], {
  detached: true, // own process group, so the whole tree can be stopped
  cwd: API_DIR,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    PUBLIC_URL: `http://localhost:${API_PORT}`,
    PGLITE_DIR,
    DATABASE_URL: '',
    BACHS_API_KEY: 'sk_sandbox_ui',
    BACHS_BASE_URL: `http://127.0.0.1:${bachs.address().port}`,
    BACHS_WEBHOOK_SECRET: SECRET,
    BACHS_PRODUCT_MONTHLY: 'prod_month',
    BACHS_PRODUCT_YEARLY: 'prod_year',
    RESEND_API_KEY: '',
    ENTITLEMENT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
api.stdout.on('data', (d) => (apiLog += d))
api.stderr.on('data', (d) => (apiLog += d))
for (let i = 0; ; i++) {
  if (i > 120) fail(`API didn't start:\n${apiLog}`)
  if (
    await fetch(`http://localhost:${API_PORT}/health`).then(
      (r) => r.ok,
      () => false
    )
  )
    break
  await new Promise((r) => setTimeout(r, 250))
}
const apiCall = async (method, p, body, token) => {
  const r = await fetch(`http://localhost:${API_PORT}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await r.json()
  if (!r.ok) fail(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`)
  return j
}
const adminCode = async () => {
  for (let i = 0; i < 40; i++) {
    const m = [...apiLog.matchAll(/(\d{6}) is your Toom admin sign-in code/g)].pop()
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 150))
  }
  fail('no admin code email')
}
const codeFor = async (email) => {
  for (let i = 0; i < 40; i++) {
    const m = [...apiLog.matchAll(new RegExp(`to ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g'))].pop()
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 150))
  }
  fail('no code email')
}
const webhook = async (event) => {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', SECRET).update(`${t}.`).update(body).digest('hex')
  const r = await fetch(`http://localhost:${API_PORT}/webhooks/bachs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bachs-Signature-V2': `t=${t},v1=${sig}` },
    body
  })
  if (!r.ok) fail(`webhook ${r.status} ${await r.text()}`)
}

// ---- harness -----------------------------------------------------------------------------
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
  '.webm': 'video/webm'
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/api/')) {
    const p = http.request(
      {
        host: 'localhost',
        port: API_PORT,
        path: url.pathname.slice(4) + url.search,
        method: req.method,
        headers: req.headers
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers)
        r.pipe(res)
      }
    )
    return req.pipe(p)
  }
  if (url.pathname.startsWith('/p/')) {
    const file = path.join(dataDir, decodeURIComponent(url.pathname.slice(3)))
    if (req.method === 'POST') return req.resume().on('end', () => res.end('ok'))
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
await new Promise((r) => server.listen(5181, r))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 640 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()))
const shot = (name) => page.screenshot({ path: path.join(shots, name) })
const ok = (cond, msg) => {
  if (!cond) fail(msg)
  console.log('✓', msg)
}

try {
  // ---- welcome → sign in with an emailed code
  const email = 'tom@example.com'
  await page.goto('http://localhost:5181/?perms#/welcome')
  await page.getByText('Welcome to Toom').waitFor()
  await page.waitForTimeout(400)
  await shot('welcome-1.png')
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByText('Sign in or create an account').waitFor()
  await page.waitForTimeout(400)
  await shot('welcome-2-account.png')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByText('Check your email').waitFor()
  const code = await codeFor(email)
  await page.waitForTimeout(300)
  await shot('welcome-3-code.png')
  await page.getByLabel('6-digit code').fill(code) // signs in on the 6th digit
  await page.getByText('Choose your plan').waitFor()
  await page.waitForTimeout(600)
  await shot('welcome-4-plan.png')
  ok(true, 'email code sign-in moves on to plans')

  // ---- Pro checkout → webhook → unlocked
  await page.getByRole('button', { name: /free trial|Upgrade to Pro/ }).click()
  await page.getByText('Finish checkout in your browser').waitFor()
  await shot('welcome-5-waiting.png')
  ok(
    lastCheckout?.product_cart?.[0]?.product_id === 'prod_year' && lastCheckout.customer.email === email,
    'checkout for the yearly plan with the account email'
  )
  const userId = lastCheckout.metadata.user_id
  await webhook({
    id: 'evt_ui1',
    type: 'customer.subscription.created',
    created_at: new Date().toISOString(),
    organization_id: 'acct_ui',
    data: {
      subscription_id: 'sub_ui',
      customer: { customer_id: 'cust_ui', email, name: 'Tom' },
      product_id: 'prod_year',
      status: 'trialing',
      current_period_end: new Date(Date.now() + 7 * 864e5).toISOString(),
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { user_id: userId, plan: 'pro-year' }
    }
  })
  await page.getByText('A few permissions').waitFor({ timeout: 8000 })
  await page.waitForTimeout(400)
  await shot('welcome-6-permissions.png')
  ok(true, 'webhook unlocks Pro and the welcome moves on')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('You’re all set').waitFor()
  await page.waitForTimeout(400)
  await shot('welcome-7-ready.png')
  ok(await page.getByText('Toom Pro is unlocked').isVisible(), 'ready step knows about Pro')
  await page.getByRole('button', { name: 'Start recording' }).click()
  ok(await page.evaluate(() => window.__finished === true), 'finishing the welcome tells the app')

  // ---- Settings → Account (same session; route change keeps the mock state)
  await page.setViewportSize({ width: 800, height: 760 })
  await page.evaluate(() => (location.hash = '#/settings/account'))
  await page.getByText('Manage billing').waitFor()
  await page.waitForTimeout(500)
  await shot('settings-account-pro.png')
  await page.getByRole('button', { name: 'Manage billing' }).click()
  await page.waitForFunction(() => window.__portal)
  ok(
    (await page.evaluate(() => window.__portal)).includes('cust_ui'),
    'manage billing opens the Bachs portal for the customer'
  )
  await page.getByRole('button', { name: 'Set a password…' }).click()
  await page.getByLabel('New password').fill('correct horse battery')
  await page.getByRole('button', { name: 'Save password' }).click()
  await page.getByText('Password saved.').waitFor()
  ok(true, 'passwordless account can set a password')

  // cancel at period end
  await webhook({
    id: 'evt_ui2',
    type: 'customer.subscription.updated',
    created_at: new Date().toISOString(),
    organization_id: 'acct_ui',
    data: {
      subscription_id: 'sub_ui',
      customer: { customer_id: 'cust_ui', email },
      product_id: 'prod_year',
      status: 'trialing',
      current_period_end: new Date(Date.now() + 7 * 864e5).toISOString(),
      cancel_at_period_end: true,
      canceled_at: null,
      metadata: { user_id: userId, plan: 'pro-year' }
    }
  })
  await page.getByTitle('Refresh').click()
  await page.getByText(/Free trial · ends/).waitFor()
  ok(true, 'cancellation shows as "trial ends"')

  // ---- sign out → password sign-in → Free account export limits
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByText('Sign in or create an account').waitFor()
  await page.waitForTimeout(300)
  await shot('settings-account-signed-out.png')
  await page.getByText('Use a password instead').click()
  await page.getByText('Create an account').click()
  await page.getByLabel('Name').fill('Free Person')
  await page.getByLabel('Email').fill('free@example.com')
  await page.getByLabel('Password').fill('hunter2hunter2')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByText('Toom Free').waitFor()
  await page.waitForTimeout(600)
  await shot('settings-account-free.png')
  ok(true, 'email + password sign-up')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => (location.hash = '#/editor/demo'))
  await page
    .getByRole('button', { name: /^Export/ })
    .first()
    .waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Meta+e').catch(() => undefined)
  if (!(await page.getByText('Export video').isVisible()))
    await page
      .getByRole('button', { name: /^Export/ })
      .first()
      .click()
  await page.getByText('Export video').waitFor()
  await page.getByText('4K').click()
  await page.getByText('Higher resolutions and 60 fps come with Toom Pro.').waitFor()
  await page.waitForTimeout(300)
  await page
    .locator('.glass-strong')
    .first()
    .screenshot({ path: path.join(shots, 'export-free.png') })
  ok((await page.getByText(/1280×720|×720/).count()) > 0, 'Free export is held at 720p')

  // ---- promo codes, made from the admin API
  const { challenge } = await apiCall('POST', '/admin/v1/auth/login', { email: 'owner@toom.test', password: adminTemp })
  const { token: adminToken } = await apiCall('POST', '/admin/v1/auth/verify', { challenge, code: await adminCode() })
  await apiCall('POST', '/admin/v1/me/password', { current: adminTemp, password: 'owner-password-123' }, adminToken)
  await apiCall(
    'POST',
    '/admin/v1/promos',
    { code: 'HALF', kind: 'discount', percentOff: 50, plans: ['pro-year'] },
    adminToken
  )
  await apiCall(
    'POST',
    '/admin/v1/promos',
    { code: 'FRIENDS30', kind: 'free_pro', proDays: 30, description: 'A month of Pro, on us.' },
    adminToken
  )
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 800, height: 900 })
  await page.evaluate(() => (location.hash = '#/settings/account'))
  await page.getByText('Have a code?').click()
  await page.getByLabel('Promo code').fill('half')
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.getByText(/HALF · 50% off every payment/).waitFor()
  await page.waitForTimeout(300)
  await shot('settings-code-discount.png')
  ok((await page.getByText('$48/yr').count()) > 0, 'discount code halves the yearly price')
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.getByLabel('Promo code').fill('NOPE')
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.getByText('That code isn’t valid.').waitFor()
  ok(true, 'unknown codes are refused')
  await page.getByLabel('Promo code').fill('friends30')
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.getByText('FRIENDS30 unlocks Toom Pro for 1 month').waitFor()
  await shot('settings-code-free.png')
  await page.getByRole('button', { name: 'Claim Pro' }).click()
  await page.getByText(/Pro with a promo code · until/).waitFor()
  await page.waitForTimeout(400)
  await shot('settings-code-claimed.png')
  ok(true, 'free-Pro code unlocks Pro without paying')
  console.log('\nall account checks passed')
} catch (err) {
  console.error(err)
  await shot('account-failure.png').catch(() => undefined)
  console.log(apiLog.split('\n').slice(-30).join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
  bachs.close()
  try {
    process.kill(-api.pid)
  } catch {
    api.kill()
  }
}
