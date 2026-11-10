// First-run welcome: account → plan → permissions → ready. Toom needs an account, so the account
// step can't be skipped. `signInOnly` is the same window later on, when someone is signed out.
import { AppIcon, Wordmark } from '@renderer/lib/brand'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@renderer/lib/api'
import { useAccount } from '@renderer/lib/account'
import { useSettings } from '@renderer/lib/settings'
import { Button, Kbd, cx } from '@renderer/lib/ui'
import {
  CheckCircle2,
  ChevronLeft,
  Crown,
  MagicWand,
  Mic,
  MousePointer2,
  ScreenRecord,
  Shield,
  Sparkles,
  Video
} from '@renderer/lib/icons'
import { AuthForm, PlanPicker } from '@renderer/account/AccountUi'
import { formatAccelerator } from '@renderer/settings/ShortcutInput'

type Step = 'welcome' | 'account' | 'plan' | 'permissions' | 'ready'
const STEPS: Step[] = ['welcome', 'account', 'plan', 'permissions', 'ready']

type Perms = { screen: string; camera: string; microphone: string; accessibility: boolean }

export function Onboarding({ signInOnly = false }: { signInOnly?: boolean }): React.JSX.Element {
  const account = useAccount()
  const { settings } = useSettings()
  const [step, setStep] = useState<Step>(signInOnly ? 'account' : 'welcome')
  useEffect(() => {
    if (signInOnly) setStep('account')
  }, [signInOnly])
  const [platform, setPlatform] = useState('darwin')
  const [perms, setPerms] = useState<Perms | null>(null)
  const isMac = platform === 'darwin'

  const refreshPerms = useCallback(() => void api.permissions.status().then(setPerms), [])
  useEffect(() => {
    document.title = 'Welcome to Toom'
    void api.platform().then(setPlatform)
    refreshPerms()
    window.addEventListener('focus', refreshPerms)
    return () => window.removeEventListener('focus', refreshPerms)
  }, [refreshPerms])

  // Signing in (here, or through the emailed link) moves on by itself; so does upgrading.
  useEffect(() => {
    return api.account.onEvent((e) => {
      // (sign-in only: the app takes over and closes this window)
      if (e.type === 'signed-in' && !signInOnly) setStep((s) => (s === 'account' ? 'plan' : s))
      if (e.type === 'upgraded') setStep((s) => (s === 'plan' ? 'permissions' : s))
    })
  }, [signInOnly])
  useEffect(() => {
    if (step === 'plan' && account?.plan === 'pro') setStep('permissions')
  }, [step, account?.plan])

  const next = (): void => {
    // no way past the account step without signing in
    if (step === 'account' && !account?.user) return
    let i = STEPS.indexOf(step) + 1
    // already signed in → straight to plans; no account → plans need one, skip them
    if (STEPS[i] === 'account' && account?.user) i++
    if (STEPS[i] === 'plan' && (!account?.user || account.plan === 'pro')) i++
    setStep(STEPS[Math.min(i, STEPS.length - 1)])
  }
  const back = (): void => {
    let i = STEPS.indexOf(step) - 1
    if (STEPS[i] === 'plan' && (!account?.user || account.plan === 'pro')) i--
    if (STEPS[i] === 'account' && account?.user) i--
    setStep(STEPS[Math.max(0, i)])
  }

  const index = STEPS.indexOf(step)
  const recordKeys = formatAccelerator(settings?.shortcuts.toggleRecording ?? '', isMac)
  const launcherKeys = formatAccelerator(settings?.shortcuts.showLauncher ?? '', isMac)

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-ink-950/70">
      <div
        className="ambient -z-10 opacity-80"
        style={{
          background:
            'radial-gradient(45% 55% at 12% 0%, #5a45f5, transparent), radial-gradient(40% 50% at 100% 100%, #0e7490, transparent)'
        }}
      />
      {/* title bar strip (traffic lights, dragging) */}
      <header className="drag h-10 shrink-0" />

      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-10 pb-6">
        <div key={step} className="animate-fade-in flex w-full flex-1 flex-col items-center justify-center py-4">
          {step === 'welcome' && (
            <div className="flex max-w-[460px] flex-col items-center text-center">
              <AppIcon size={80} />
              <h1 className="mt-6 text-[28px] font-semibold tracking-tight">Welcome to Toom</h1>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-300">
                Record your screen and get a polished video — automatic zooms, a smooth cursor and beautiful
                backgrounds, with no editing skills needed.
              </p>
              <div className="mt-7 grid w-full grid-cols-3 gap-2.5 text-left">
                {[
                  [<MagicWand key="a" size={18} />, 'Auto zoom', 'Follows your clicks'],
                  [<MousePointer2 key="b" size={18} />, 'Smooth cursor', 'Glides, never jitters'],
                  [<Shield key="c" size={18} />, 'Private', 'Hides emails & keys']
                ].map(([icon, title, sub]) => (
                  <div key={String(title)} className="glass-card rounded-[16px] p-3.5">
                    <span className="text-brand-300">{icon}</span>
                    <div className="mt-2 text-[12.5px] font-medium">{title}</div>
                    <div className="text-[11px] text-ink-300">{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'account' && (
            <div className="w-full max-w-[380px]">
              {signInOnly && (
                <div className="mb-5 flex flex-col items-center text-center">
                  <AppIcon size={56} />
                  <h1 className="mt-4 text-[22px] font-semibold tracking-tight">Sign in to Toom</h1>
                  <p className="mt-1 text-[13px] text-ink-300">You need a Toom account to record and edit.</p>
                </div>
              )}
              <div className="glass-card rounded-[22px] p-6">
                <AuthForm onDone={() => !signInOnly && setStep('plan')} />
              </div>
              <p className="mt-3 text-center text-[11.5px] text-ink-300">
                Your recordings stay on this computer. The account only holds your plan.
              </p>
            </div>
          )}

          {step === 'plan' && account?.user && (
            <div className="w-full max-w-[540px]">
              <div className="mb-5 text-center">
                <h1 className="flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight">
                  <Crown size={20} className="text-amber-300" /> Choose your plan
                </h1>
                <p className="mt-1 text-[13px] text-ink-300">
                  Start free, upgrade any time — or enter a code below to unlock Pro.
                </p>
              </div>
              <PlanPicker account={account} onFree={next} codeOpen />
            </div>
          )}

          {step === 'permissions' && (
            <div className="w-full max-w-[440px]">
              <div className="mb-5 text-center">
                <h1 className="text-[22px] font-semibold tracking-tight">A few permissions</h1>
                <p className="mt-1 text-[13px] text-ink-300">
                  {isMac
                    ? 'macOS asks before any app can see your screen. You can change these later in Settings.'
                    : 'You can change these later in Settings.'}
                </p>
              </div>
              <div className="glass-card divide-y divide-white/[0.06] rounded-[18px]">
                {perms &&
                  (
                    [
                      [
                        'screen',
                        <ScreenRecord key="s" size={18} />,
                        'Screen recording',
                        'Required to record',
                        perms.screen === 'granted'
                      ],
                      [
                        'microphone',
                        <Mic key="m" size={18} />,
                        'Microphone',
                        'For narration',
                        perms.microphone === 'granted'
                      ],
                      [
                        'camera',
                        <Video key="c" size={18} />,
                        'Camera',
                        'For a webcam bubble',
                        perms.camera === 'granted'
                      ],
                      [
                        'accessibility',
                        <MousePointer2 key="a" size={18} />,
                        isMac ? 'Accessibility' : 'Click tracking',
                        'Lets auto zoom follow your clicks',
                        perms.accessibility
                      ]
                    ] as const
                  ).map(([k, icon, label, desc, ok]) => (
                    <div key={k} className="flex items-center gap-3 px-4 py-3">
                      <span className={ok ? 'text-emerald-300' : 'text-ink-300'}>{icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">{label}</div>
                        <div className="text-[11px] text-ink-300">{desc}</div>
                      </div>
                      {ok ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <CheckCircle2 size={14} /> Allowed
                        </span>
                      ) : (
                        <Button size="sm" onClick={() => void api.permissions.request(k).then(refreshPerms)}>
                          {k === 'screen' ? 'Open Settings' : 'Allow'}
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
              {isMac && perms && perms.screen !== 'granted' && (
                <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink-300">
                  Turn on Toom under Screen & System Audio Recording, then come back. macOS may ask you to reopen Toom.
                </p>
              )}
            </div>
          )}

          {step === 'ready' && (
            <div className="flex max-w-[440px] flex-col items-center text-center">
              <div className="grid size-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Sparkles size={30} />
              </div>
              <h1 className="mt-5 text-[24px] font-semibold tracking-tight">You’re all set</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-300">
                {account?.plan === 'pro' ? 'Toom Pro is unlocked. ' : 'You’re on the Free plan. '}
                Here’s how to start a recording:
              </p>
              <div className="glass-card mt-6 w-full divide-y divide-white/[0.06] rounded-[18px] text-left">
                <div className="flex items-center justify-between px-4 py-3 text-[13px]">
                  Open the recording bar
                  <span className="flex gap-1">
                    {launcherKeys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[13px]">
                  Start or stop recording
                  <span className="flex gap-1">
                    {recordKeys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[13px]">
                  Find Toom any time
                  <span className="text-[12px] text-ink-300">{isMac ? 'Menu bar icon' : 'System tray icon'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-white/[0.06] px-6">
        <div className="flex items-center gap-3 justify-self-start">
          <span className="flex items-center gap-1.5" aria-label="Toom">
            <AppIcon size={19} />
            <Wordmark height={8} tone="white" />
          </span>
          {index > 0 && step !== 'ready' && !signInOnly && (
            <Button variant="ghost" onClick={back}>
              <ChevronLeft size={14} /> Back
            </Button>
          )}
        </div>
        {/* progress, centered between Back and the next action */}
        <div
          className={cx('flex items-center gap-1.5', signInOnly && 'invisible')}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          aria-label={`Step ${index + 1} of ${STEPS.length}`}
        >
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cx(
                'h-1.5 rounded-full transition-all duration-300',
                i === index ? 'w-6 bg-white' : i < index ? 'w-1.5 bg-white/60' : 'w-1.5 bg-white/20'
              )}
            />
          ))}
        </div>
        <div className="flex gap-2 justify-self-end">
          {step === 'account' && signInOnly && (
            <Button variant="ghost" onClick={() => void api.app.quit()}>
              Quit Toom
            </Button>
          )}
          {step === 'welcome' && (
            <Button variant="primary" size="lg" onClick={next}>
              Get started
            </Button>
          )}
          {step === 'plan' && (
            <Button variant="ghost" onClick={next}>
              Decide later
            </Button>
          )}
          {step === 'permissions' && (
            <Button variant="primary" size="lg" onClick={next}>
              Continue
            </Button>
          )}
          {step === 'ready' && (
            <Button variant="primary" size="lg" onClick={() => void api.onboarding.finish()}>
              Start recording
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
