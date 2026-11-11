// Toom account: sign-in, plan and billing. Talks to the Toom API (the toom-api repo), keeps the session token
// encrypted with the OS keychain (safeStorage), and keeps working offline using a signed
// entitlement the server hands out.

import { app, BrowserWindow, ipcMain, net, powerMonitor, safeStorage, shell } from 'electron'
import { createPublicKey, type KeyObject } from 'node:crypto'
import { entitledPlan } from './entitlement'
import { deviceId } from './device'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import {
  SIGNED_OUT,
  LIMITS,
  type AccountEvent,
  type AccountGrant,
  type AccountLicense,
  type PromoInfo,
  type PromoResult,
  type AccountResult,
  type AccountState,
  type AccountSubscription,
  type AccountUser,
  type PlanLimits,
  type PlanTier,
  type PublicPlan
} from '@shared/account'

// Baked in at build time (electron.vite.config.ts); TOOM_API_URL at runtime wins, for development.
declare const __TOOM_API_URL__: string
declare const __TOOM_ENTITLEMENT_PUBLIC_KEY__: string

/** The live Toom API. Builds use it unless TOOM_API_URL says otherwise (http://localhost:8787 for a local toom-api). */
const DEFAULT_API_URL = 'https://api.trytoom.tech'
export const API_URL = (process.env['TOOM_API_URL'] || __TOOM_API_URL__ || DEFAULT_API_URL).replace(/\/+$/, '')
const PUBLIC_KEY_PEM = (process.env['TOOM_ENTITLEMENT_PUBLIC_KEY'] || __TOOM_ENTITLEMENT_PUBLIC_KEY__ || '').replace(
  /\\n/g,
  '\n'
)
export const SCHEME = 'toom'

/** without a signing key (development), trust the last answer from the server for this long offline */
const UNSIGNED_OFFLINE_MS = 3 * 864e5
const REFRESH_MS = 6 * 3600e3
const PAYMENT_POLL_MS = 4000
const PAYMENT_WAIT_MS = 20 * 60e3

interface ServerAccount {
  user: AccountUser
  plan: PlanTier
  subscription: AccountSubscription | null
  grant?: AccountGrant | null
  license?: Omit<AccountLicense, 'problem'> & { problem?: string | null } | null
  entitlement: string | null
  trialEligible?: boolean
}

interface Stored {
  /** session token, encrypted with safeStorage when available (base64) */
  token: string
  encrypted: boolean
  account: ServerAccount | null
  checkedAt: number
}

const file = (): string => join(app.getPath('userData'), 'account.json')

let token: string | null = null
let cached: ServerAccount | null = null
let checkedAt = 0
/** last refresh reached the server */
let online = false
let awaiting = false
let pollTimer: NodeJS.Timeout | null = null
let pollUntil = 0
let publicKey: KeyObject | null | undefined
/** this computer's hashed hardware ID, once read (offline Pro is only trusted on the key's own seat) */
let myDevice: string | null = null
/** the stored session has been read */
let loaded: Promise<void> = Promise.resolve()

// ---------------------------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------------------------

/** OS keychain encryption (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). */
async function keychain(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    return false
  }
}

async function load(): Promise<void> {
  try {
    const s = JSON.parse(await fs.readFile(file(), 'utf8')) as Stored
    let reEncrypt = false
    if (s.token) {
      if (!s.encrypted) token = Buffer.from(s.token, 'base64').toString('utf8')
      else if (await keychain()) {
        const r = await safeStorage.decryptStringAsync(Buffer.from(s.token, 'base64'))
        token = r.result
        reEncrypt = r.shouldReEncrypt
      }
    }
    cached = token ? s.account : null
    checkedAt = s.checkedAt ?? 0
    if (reEncrypt) save()
  } catch {
    token = null
    cached = null
  }
}

let writeChain: Promise<void> = Promise.resolve()
/** Writes are queued, so they land in order even though encryption is async. */
function save(): void {
  const t = token
  const account = cached
  const at = checkedAt
  writeChain = writeChain
    .then(async () => {
      const encrypted = !!t && (await keychain())
      const s: Stored = {
        token: t ? (encrypted ? await safeStorage.encryptStringAsync(t) : Buffer.from(t)).toString('base64') : '',
        encrypted,
        account,
        checkedAt: at
      }
      const tmp = file() + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 })
      await fs.rename(tmp, file())
    })
    .catch((err) => console.error('[account] save failed', err))
}

// ---------------------------------------------------------------------------------------------
// entitlement (offline plan)
// ---------------------------------------------------------------------------------------------

function key(): KeyObject | null {
  if (publicKey === undefined) {
    try {
      publicKey = PUBLIC_KEY_PEM ? createPublicKey(PUBLIC_KEY_PEM) : null
    } catch (err) {
      console.error('[account] bad entitlement public key', err)
      publicKey = null
    }
  }
  return publicKey
}

