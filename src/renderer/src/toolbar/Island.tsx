import { useEffect, useRef, useState } from 'react'
import { Check, Pause, Play, Square, Trash, X } from '@renderer/lib/icons'
import type { RecState } from '@shared/types'
import { api } from '@renderer/lib/api'
import { formatTime } from '@renderer/engine/math'
import { cx } from '@renderer/lib/ui'

type Info = Awaited<ReturnType<typeof api.island.info>>

/** "On air" bars next to the timer (CSS-animated, so the island doesn't re-render every frame). */
function Bars({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span className="flex h-3.5 items-center gap-[2px]">
      {[0.9, 1.3, 0.7, 1.1].map((d, i) => (
        <span
          key={i}
          className="eq-bar h-full w-[2.5px] origin-center rounded-full bg-red-400"
          style={{
            animationDuration: `${d}s`,
            animationDelay: `${-i * 0.23}s`,
            animationPlayState: active ? 'running' : 'paused'
          }}
        />
      ))}
    </span>
  )
}

function RoundBtn({
  label,
  onClick,
  children,
  tone = 'glass',
  size = 40
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  tone?: 'glass' | 'red' | 'white'
  size?: number
}): React.JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={cx(
        'grid shrink-0 place-items-center rounded-full transition-transform active:scale-95',
        tone === 'red' &&
          'bg-red-500 text-[#fff] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_-6px_rgba(239,68,68,0.9)] hover:bg-red-400',
        tone === 'white' && 'bg-white text-black hover:bg-ink-100',
        tone === 'glass' && 'glass-chip text-white hover:brightness-125'
      )}
    >
      {children}
    </button>
  )
}

