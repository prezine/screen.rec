import { useEffect, useState } from 'react'
import { Pause, Play, Square, Trash } from '@renderer/lib/icons'
import type { RecState } from '@shared/types'
import { api } from '@renderer/lib/api'
import { formatTime } from '@renderer/engine/math'
import { cx } from '@renderer/lib/ui'

function TBtn({
  label,
  onClick,
  disabled,
  children,
  danger
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'no-drag grid size-9 place-items-center rounded-[10px] transition-colors disabled:opacity-40',
        danger ? 'bg-red-500 text-[#fff] hover:bg-red-400' : 'text-ink-100 hover:bg-white/10'
      )}
    >
      {children}
    </button>
  )
}

export function Toolbar(): React.JSX.Element {
  const [state, setState] = useState<RecState>({ phase: 'countdown', elapsed: 0, countdown: 3 })
  useEffect(() => api.toolbar.onState(setState), [])

  const paused = state.phase === 'paused'
  const finishing = state.phase === 'finishing'
  const countdown = state.phase === 'countdown'

  return (
    <div className="flex h-full items-center justify-center">
      <div className="drag flex h-12 items-center gap-1 rounded-2xl bg-ink-900/90 pr-1.5 pl-4 shadow-[0_10px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-xl">
        <span className={cx('mr-1 size-2.5 rounded-full', paused ? 'bg-amber-400' : 'animate-pulse-dot bg-red-500')} />
        {countdown ? (
          <span className="mr-2 text-sm font-semibold">Recording in {state.countdown ?? 0}…</span>
        ) : (
          <span
            className={cx(
              'mr-1 min-w-[54px] text-sm font-semibold tabular-nums',
              state.limit && state.limit - state.elapsed <= 30 && 'text-amber-300'
            )}
            title={state.limit ? `Free plan: recordings stop at ${formatTime(state.limit)}` : undefined}
          >
            {finishing ? 'Saving…' : formatTime(state.elapsed)}
          </span>
        )}
        {!countdown && (
          <TBtn
            label={paused ? 'Resume' : 'Pause'}
            disabled={finishing}
            onClick={() => void api.toolbar.command(paused ? 'resume' : 'pause')}
          >
            {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
          </TBtn>
        )}
        <TBtn
          label={countdown ? 'Cancel' : 'Discard recording'}
          disabled={finishing}
          onClick={() => {
            if (countdown) return void api.toolbar.command('cancel')
            void api.app
              .confirm({
                message: 'Discard this recording?',
                detail: 'What you’ve recorded so far will be deleted.',
                ok: 'Discard',
                destructive: true
              })
              .then((ok) => {
                if (ok) void api.toolbar.command('cancel')
              })
          }}
        >
          <Trash size={16} />
        </TBtn>
        {!countdown && (
          <TBtn label="Stop and edit" danger disabled={finishing} onClick={() => void api.toolbar.command('stop')}>
            <Square size={14} fill="currentColor" />
          </TBtn>
        )}
      </div>
    </div>
  )
}