/** The plan we can vouch for right now. */
function currentPlan(): PlanTier {
  if (!cached) return 'free'
  if (online) return cached.plan
  const k = key()
  if (k) return entitledPlan(cached.entitlement, k, cached.user.id, Date.now(), myDevice)
  return Date.now() - checkedAt < UNSIGNED_OFFLINE_MS ? cached.plan : 'free'
}

export function accountState(): AccountState {
  if (!token || !cached) return { ...SIGNED_OUT, offline: !!token && !online }
  return {
    user: cached.user,
    plan: currentPlan(),
    subscription: cached.subscription,
    grant: cached.grant ?? null,
    license: cached.license ? { ...cached.license, problem: cached.license.problem ?? null } : null,
    trialEligible: cached.trialEligible,
    offline: !online,
    awaitingPayment: awaiting
  }
}

/** Toom needs an account: true once a session is stored (it keeps working offline). */
export function isSignedIn(): boolean {
  return !!token && !!cached
}

let loadedFlag = false
let markLoaded: () => void = () => undefined
const loadedOnce = new Promise<void>((r) => (markLoaded = r))
/** The stored session has been read (before that, nobody is signed in yet). */
export const accountLoaded = (): boolean => loadedFlag
/** Resolves once the stored session has been read. */
export const accountReady = (): Promise<void> => loadedOnce

export function currentLimits(): PlanLimits {
  return LIMITS[accountState().plan]
}

// ---------------------------------------------------------------------------------------------
// broadcast
// ---------------------------------------------------------------------------------------------

const listeners = new Set<(s: AccountState) => void>()
let lastSent = ''

function broadcast(force = false): void {
  const s = accountState()
  const json = JSON.stringify(s)
  if (!force && json === lastSent) return
  lastSent = json
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('account:changed', s)
  for (const l of listeners) l(s)
}

export function onAccountChanged(fn: (s: AccountState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(e: AccountEvent): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('account:event', e)
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

type Reply<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string }

const OFFLINE_MESSAGE = 'Can’t reach Toom right now. Check your connection and try again.'
/** in development, say which server didn't answer, so a wrong TOOM_API_URL is obvious */
const offlineMessage = (): string =>
  app.isPackaged ? OFFLINE_MESSAGE : `Can’t reach the Toom API at ${API_URL}. Is it running, and is TOOM_API_URL right?`

/** e.g. "Ada’s MacBook Air · Toom 1.4.0 on macOS": names this computer in the list using a licence key */
function deviceLabel(): string {
  const os = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  // HTTP headers carry ASCII only: anything else in a computer's name would make every request fail
  const host = hostname()
    .replace(/\.(local|lan|home)$/i, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/-/g, ' ')
    .trim()
    .slice(0, 60)
  return `${host ? `${host} - ` : ''}Toom ${app.getVersion()} on ${os}`
}

async function call<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  await loaded // the stored session, before anything can sign in or out
  let res: Response
  let device: string | null = null
  try {
    device = await deviceId()
  } catch (err) {
    console.warn('[account] no device id', err)
  }
  try {
    res = await net.fetch(`${API_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-toom-device': deviceLabel(),
        // hashed hardware ID: one free trial and one free-Pro code per computer
        ...(device ? { 'x-toom-device-id': device } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    })
  } catch (err) {
    console.warn(`[account] ${method} ${API_URL}${path} failed:`, err)
    // Chromium's reason (ERR_NAME_NOT_RESOLVED, ERR_CERT_…) tells support what's wrong at a glance
    const code = /(ERR_[A-Z_]+)/.exec(err instanceof Error ? `${err.message} ${String((err as Error & { cause?: unknown }).cause ?? '')}` : String(err))?.[1]
    return { ok: false, status: 0, code: 'offline', message: `${offlineMessage()}${code ? ` (${code})` : ''}` }
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null
  if (!res.ok || !data) {
    const err = data?.error
    if (res.status >= 500 || !data) console.warn(`[account] ${method} ${path} → HTTP ${res.status}`, err?.code ?? '')
    if (res.status === 401 && token && path.startsWith('/v1/me')) signOutLocally()
    return {
      ok: false,
      status: res.status,
      code: err?.code ?? 'server_error',
      message:
        err?.message ?? (res.status >= 500 ? 'Toom’s servers had a problem. Try again in a moment.' : offlineMessage())
    }
  }
  return { ok: true, data }
}

function fail(r: { code: string; message: string }): AccountResult {
  return { ok: false, code: r.code, message: r.message }
}

function setAccount(a: ServerAccount): void {
  cached = a
  checkedAt = Date.now()
  online = true
  save()
}

function signOutLocally(): void {
  const had = !!token
  token = null
  cached = null
  online = false
  stopAwaiting()
  save()
  broadcast()
  if (had) emit({ type: 'signed-out' })
}

async function signedIn(r: Reply<ServerAccount & { token: string }>): Promise<AccountResult> {
  if (!r.ok) return fail(r)
  const { token: t, ...a } = r.data
  token = t
  setAccount(a)
  broadcast()
  emit({ type: 'signed-in' })
  return { ok: true, state: accountState() }
}

/** Ask the server for the latest account (plan, subscription). Quietly keeps the old one offline. */
export async function refreshAccount(): Promise<AccountState> {
  if (!token) {
    broadcast()
    return accountState()
  }
  const wasPro = accountState().plan === 'pro'
  const r = await call<ServerAccount>('GET', '/v1/me')
  if (r.ok) setAccount(r.data)
  else if (r.status === 0 || r.status >= 500) online = false
  const s = accountState()
  if (awaiting && s.plan === 'pro') stopAwaiting()
  broadcast()
  if (!wasPro && s.plan === 'pro') emit({ type: 'upgraded' })
  return accountState()
}

// ---------------------------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------------------------

function startAwaiting(): void {
  awaiting = true
  pollUntil = Date.now() + PAYMENT_WAIT_MS
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      if (Date.now() > pollUntil) return stopAwaiting(true)
      void refreshAccount()
    }, PAYMENT_POLL_MS)
  }
  broadcast()
}

function stopAwaiting(notify = false): void {
  awaiting = false
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (notify) broadcast()
}

// ---------------------------------------------------------------------------------------------
// deep links  (toom://auth/magic?t=…, toom://billing/success|pending|cancelled)
// ---------------------------------------------------------------------------------------------

let focusUi: () => void = () => undefined
let pendingLink: string | null = null
let ready = false

/** Which window to bring forward when a link arrives (set once windows exist). */
export function setAccountFocus(fn: () => void): void {
  focusUi = fn
}

export function findDeepLink(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${SCHEME}://`))
}

