import { useEffect, useState } from 'react'
import { LIMITS, type AccountState, type PlanLimits, type UpdateStatus } from '@shared/account'
import { api } from './api'

/** Live account state (owned by the main process, broadcast to every window). */
export function useAccount(): AccountState | null {
  const [state, setState] = useState<AccountState | null>(null)
  useEffect(() => {
    let alive = true
    void api.account.get().then((s) => alive && setState(s))
    const off = api.account.onChanged(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** What the current plan allows; Free until we know better. */
export function useLimits(): { limits: PlanLimits; account: AccountState | null } {
  const account = useAccount()
  return { limits: LIMITS[account?.plan ?? 'free'], account }
}

export function useUpdateStatus(): UpdateStatus {
  const [s, set] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void api.updater.status().then(set)
    return api.updater.onStatus(set)
  }, [])
  return s
}

/** Open the upgrade screen (Settings → Account). */
export function openUpgrade(): void {
  void api.app.showSettings('account')
}
