// Sign-in / sign-up forms and the plan picker, shared by the welcome window and Settings → Account.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@renderer/lib/api'
import { Button, cx } from '@renderer/lib/ui'
import { Check, Crown, KeyLock, Mail } from '@renderer/lib/icons'
import {
  LIMITS,
  PRO_FEATURES,
  priceLabel,
  type AccountResult,
  type AccountState,
  type PublicPlan
} from '@shared/account'

// ---------------------------------------------------------------------------------------------
// bits
// ---------------------------------------------------------------------------------------------

export function TextInput({
  label,
  className,
  ...rest
}: React.ComponentProps<'input'> & { label?: string }): React.JSX.Element {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-[11.5px] font-medium text-ink-300">{label}</span>}
      <input
        {...rest}
        className="no-drag h-10 w-full rounded-xl bg-black/30 px-3.5 text-[13.5px] text-ink-100 ring-1 ring-white/10 transition-shadow outline-none placeholder:text-ink-500 focus:ring-2 focus:ring-brand-400/70"
      />
    </label>
  )
}

export function FormError({ children }: { children: ReactNode }): React.JSX.Element | null {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/20">
      {children}
    </p>
  )
}

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white',
        className
      )}
    />
  )
}

const emailOk = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

/** Run an account call with a busy flag and an error message. */
function useCall(): {
  busy: boolean
  error: string
  setError: (e: string) => void
  run: (fn: () => Promise<AccountResult>) => Promise<AccountResult | null>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<AccountResult>): Promise<AccountResult | null> => {
    setBusy(true)
    setError('')
    try {
      const r = await fn()
      if (!r.ok) setError(r.message)
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

// ---------------------------------------------------------------------------------------------
// sign in / sign up
// ---------------------------------------------------------------------------------------------

type Mode = 'code' | 'signin' | 'signup' | 'reset'

/**
 * Email code (with magic link) by default; email + password as the alternative. Signing in is
 * picked up through the account broadcast, so `onDone` is only a convenience.
 */
export function AuthForm({ initial = 'code', onDone }: { initial?: Mode; onDone?: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(initial)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  /** a code has been emailed (code sign-in or password reset) */
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const { busy, error, setError, run } = useCall()
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const switchTo = (m: Mode): void => {
    setMode(m)
    setSent(false)
    setCode('')
    setError('')
  }

  const sendCode = async (purpose: 'login' | 'reset'): Promise<void> => {
    if (!emailOk(email)) return setError('Enter a valid email address.')
    const r = await run(() => api.account.emailStart(email.trim(), purpose))
    if (r?.ok) {
      setSent(true)
      setCooldown(30)
      setTimeout(() => codeRef.current?.focus(), 50)
    }
  }

  const finish = (r: AccountResult | null): void => {
    if (r?.ok) onDone?.()
  }

  const verify = async (value = code): Promise<void> => {
    if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code from the email.')
    finish(
      await run(() => api.account.emailVerify({ email: email.trim(), code: value, name: name.trim() || undefined }))
    )
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    if (mode === 'code') return sent ? verify() : sendCode('login')
    if (mode === 'reset') {
      if (!sent) return sendCode('reset')
      if (password.length < 8) return setError('Use at least 8 characters.')
      return finish(await run(() => api.account.resetPassword({ email: email.trim(), code, password })))
    }
    if (!emailOk(email)) return setError('Enter a valid email address.')
    if (mode === 'signup') {
      if (password.length < 8) return setError('Use at least 8 characters for your password.')
      const r = await run(() => api.account.signup({ email: email.trim(), password, name: name.trim() || undefined }))
      if (r && !r.ok && r.code === 'exists_passwordless') {
        switchTo('code')
        setError(r.message)
      }
      return finish(r)
    }
    finish(await run(() => api.account.login({ email: email.trim(), password })))
  }

  const codeField = (
    <div>
      <TextInput
        ref={codeRef}
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={6}
        value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
          setCode(v)
          // paste or type the last digit → sign straight in
          if (mode === 'code' && v.length === 6 && !busy) void verify(v)
        }}
        className="[&_input]:text-center [&_input]:font-mono [&_input]:text-lg [&_input]:tracking-[0.5em]"
      />
      <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-300">
        <button type="button" className="no-drag hover:text-ink-100" onClick={() => switchTo(mode)}>
          Use a different email
        </button>
        <button
          type="button"
          disabled={cooldown > 0 || busy}
          className="no-drag hover:text-ink-100 disabled:opacity-50"
          onClick={() => void sendCode(mode === 'reset' ? 'reset' : 'login')}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </div>
  )

  const title =
    mode === 'signup'
      ? 'Create your account'
      : mode === 'reset'
        ? 'Reset your password'
        : mode === 'signin'
          ? 'Sign in with your password'
          : sent
            ? 'Check your email'
            : 'Sign in or create an account'

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3.5" noValidate>
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-300">
          {mode === 'code' && !sent && 'We’ll email you a code and a one-click sign-in link. No password needed.'}
          {mode === 'code' && sent && (
            <>
              We sent a code to <span className="text-ink-100">{email.trim()}</span>. Enter it here, or click the link
              in the email on this computer.
            </>
          )}
          {mode === 'reset' && !sent && 'We’ll email you a code to set a new password.'}
          {mode === 'reset' && sent && (
            <>
              Enter the code sent to <span className="text-ink-100">{email.trim()}</span> and choose a new password.
            </>
          )}
          {mode === 'signin' && 'Welcome back.'}
          {mode === 'signup' && 'Free forever. Upgrade to Pro whenever you like.'}
        </p>
      </div>

      {mode === 'signup' && (
        <TextInput label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      {!sent && (
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      )}
      {(mode === 'signin' || mode === 'signup') && (
        <TextInput
          label="Password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {sent && codeField}
      {mode === 'reset' && sent && (
        <TextInput
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}

      <FormError>{error}</FormError>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy && <Spinner />}
        {mode === 'code'
          ? sent
            ? 'Sign in'
            : 'Email me a code'
          : mode === 'signup'
            ? 'Create account'
            : mode === 'reset'
              ? sent
                ? 'Set password and sign in'
                : 'Email me a code'
              : 'Sign in'}
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[12px] text-ink-300">
        {mode === 'code' ? (
          <button
            type="button"
            className="no-drag flex items-center gap-1.5 hover:text-ink-100"
            onClick={() => switchTo('signin')}
          >
            <KeyLock size={13} /> Use a password instead
          </button>
        ) : (
          <button
            type="button"
            className="no-drag flex items-center gap-1.5 hover:text-ink-100"
            onClick={() => switchTo('code')}
          >
            <Mail size={13} /> Email me a code instead
          </button>
        )}
        {mode === 'signin' && (
          <>
            <button type="button" className="no-drag hover:text-ink-100" onClick={() => switchTo('signup')}>
              Create an account
            </button>
            <button type="button" className="no-drag hover:text-ink-100" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
          </>
        )}
        {mode === 'signup' && (
          <button type="button" className="no-drag hover:text-ink-100" onClick={() => switchTo('signin')}>
            I have an account
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------------------------

export function usePlans(): { plans: PublicPlan[]; enabled: boolean; loaded: boolean } {
  const [s, set] = useState<{ plans: PublicPlan[]; enabled: boolean; loaded: boolean }>({
    plans: [],
    enabled: false,
    loaded: false
  })
  useEffect(() => {
    void api.account.plans().then((r) => set({ ...r, loaded: true }))
  }, [])
  return s
}

const FREE_FEATURES = [
  `Recordings up to ${(LIMITS.free.maxRecordingSeconds ?? 0) / 60} minutes`,
  '720p, 30 fps exports',
  '“Made with Toom” mark on exports',
  'Every editing feature'
]

function Feature({ children, on }: { children: ReactNode; on?: boolean }): React.JSX.Element {
  return (
    <li className="flex items-start gap-2 text-[12.5px] text-ink-200">
      <Check size={14} className={cx('mt-0.5 shrink-0', on ? 'text-brand-300' : 'text-ink-300')} />
      {children}
    </li>
  )
}

/** Free vs Pro, with checkout. Needs a signed-in account. */
export function PlanPicker({
  account,
  onFree,
  freeLabel = 'Continue with Free'
}: {
  account: AccountState
  /** shown as a button on the Free card (welcome flow) */
  onFree?: () => void
  freeLabel?: string
}): React.JSX.Element {
  const { plans, enabled, loaded } = usePlans()
  const [interval, setIv] = useState<'month' | 'year'>('year')
  const { busy, error, run } = useCall()
  const month = plans.find((p) => p.interval === 'month')
  const year = plans.find((p) => p.interval === 'year')
  const chosen = (interval === 'year' ? year : month) ?? year ?? month
  const saving = month && year ? Math.round((1 - Number(year.amount) / (Number(month.amount) * 12)) * 100) : 0
  const pro = account.plan === 'pro'

  if (account.awaitingPayment) {
    return (
      <div className="glass-card rounded-[18px] p-5 text-center">
        <Spinner className="mx-auto mb-3 size-5" />
        <p className="text-[14px] font-medium">Finish checkout in your browser</p>
        <p className="mx-auto mt-1 max-w-[340px] text-[12.5px] leading-relaxed text-ink-300">
          Pro unlocks here as soon as the payment goes through. You can keep using Toom in the meantime.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {chosen && (
            <Button size="sm" onClick={() => void run(() => api.account.checkout(chosen.id))} disabled={busy}>
              Open checkout again
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void api.account.cancelWaiting()}>
            Cancel
          </Button>
        </div>
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {plans.length > 1 && !pro && (
        <div className="flex justify-center">
          <div className="flex gap-1 rounded-full bg-black/25 p-1 ring-1 ring-white/[0.06]">
            {(['month', 'year'] as const).map((i) => (
              <button
                key={i}
                onClick={() => setIv(i)}
                className={cx(
                  'no-drag flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium transition-colors',
                  interval === i ? 'glass-chip text-white' : 'text-ink-300 hover:text-ink-100'
                )}
              >
                {i === 'month' ? 'Monthly' : 'Yearly'}
                {i === 'year' && saving > 0 && (
                  <span className="rounded-full bg-emerald-400/15 px-1.5 text-[10px] font-semibold text-emerald-300">
                    −{saving}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className={cx('glass-card flex flex-col rounded-[18px] p-4', !pro && 'ring-1 ring-white/15')}>
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold">Free</span>
            {!pro && <span className="text-[10.5px] font-medium text-ink-300">Current</span>}
          </div>
          <div className="mt-1 text-[22px] font-semibold tracking-tight">$0</div>
          <ul className="mt-3 flex-1 space-y-1.5">
            {FREE_FEATURES.map((f) => (
              <Feature key={f}>{f}</Feature>
            ))}
          </ul>
          {onFree && !pro && (
            <Button className="mt-4 w-full" onClick={onFree}>
              {freeLabel}
            </Button>
          )}
        </div>

        <div className="relative flex flex-col overflow-hidden rounded-[18px] bg-gradient-to-b from-brand-500/25 to-brand-700/10 p-4 ring-1 ring-brand-400/40">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold">
              <Crown size={15} className="text-amber-300" /> Pro
            </span>
            {pro && <span className="text-[10.5px] font-medium text-brand-300">Current</span>}
          </div>
          <div className="mt-1 text-[22px] font-semibold tracking-tight">
            {chosen ? priceLabel(chosen) : loaded ? '—' : <Spinner />}
            {chosen?.interval === 'year' && month && (
              <span className="ml-1.5 text-[11.5px] font-normal text-ink-300">
                ${(Number(chosen.amount) / 12).toFixed(2)}/mo
              </span>
            )}
          </div>
          <ul className="mt-3 flex-1 space-y-1.5">
            {PRO_FEATURES.map((f) => (
              <Feature key={f} on>
                {f}
              </Feature>
            ))}
          </ul>
          {!pro && (
            <Button
              variant="primary"
              className="mt-4 w-full"
              disabled={busy || !enabled || !chosen}
              onClick={() => chosen && void run(() => api.account.checkout(chosen.id))}
            >
              {busy && <Spinner />}
              {chosen?.trialDays ? `Start ${chosen.trialDays}-day free trial` : 'Upgrade to Pro'}
            </Button>
          )}
        </div>
      </div>
      {loaded && !enabled && !pro && (
        <p className="text-center text-[11.5px] text-ink-300">
          Upgrades aren’t available right now{account.offline ? ' — you’re offline' : ''}.
        </p>
      )}
      {chosen?.trialDays && !pro && enabled ? (
        <p className="text-center text-[11.5px] text-ink-300">
          Checkout opens in your browser, secured by Bachs. Cancel any time before the trial ends and you won’t be
          charged.
        </p>
      ) : null}
      <FormError>{error}</FormError>
    </div>
  )
}