export function Island(): React.JSX.Element {
  const [state, setState] = useState<RecState>({ phase: 'countdown', elapsed: 0, countdown: 3 })
  const [info, setInfo] = useState<Info | null>(null)
  const [hover, setHover] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const ignoring = useRef(true)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => api.toolbar.onState(setState), [])
  useEffect(() => {
    void api.island.info().then(setInfo)
  }, [])

  const onMouseMove = (e: React.MouseEvent): void => {
    const interactive = !!(e.target as HTMLElement).closest('[data-interactive]')
    if (interactive === !ignoring.current) return
    ignoring.current = !interactive
    void api.island.setIgnoreMouse(!interactive)
  }
  const enter = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setHover(true)
  }
  const leave = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => {
      setHover(false)
      setConfirm(false)
    }, 450)
  }

  const cmd = (c: Parameters<typeof api.toolbar.command>[0]): void => void api.toolbar.command(c)
  const countdown = state.phase === 'countdown'
  const paused = state.phase === 'paused'
  const finishing = state.phase === 'finishing'
  // Free plan: count down the last 30 seconds
  const left = state.limit ? Math.max(0, state.limit - state.elapsed) : Infinity
  const nearLimit = !finishing && left <= 30
  const expanded = (hover && !finishing) || countdown || confirm

  const notch = !!info?.notch
  const mbh = info?.menuBarHeight ?? 32
  const nw = info?.notchWidth ?? 0
  const W = expanded ? (countdown ? 300 : 420) : notch ? nw + 2 * 96 : 210
  const H = expanded ? (notch ? mbh + 70 : 78) : notch ? mbh : 36
  const radius = expanded ? 30 : notch ? 13 : 18

  const dot = (
    <span
      className={cx(
        'size-2.5 shrink-0 rounded-full',
        paused ? 'bg-amber-400' : 'animate-pulse-dot bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]'
      )}
    />
  )

  return (
    <div className="flex h-full justify-center" onMouseMove={onMouseMove}>
      <div
        data-interactive
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={cx(
          'island relative overflow-visible bg-black text-white',
          !notch && 'mt-1.5 ring-1 ring-white/[0.08]',
          expanded && 'shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]'
        )}
        style={{
          width: W,
          height: H,
          borderRadius: notch ? `0 0 ${radius}px ${radius}px` : radius
        }}
      >
        {/* concave "ears" so the island flows out of the screen edge like the notch */}
        {notch && (
          <>
            <span
              className="absolute top-0 -left-[10px] size-[10px]"
              style={{ background: 'radial-gradient(circle at 0 100%, transparent 9.5px, #000 10px)' }}
            />
            <span
              className="absolute top-0 -right-[10px] size-[10px]"
              style={{ background: 'radial-gradient(circle at 100% 100%, transparent 9.5px, #000 10px)' }}
            />
          </>
        )}

        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 'inherit' }}>
          {/* collapsed: status on the left wing, stop on the right wing (the notch hides the middle) */}
          {!expanded && (
            <div className="flex h-full items-center justify-between px-3.5">
              <span className="flex items-center gap-2 text-[13px] font-semibold tabular-nums">
                {finishing ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                ) : (
                  dot
                )}
                <span className={cx(nearLimit && 'text-amber-300')}>
                  {finishing ? 'Saving' : nearLimit ? `${formatTime(left)} left` : formatTime(state.elapsed)}
                </span>
              </span>
              {notch && <span style={{ width: nw }} />}
              {finishing ? (
                <span />
              ) : (
                <span className="flex items-center gap-2.5">
                  {!notch && <Bars active={!paused} />}
                  <button
                    title="Stop and edit"
                    onClick={() => cmd('stop')}
                    className="grid size-[22px] place-items-center rounded-full bg-red-500 hover:bg-red-400"
                  >
                    <Square size={10} fill="currentColor" />
                  </button>
                </span>
              )}
            </div>
          )}

          {/* countdown */}
          {expanded && countdown && (
            <div className="flex h-full items-end justify-between px-5 pb-4">
              <div className="flex items-baseline gap-3">
                <span
                  key={state.countdown}
                  className="countdown-pop text-[40px] leading-none font-semibold tabular-nums"
                >
                  {state.countdown ?? ''}
                </span>
                <span className="text-[13px] text-ink-300">Recording starts…</span>
              </div>
              <RoundBtn label="Cancel" onClick={() => cmd('cancel')} size={34}>
                <X size={15} />
              </RoundBtn>
            </div>
          )}

          {/* expanded controls */}
          {expanded && !countdown && (
            <div className="flex h-full items-end justify-between gap-3 px-4 pb-4">
              {confirm ? (
                <>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">Discard this recording?</div>
                    <div className="text-[11.5px] text-ink-400">What you’ve recorded will be deleted.</div>
                  </div>
                  <div className="flex gap-2">
                    <RoundBtn label="Keep recording" onClick={() => setConfirm(false)} size={36}>
                      <X size={15} />
                    </RoundBtn>
                    <RoundBtn label="Discard" tone="red" onClick={() => cmd('cancel')} size={36}>
                      <Check size={16} />
                    </RoundBtn>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-3">
                    {dot}
                    <div>
                      <div className="text-[22px] leading-none font-semibold tabular-nums">
                        {formatTime(state.elapsed)}
                      </div>
                      <div className={cx('mt-1 text-[11px]', nearLimit ? 'text-amber-300' : 'text-ink-400')}>
                        {paused
                          ? 'Paused'
                          : state.limit
                            ? `Free plan · stops at ${formatTime(state.limit)}`
                            : 'Recording'}
                      </div>
                    </div>
                    {!paused && <Bars active />}
                  </div>
                  <div className="flex items-center gap-2">
                    <RoundBtn label="Discard" onClick={() => setConfirm(true)} size={36}>
                      <Trash size={15} />
                    </RoundBtn>
                    <RoundBtn
                      label={paused ? 'Resume' : 'Pause'}
                      tone="white"
                      onClick={() => cmd(paused ? 'resume' : 'pause')}
                    >
                      {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
                    </RoundBtn>
                    <RoundBtn label="Stop and edit" tone="red" onClick={() => cmd('stop')}>
                      <Square size={14} fill="currentColor" />
                    </RoundBtn>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
