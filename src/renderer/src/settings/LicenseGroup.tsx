import { useState } from 'react'
import { api } from '@renderer/lib/api'
import { Button } from '@renderer/lib/ui'
import { Check, Monitor } from '@renderer/lib/icons'
import { FormError, Spinner, TextInput } from '@renderer/account/AccountUi'
import { formatLicenseKey, isLicenseKeyShaped, type AccountState } from '@shared/account'
import { Group, Item } from './parts'

const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

const ago = (iso: string): string => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/**
 * Settings → Account → Licence: the key behind this account's Pro (a new one each billing period),
 * the computers using it, and a field to enter a key or free-Pro code.
 */
export function LicenseGroup({ account }: { account: AccountState }): React.JSX.Element {
  const lic = account.license ?? null
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [entering, setEntering] = useState(false)

  const activate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy('activate')
    setError('')
    const r = await api.account.licenseActivate(key.trim())
    setBusy(null)
    if (!r.ok) return setError(r.message)
    setKey('')
    setEntering(false)
  }
  const free = async (id: string): Promise<void> => {
    setBusy(id)
    setError('')
    const r = await api.account.licenseDeactivate(id)
    setBusy(null)
    if (!r.ok) setError(r.message)
  }
  const copy = async (): Promise<void> => {
    if (!lic) return
    await navigator.clipboard.writeText(lic.key).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const validity = lic
    ? lic.expiresAt
      ? lic.source === 'subscription'
        ? `Valid until ${dateLabel(lic.expiresAt)}. Each renewal comes with a new key, which Toom picks up by itself.`
        : `Valid until ${dateLabel(lic.expiresAt)}.`
      : 'Never expires.'
    : ''

  return (
    <Group
      title="Licence"
      footer={
        lic
          ? `A key works on up to ${lic.maxDevices} computers at once. We also email each new key to you.`
          : 'Got a licence key or a free-Pro code? Enter it here to unlock Pro on this computer.'
      }
    >
      {lic && (
        <Item label="Licence key" desc={validity} stack>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white/[0.06] px-3 py-2 font-mono text-[13px] tracking-wide text-ink-100 select-all">
              {lic.key}
            </code>
            <Button size="sm" onClick={() => void copy()}>
              {copied ? <Check size={13} /> : null}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Item>
      )}

      {lic?.problem && (
        <div className="px-4 py-3">
          <FormError>{lic.problem}</FormError>
        </div>
      )}

      {lic && (
        <Item label={`Computers (${lic.devices.length} of ${lic.maxDevices})`} stack>
          {lic.devices.length === 0 ? (
            <p className="text-[12px] text-ink-400">No computers yet. This one is added when Toom next checks your plan.</p>
          ) : (
            <ul className="space-y-2">
              {lic.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-ink-300">
                    <Monitor size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-ink-100">
                      {d.name || 'A computer'}
                      {d.thisComputer && <span className="ml-1.5 text-[11px] text-emerald-400">This computer</span>}
                    </div>
                    <div className="text-[11px] text-ink-400">Last used {ago(d.lastSeen)}</div>
                  </div>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void free(d.id)}>
                    {busy === d.id && <Spinner />} Deactivate
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Item>
      )}

      {!lic || entering ? (
        <form onSubmit={(e) => void activate(e)} className="flex items-end gap-2 px-4 py-3.5">
          <TextInput
            label={lic ? 'Use a different key' : 'Enter a licence key'}
            className="flex-1"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoCapitalize="characters"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              const v = e.target.value
              // a full key gets its dashes; older promo codes are left as typed
              setKey(isLicenseKeyShaped(v) ? formatLicenseKey(v) : v.toUpperCase())
            }}
          />
          <Button
            type="submit"
            variant="primary"
            className="h-10"
            disabled={!!busy || !key.trim()}
          >
            {busy === 'activate' && <Spinner />} Activate
          </Button>
        </form>
      ) : (
        <Item label="Have another key?" desc="A gifted key, or one from a different purchase.">
          <Button size="sm" onClick={() => setEntering(true)}>
            Enter key…
          </Button>
        </Item>
      )}

      {error && (
        <div className="px-4 py-3">
          <FormError>{error}</FormError>
        </div>
      )}
    </Group>
  )
}
