import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/api'
import { useAccount, useUpdateStatus } from '@renderer/lib/account'
import { Button, Toggle } from '@renderer/lib/ui'
import { CreditCard, Crown, Download, LogOut, Refresh } from '@renderer/lib/icons'
import { AuthForm, FormError, PlanPicker, Spinner, TextInput } from '@renderer/account/AccountUi'
import type { AccountEvent } from '@shared/account'
import { Group, Item } from './parts'

const dateLabel = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''

function statusLine(s: NonNullable<ReturnType<typeof useAccount>>): string {
  const sub = s.subscription
  if (!sub) return s.plan === 'pro' ? 'Pro' : 'Free plan'
  const end = dateLabel(sub.currentPeriodEnd)
  if (s.plan !== 'pro')
    return sub.status === 'canceled' || sub.status === 'cancelled' ? 'Pro ended — on the Free plan' : 'Free plan'
  if (sub.status === 'trialing') return `Free trial · ${sub.cancelAtPeriodEnd ? 'ends' : 'first payment'} ${end}`
  if (sub.status === 'past_due') return 'Payment failed — update your card to keep Pro'
  if (sub.cancelAtPeriodEnd) return `Cancelled · Pro until ${end}`
  return `${sub.interval === 'year' ? 'Yearly' : 'Monthly'} · renews ${end}`
}

