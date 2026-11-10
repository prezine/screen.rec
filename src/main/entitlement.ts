import { verify, type KeyObject } from 'node:crypto'
import type { PlanTier } from '@shared/account'

// Entitlements are signed by the Toom API (toom-api: src/crypto.ts signEntitlement) with Ed25519:
// base64url(JSON payload) "." base64url(signature). The app only holds the public key.

export interface Entitlement {
  sub: string
  email?: string
  plan: PlanTier
  /** the licence key behind a Pro entitlement, and when it expires (seconds; null = never) */
  lic?: string
  licExp?: number | null
  /** the computer the key's seat belongs to (hashed hardware ID) */
  dev?: string
  iat?: number
  exp: number
}

/** Check a server-signed entitlement; null when missing, forged or malformed. */
export function readEntitlement(token: string | null | undefined, key: KeyObject | null): Entitlement | null {
  if (!token || !key) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  try {
    if (!verify(null, Buffer.from(body), key, Buffer.from(sig, 'base64url'))) return null
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Entitlement
    if (typeof p.sub !== 'string' || (p.plan !== 'pro' && p.plan !== 'free') || typeof p.exp !== 'number') return null
    return p
  } catch {
    return null
  }
}

/** The plan an entitlement grants to this user right now. */
export function entitledPlan(
  token: string | null | undefined,
  key: KeyObject | null,
  userId: string,
  now = Date.now(),
  /** this computer's ID: a Pro entitlement issued to another computer's seat doesn't count here */
  deviceId?: string | null
): PlanTier {
  const e = readEntitlement(token, key)
  if (!e || e.sub !== userId || e.exp * 1000 <= now) return 'free'
  if (e.plan === 'pro' && e.dev && deviceId && e.dev !== deviceId) return 'free'
  return e.plan
}
