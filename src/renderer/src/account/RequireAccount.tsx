import type { ReactNode } from 'react'
import { api } from '@renderer/lib/api'
import { useAccount } from '@renderer/lib/account'
import { AppIcon } from '@renderer/lib/brand'
import { Button } from '@renderer/lib/ui'

/**
 * Toom needs an account. The main process already keeps signed-out people out of these windows;
 * this is the second lock, in case one is open when the session ends.
 */
export function RequireAccount({ children }: { children: ReactNode }): React.JSX.Element {
  const account = useAccount()
  if (!account) return <div className="h-full" />
  if (account.user) return <>{children}</>
  return (
    <div className="flex h-full flex-col">
      <header className="drag h-10 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 text-center">
        <AppIcon size={56} />
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Sign in to use Toom</h1>
        <p className="mt-1 max-w-[320px] text-[13px] text-ink-300">Your recordings are still on this computer. Sign in to open them again.</p>
        <Button className="mt-5" variant="primary" size="lg" onClick={() => void api.account.showSignIn()}>
          Sign in
        </Button>
      </div>
    </div>
  )
}
