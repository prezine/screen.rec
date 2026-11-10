// Harness stand-in for src/main/account.ts: same preload API, talking to a real Toom API server
// through the harness server's /api proxy.
import { SIGNED_OUT, type AccountEvent, type AccountResult, type AccountState } from '@shared/account'

let token: string | null = null
let state: AccountState = SIGNED_OUT
let awaiting = false
let poll: ReturnType<typeof setInterval> | null = null
const changed = new Set<(s: AccountState) => void>()
const events = new Set<(e: AccountEvent) => void>()

type Server = { user: AccountState['user']; plan: AccountState['plan']; subscription: AccountState['subscription'] }

const publish = (a: Server | null): void => {
  state = a
    ? { user: a.user, plan: a.plan, subscription: a.subscription, grant: (a as { grant?: AccountState["grant"] }).grant ?? null, offline: false, awaitingPayment: awaiting }
    : SIGNED_OUT
  changed.forEach((l) => l(state))
}
const emit = (e: AccountEvent): void => events.forEach((l) => l(e))

async function call<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, code: data?.error?.code ?? 'error', message: data?.error?.message ?? 'error' }
  return { ok: true, data }
}

const signedIn = async (
  p: Promise<Awaited<ReturnType<typeof call<Server & { token: string }>>>>
): Promise<AccountResult> => {
  const r = await p
  if (!r.ok) return r
  token = r.data.token
  publish(r.data)
  emit({ type: 'signed-in' })
  return { ok: true, state }
}

async function refresh(): Promise<AccountState> {
  if (!token) return state
  const was = state.plan
  const r = await call<Server>('GET', '/v1/me')
  if (r.ok) {
    if (awaiting && r.data.plan === 'pro') {
      awaiting = false
      if (poll) clearInterval(poll)
    }
    publish(r.data)
    if (was !== 'pro' && r.data.plan === 'pro') emit({ type: 'upgraded' })
  }
  return state
}

export const accountApi = {
  get: async () => state,
  refresh,
  apiUrl: async () => '/api',
  signup: (a: object) => signedIn(call('POST', '/v1/auth/signup', a)),
  login: (a: object) => signedIn(call('POST', '/v1/auth/login', a)),
  emailStart: async (email: string, purpose = 'login'): Promise<AccountResult> => {
    const r = await call('POST', '/v1/auth/email/start', { email, purpose })
    return r.ok ? { ok: true, state } : r
  },
  emailVerify: (a: object) => signedIn(call('POST', '/v1/auth/email/verify', a)),
  resetPassword: (a: object) => signedIn(call('POST', '/v1/auth/password/reset', a)),
  update: async (p: object): Promise<AccountResult> => {
    const r = await call<Server>('PATCH', '/v1/me', p)
    if (!r.ok) return r
    publish(r.data)
    return { ok: true, state }
  },
  changePassword: async (p: object): Promise<AccountResult> => {
    const r = await call('POST', '/v1/me/password', p)
    return r.ok ? { ok: true, state: await refresh() } : r
  },
  logout: async () => {
    await call('POST', '/v1/me/logout')
    token = null
    publish(null)
    emit({ type: 'signed-out' })
    return state
  },
  remove: async (): Promise<AccountResult> => {
    const r = await call('DELETE', '/v1/me')
    if (!r.ok) return r
    token = null
    publish(null)
    return { ok: true, state }
  },
  plans: async () => {
    const r = await call<{ plans: unknown[]; enabled: boolean }>('GET', '/v1/billing/plans')
    return r.ok ? r.data : { plans: [], enabled: false }
  },
  promoCheck: async (code: string) => {
    const r = await call<Record<string, unknown>>('POST', '/v1/promo/check', { code })
    return r.ok ? { ok: true, promo: r.data } : r
  },
  promoRedeem: async (code: string): Promise<AccountResult> => {
    const was = state.plan
    const r = await call<Server>('POST', '/v1/promo/redeem', { code })
    if (!r.ok) return r
    publish(r.data)
    if (was !== 'pro' && r.data.plan === 'pro') emit({ type: 'upgraded' })
    return { ok: true, state }
  },
  checkout: async (plan: string, code?: string): Promise<AccountResult> => {
    const r = await call<{ url: string; checkoutId: string }>('POST', '/v1/billing/checkout', {
      plan,
      ...(code ? { code } : {})
    })
    if (!r.ok) return r
    ;(window as unknown as { __checkout: unknown }).__checkout = r.data
    awaiting = true
    poll ??= setInterval(() => void refresh(), 700)
    publish(state.user ? { user: state.user, plan: state.plan, subscription: state.subscription } : null)
    return { ok: true, state }
  },
  cancelWaiting: async () => {
    awaiting = false
    if (poll) clearInterval(poll)
    poll = null
    publish(state.user ? { user: state.user, plan: state.plan, subscription: state.subscription } : null)
    return state
  },
  portal: async (): Promise<AccountResult> => {
    const r = await call<{ url: string }>('POST', '/v1/billing/portal')
    if (!r.ok) return r
    ;(window as unknown as { __portal: unknown }).__portal = r.data.url
    return { ok: true, state }
  },
  onChanged: (cb: (s: AccountState) => void) => {
    changed.add(cb)
    return () => changed.delete(cb)
  },
  onEvent: (cb: (e: AccountEvent) => void) => {
    events.add(cb)
    return () => events.delete(cb)
  }
}
;(window as unknown as { __token: () => string | null }).__token = () => token
