// Accounts, plans and what each plan unlocks. Shared by the main process (recording limit) and the
// renderer (export limits, watermark, upgrade prompts).

export type PlanTier = 'free' | 'pro'

export interface PlanLimits {
  /** tallest export allowed */
  maxExportHeight: 720 | 1080 | 1440 | 2160
  maxExportFps: 30 | 60
  /** small "Made with Toom" mark in the corner of exports */
  watermark: boolean
  /** seconds per recording; null = unlimited */
  maxRecordingSeconds: number | null
}

export const LIMITS: Record<PlanTier, PlanLimits> = {
  free: { maxExportHeight: 720, maxExportFps: 30, watermark: true, maxRecordingSeconds: 5 * 60 },
  pro: { maxExportHeight: 2160, maxExportFps: 60, watermark: false, maxRecordingSeconds: null }
}

export const PRO_FEATURES = [
  'Unlimited recording length',
  'Export up to 4K at 60 fps',
  'No watermark',
  'Every future Pro feature'
]

export interface AccountUser {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  hasPassword: boolean
  createdAt: string
}

export interface AccountSubscription {
  status: string
  interval: 'month' | 'year' | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canManage: boolean
}

/** Pro without a subscription: from a promo code, or given by the Toom team */
export interface AccountGrant {
  source: 'promo' | 'admin'
  /** null = for good */
  endsAt: string | null
}

/** A computer using a licence key (each key has a few seats) */
export interface LicenseDevice {
  /** the computer's hashed hardware ID */
  id: string
  name: string | null
  activatedAt: string
  lastSeen: string
  thisComputer: boolean
}

/**
 * The licence key giving this account Pro. Each period of Pro has its own key: a subscription gets a
 * new one for every billing period, a promo code or gift gets one for as long as it lasts.
 */
export interface AccountLicense {
  /** XXXXX-XXXXX-XXXXX-XXXXX-XXXXX */
  key: string
  source: 'subscription' | 'promo' | 'admin'
  startsAt: string
  /** null = never */
  expiresAt: string | null
  maxDevices: number
  devices: LicenseDevice[]
  /** why this computer isn't using the key (every seat taken), or null */
  problem: string | null
}

export const LICENSE_KEY_LENGTH = 25

/** Format what someone is typing as XXXXX-XXXXX-…, keeping only letters and digits. */
export function formatLicenseKey(input: string): string {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, LICENSE_KEY_LENGTH)
  return raw.replace(/(.{5})(?=.)/g, '$1-')
}

export const isLicenseKeyShaped = (input: string): boolean =>
  input.toUpperCase().replace(/[^0-9A-Z]/g, '').length === LICENSE_KEY_LENGTH

/** What a promo code does (from the server, before using it) */
export interface PromoInfo {
  code: string
  kind: 'free_pro' | 'discount'
  description: string | null
  /** free_pro: how long; null = for good */
  proDays: number | null
  /** discount: percent off every payment on these plans */
  percentOff: number | null
  plans: ('pro-month' | 'pro-year')[]
  /** discount: the discounted price per plan */
  prices?: Partial<Record<'pro-month' | 'pro-year', string>>
}

export interface AccountState {
  user: AccountUser | null
  plan: PlanTier
  subscription: AccountSubscription | null
  grant?: AccountGrant | null
  license?: AccountLicense | null
  /** false when this person or computer has already had a free trial (checkout then has none) */
  trialEligible?: boolean
  /** couldn't reach the server; showing what we knew last */
  offline: boolean
  /** waiting for a checkout started from this app to complete */
  awaitingPayment: boolean
}

export const SIGNED_OUT: AccountState = {
  user: null,
  plan: 'free',
  subscription: null,
  grant: null,
  license: null,
  offline: false,
  awaitingPayment: false
}

export interface PublicPlan {
  id: 'pro-month' | 'pro-year'
  interval: 'month' | 'year'
  amount: string
  currency: string
  trialDays: number
}

/** Something that happened outside the window that asked (deep link, checkout, update). */
export type AccountEvent =
  | { type: 'signed-in' }
  | { type: 'signed-out' }
  | { type: 'upgraded' }
  | { type: 'checkout-cancelled' }
  | { type: 'error'; message: string }

/** Result of an account call: either the new state or a message to show. */
export type AccountResult = { ok: true; state: AccountState } | { ok: false; code: string; message: string }
export type PromoResult = { ok: true; promo: PromoInfo } | { ok: false; code: string; message: string }

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'checking' }
  | { state: 'none'; checkedAt: number }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export function limitsFor(plan: PlanTier): PlanLimits {
  return LIMITS[plan]
}

/** Clamp export settings to what a plan allows. */
export function clampExport<T extends { resolution: number; fps: number }>(s: T, plan: PlanTier): T {
  const l = LIMITS[plan]
  return {
    ...s,
    resolution: Math.min(s.resolution, l.maxExportHeight) as T['resolution'],
    fps: Math.min(s.fps, l.maxExportFps) as T['fps']
  }
}

export function priceLabel(p: PublicPlan): string {
  const n = Number(p.amount)
  const money = Number.isFinite(n) ? `$${n % 1 ? n.toFixed(2) : n}` : p.amount
  return `${money}/${p.interval === 'year' ? 'yr' : 'mo'}`
}