export function AccountSection(): React.JSX.Element {
  const account = useAccount()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [pw, setPw] = useState({ current: '', next: '', open: false })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    return api.account.onEvent((e: AccountEvent) => {
      if (e.type === 'upgraded') setNotice('Welcome to Toom Pro — everything’s unlocked.')
      if (e.type === 'checkout-cancelled') setNotice('Checkout cancelled. No charge was made.')
      if (e.type === 'error') setError(e.message)
    })
  }, [])
  useEffect(() => setName(account?.user?.name ?? ''), [account?.user?.name])

  if (!account) return <div />

  if (!account.user) {
    return (
      <>
        <div className="glass-card mx-auto max-w-[400px] rounded-[20px] p-6">
          <AuthForm />
        </div>
        <p className="mx-auto mt-4 max-w-[400px] text-center text-[11.5px] leading-relaxed text-ink-400">
          An account keeps your plan with you on every computer. Recordings never leave your Mac or PC.
        </p>
      </>
    )
  }

  const u = account.user
  const act = async (key: string, fn: () => Promise<{ ok: boolean; message?: string } | unknown>): Promise<void> => {
    setBusy(key)
    setError('')
    setNotice('')
    const r = (await fn()) as { ok?: boolean; message?: string }
    setBusy(null)
    if (r && r.ok === false) setError(r.message ?? 'Something went wrong.')
  }

  return (
    <>
      {account.offline && (
        <p className="mb-4 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-200 ring-1 ring-amber-400/20">
          You’re offline. Toom keeps your plan for a few days without a connection.
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl bg-emerald-400/10 px-3.5 py-2.5 text-xs text-emerald-200 ring-1 ring-emerald-400/20">
          {notice}
        </p>
      )}
      <div className="mb-4 empty:hidden">
        <FormError>{error}</FormError>
      </div>

      <Group title="Profile">
        <div className="flex items-center gap-4 px-4 py-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-brand-400 to-brand-700 text-[18px] font-semibold text-[#fff]">
            {(u.name || u.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{u.name || u.email.split('@')[0]}</div>
            <div className="truncate text-[12px] text-ink-400">{u.email}</div>
          </div>
          {account.plan === 'pro' && (
            <span className="flex items-center gap-1 rounded-full bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
              <Crown size={12} /> Pro
            </span>
          )}
        </div>
        <Item label="Name">
          <div className="flex items-center gap-2">
            <TextInput
              className="w-[220px] [&_input]:h-8 [&_input]:rounded-lg [&_input]:text-[13px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            {name !== (u.name ?? '') && (
              <Button
                size="sm"
                disabled={busy === 'name'}
                onClick={() => void act('name', () => api.account.update({ name }))}
              >
                Save
              </Button>
            )}
          </div>
        </Item>
      </Group>

      <Group title="Plan">
        <Item label={account.plan === 'pro' ? 'Toom Pro' : 'Toom Free'} desc={statusLine(account)}>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              title="Refresh"
              disabled={busy === 'refresh'}
              onClick={() => void act('refresh', () => api.account.refresh())}
            >
              {busy === 'refresh' ? <Spinner /> : <Refresh size={13} />}
            </Button>
            {account.subscription?.canManage && (
              <Button
                size="sm"
                disabled={busy === 'portal'}
                onClick={() => void act('portal', () => api.account.portal())}
              >
                <CreditCard size={13} /> Manage billing
              </Button>
            )}
          </div>
        </Item>
      </Group>
      {account.plan !== 'pro' && (
        <section className="mb-7">
          <PlanPicker account={account} />
        </section>
      )}

      <Group title="Security">
        {!pw.open ? (
          <Item
            label="Password"
            desc={u.hasPassword ? 'Changing it signs you out on other computers.' : 'You sign in with emailed codes.'}
          >
            <Button size="sm" onClick={() => setPw({ current: '', next: '', open: true })}>
              {u.hasPassword ? 'Change…' : 'Set a password…'}
            </Button>
          </Item>
        ) : (
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (pw.next.length < 8) return setError('Use at least 8 characters.')
              void act('pw', async () => {
                const r = await api.account.changePassword({ current: pw.current || undefined, password: pw.next })
                if (r.ok) {
                  setPw({ current: '', next: '', open: false })
                  setNotice('Password saved.')
                }
                return r
              })
            }}
          >
            {u.hasPassword && (
              <TextInput
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            )}
            <TextInput
              label="New password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setPw({ ...pw, open: false })}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={busy === 'pw'}>
                Save password
              </Button>
            </div>
          </form>
        )}
        <Item label="Sign out" desc="Your recordings stay on this computer.">
          <Button size="sm" onClick={() => void act('logout', () => api.account.logout())}>
            <LogOut size={13} /> Sign out
          </Button>
        </Item>
        <Item
          label="Delete account"
          desc="Cancels any subscription and erases your account. Recordings stay on this computer."
        >
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void api.app
                .confirm({
                  message: 'Delete your Toom account?',
                  detail: 'Your subscription is cancelled right away and your account is erased. This can’t be undone.',
                  ok: 'Delete account',
                  destructive: true
                })
                .then((ok) => {
                  if (ok) void act('delete', () => api.account.remove())
                })
            }
          >
            Delete…
          </Button>
        </Item>
      </Group>
    </>
  )
}

export function UpdatesGroup({
  auto,
  onAuto,
  version
}: {
  auto: boolean
  onAuto: (v: boolean) => void
  version: string
}): React.JSX.Element {
  const u = useUpdateStatus()
  const desc =
    u.state === 'unsupported'
      ? u.reason
      : u.state === 'checking'
        ? 'Checking…'
        : u.state === 'none'
          ? `Toom ${version} is the latest version.`
          : u.state === 'downloading'
            ? `Downloading ${u.version}… ${u.percent}%`
            : u.state === 'ready'
              ? `Toom ${u.version} is ready. It installs when you restart Toom.`
              : u.state === 'error'
                ? u.message
                : `You have Toom ${version}.`
  return (
    <Group title="Updates">
      <Item label="Software update" desc={desc}>
        {u.state === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => void api.updater.install()}>
            <Download size={13} /> Restart to update
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={u.state === 'unsupported' || u.state === 'checking' || u.state === 'downloading'}
            onClick={() => void api.updater.check()}
          >
            {u.state === 'checking' && <Spinner />}
            Check now
          </Button>
        )}
      </Item>
      <Item
        label="Update automatically"
        desc="Downloads updates in the background and installs them when Toom restarts."
      >
        <Toggle on={auto} onChange={onAuto} />
      </Item>
    </Group>
  )
}