export async function handleDeepLink(url: string): Promise<void> {
  if (!ready) {
    pendingLink = url
    return
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (u.protocol !== `${SCHEME}:`) return
  const route = `${u.hostname}${u.pathname}`.replace(/\/$/, '')
  focusUi()
  if (route === 'auth/magic') {
    const t = u.searchParams.get('t')
    if (!t) return
    const r = await signedIn(await call('POST', '/v1/auth/email/verify', { token: t }))
    if (!r.ok) emit({ type: 'error', message: r.message })
  } else if (route === 'billing/success' || route === 'billing/pending') {
    if (!awaiting) startAwaiting()
    await refreshAccount()
  } else if (route === 'billing/cancelled') {
    stopAwaiting(true)
    emit({ type: 'checkout-cancelled' })
  }
}

/** Register toom:// with the OS. Call before app ready. */
export function registerDeepLinks(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [join(process.cwd(), process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(SCHEME)
  }
  // macOS delivers links through open-url (also when the link launched the app)
  app.on('open-url', (e, url) => {
    e.preventDefault()
    void handleDeepLink(url)
  })
  // Windows/Linux: a link that launched the app arrives as an argument
  const first = findDeepLink(process.argv)
  if (first) pendingLink = first
}

// ---------------------------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------------------------

type Ask = { email: string; code?: string; password?: string; name?: string }

export function registerAccountIpc(): void {
  console.info(`[account] API ${API_URL}`)
  void deviceId().then((id) => (myDevice = id))
  loaded = load().then(() => {
    ready = true
    loadedFlag = true
    markLoaded()
    broadcast(true)
    // keep the plan fresh
    void refreshAccount()
    if (pendingLink) {
      const l = pendingLink
      pendingLink = null
      void handleDeepLink(l)
    }
  })

  ipcMain.handle('account:get', async () => {
    await loaded
    return accountState()
  })
  ipcMain.handle('account:refresh', () => refreshAccount())
  ipcMain.handle('account:apiUrl', () => API_URL)

  ipcMain.handle('account:signup', async (_e, a: Ask) =>
    signedIn(await call('POST', '/v1/auth/signup', { email: a.email, password: a.password, name: a.name || undefined }))
  )
  ipcMain.handle('account:login', async (_e, a: Ask) =>
    signedIn(await call('POST', '/v1/auth/login', { email: a.email, password: a.password }))
  )
  ipcMain.handle(
    'account:emailStart',
    async (_e, email: string, purpose: 'login' | 'reset' = 'login'): Promise<AccountResult> => {
      const r = await call<{ sent: boolean }>('POST', '/v1/auth/email/start', { email, purpose })
      return r.ok ? { ok: true, state: accountState() } : fail(r)
    }
  )
  ipcMain.handle('account:emailVerify', async (_e, a: Ask) =>
    signedIn(await call('POST', '/v1/auth/email/verify', { email: a.email, code: a.code, name: a.name || undefined }))
  )
  ipcMain.handle('account:resetPassword', async (_e, a: Ask) =>
    signedIn(await call('POST', '/v1/auth/password/reset', { email: a.email, code: a.code, password: a.password }))
  )

  ipcMain.handle('account:update', async (_e, patch: { name: string }): Promise<AccountResult> => {
    const r = await call<ServerAccount>('PATCH', '/v1/me', patch)
    if (!r.ok) return fail(r)
    setAccount(r.data)
    broadcast()
    return { ok: true, state: accountState() }
  })
  ipcMain.handle(
    'account:changePassword',
    async (_e, p: { current?: string; password: string }): Promise<AccountResult> => {
      const r = await call('POST', '/v1/me/password', p)
      if (!r.ok) return fail(r)
      return { ok: true, state: await refreshAccount() }
    }
  )
  ipcMain.handle('account:logout', async () => {
    if (token) await call('POST', '/v1/me/logout')
    signOutLocally()
    return accountState()
  })
  ipcMain.handle('account:delete', async (): Promise<AccountResult> => {
    const r = await call('DELETE', '/v1/me')
    if (!r.ok) return fail(r)
    signOutLocally()
    return { ok: true, state: accountState() }
  })

  ipcMain.handle('account:plans', async (): Promise<{ plans: PublicPlan[]; enabled: boolean }> => {
    const r = await call<{ plans: PublicPlan[]; enabled: boolean }>('GET', '/v1/billing/plans')
    return r.ok ? r.data : { plans: [], enabled: false }
  })
  // promo codes: free Pro, or a discount used at checkout
  ipcMain.handle('account:promoCheck', async (_e, code: string): Promise<PromoResult> => {
    const r = await call<PromoInfo>('POST', '/v1/promo/check', { code })
    return r.ok ? { ok: true, promo: r.data } : { ok: false, code: r.code, message: r.message }
  })
  ipcMain.handle('account:promoRedeem', async (_e, code: string): Promise<AccountResult> => {
    const wasPro = accountState().plan === 'pro'
    const r = await call<ServerAccount>('POST', '/v1/promo/redeem', { code })
    if (!r.ok) return fail(r)
    setAccount(r.data)
    broadcast()
    if (!wasPro && accountState().plan === 'pro') emit({ type: 'upgraded' })
    return { ok: true, state: accountState() }
  })

  // licence keys: enter one (or a free-Pro code) to activate it here; free a computer's seat
  ipcMain.handle('account:licenseActivate', async (_e, key: string): Promise<AccountResult> => {
    const wasPro = accountState().plan === 'pro'
    const r = await call<ServerAccount>('POST', '/v1/license/activate', { key })
    if (!r.ok) return fail(r)
    setAccount(r.data)
    broadcast()
    if (!wasPro && accountState().plan === 'pro') emit({ type: 'upgraded' })
    return { ok: true, state: accountState() }
  })
  ipcMain.handle('account:licenseDeactivate', async (_e, device: string): Promise<AccountResult> => {
    const wasPro = accountState().plan === 'pro'
    const r = await call<ServerAccount>('POST', '/v1/license/deactivate', { deviceId: device })
    if (!r.ok) return fail(r)
    setAccount(r.data)
    broadcast()
    if (!wasPro && accountState().plan === 'pro') emit({ type: 'upgraded' })
    return { ok: true, state: accountState() }
  })

  ipcMain.handle('account:checkout', async (_e, plan: PublicPlan['id'], code?: string): Promise<AccountResult> => {
    const r = await call<{ url: string }>('POST', '/v1/billing/checkout', { plan, ...(code ? { code } : {}) })
    if (!r.ok) {
      if (r.code === 'already_pro') await refreshAccount()
      return fail(r)
    }
    if (!/^https:\/\//.test(r.data.url) && app.isPackaged)
      return fail({ code: 'bad_url', message: 'Checkout link looks wrong.' })
    await shell.openExternal(r.data.url)
    startAwaiting()
    return { ok: true, state: accountState() }
  })
  ipcMain.handle('account:cancelWaiting', () => {
    stopAwaiting(true)
    return accountState()
  })
  ipcMain.handle('account:portal', async (): Promise<AccountResult> => {
    const r = await call<{ url: string }>('POST', '/v1/billing/portal')
    if (!r.ok) return fail(r)
    await shell.openExternal(r.data.url)
    // they may cancel or change plan there
    setTimeout(() => void refreshAccount(), 30e3)
    return { ok: true, state: accountState() }
  })

  setInterval(() => void refreshAccount(), REFRESH_MS)
  powerMonitor.on('resume', () => void refreshAccount())
}
