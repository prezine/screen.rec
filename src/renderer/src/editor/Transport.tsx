import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Trash,
  Gauge,
  KeyboardKeys,
  ZoomIn,
  ZoomOut
} from '@renderer/lib/icons'
import { firstStart, lastEnd, toOutput, totalLength, type Clip } from '@shared/clips'
import { formatTime } from '@renderer/engine/math'
import { Dropdown, IconButton, MenuItem, cx } from '@renderer/lib/ui'

const SPEEDS = [1, 1.5, 2, 3, 4, 8]

interface Props {
  time: number
  clips: Clip[]
  /** clip whose speed the menu edits */
  selectedClip: Clip | null
  onClipSpeed: (speed: number, mute: boolean) => void
  /** typing bursts found in the recording */
  typingCount: number
  onSpeedUpTyping: (speed: number) => void
  onClearSpeed: () => void
  canDeleteClip: boolean
  onSplit: () => void
  onDeleteClip: () => void
  playing: boolean
  rate: number
  onRate: (r: number) => void
  onToggle: () => void
  onSeek: (t: number) => void
  onTrimStart: () => void
  onTrimEnd: () => void
  zoomLevel: number
  onZoomLevel: (z: number) => void
}

export function Transport(p: Props): React.JSX.Element {
  const rel = toOutput(p.time, p.clips)
  const len = totalLength(p.clips)
  const zfill = ((Math.log(p.zoomLevel) / Math.log(12)) * 100).toFixed(1)
  return (
    <div className="glass mx-24 mb-3 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center rounded-[20px] px-3">
      <div className="flex items-center gap-1">
        <IconButton label="Split clip at playhead (S)" tooltipSide="top" onClick={p.onSplit}>
          <Scissors size={17} />
        </IconButton>
        <IconButton
          label="Delete selected clip (⌫)"
          tooltipSide="top"
          onClick={p.onDeleteClip}
          disabled={!p.canDeleteClip}
        >
          <Trash size={17} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <IconButton label="Trim start to playhead (I)" tooltipSide="top" onClick={p.onTrimStart}>
          <ArrowLeftToLine size={17} />
        </IconButton>
        <IconButton label="Trim end to playhead (O)" tooltipSide="top" onClick={p.onTrimEnd}>
          <ArrowRightToLine size={17} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <SpeedMenu {...p} />
      </div>

      <div className="flex items-center gap-3">
        <span className="w-[72px] text-right text-[13px] tabular-nums text-ink-300">{formatTime(rel, true)}</span>
        <IconButton label="Go to start" tooltipSide="top" onClick={() => p.onSeek(firstStart(p.clips))}>
          <SkipBack size={17} />
        </IconButton>
        <button
          onClick={p.onToggle}
          aria-label={p.playing ? 'Pause' : 'Play'}
          className="grid size-10 place-items-center rounded-full bg-white text-ink-950 shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          {p.playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" className="translate-x-px" />
          )}
        </button>
        <IconButton label="Go to end" tooltipSide="top" onClick={() => p.onSeek(lastEnd(p.clips))}>
          <SkipForward size={17} />
        </IconButton>
        <span className="w-[72px] text-[13px] tabular-nums text-ink-500">{formatTime(len, true)}</span>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Dropdown
          align="right"
          width={120}
          trigger={(open) => (
            <button
              title="Preview speed"
              className={cx(
                'h-8 rounded-lg px-2.5 text-[13px] font-medium tabular-nums text-ink-200 hover:bg-white/[0.06]',
                open && 'bg-white/[0.06]'
              )}
            >
              {p.rate}×
            </button>
          )}
        >
          {(close) =>
            [0.5, 1, 1.5, 2].map((r) => (
              <MenuItem
                key={r}
                active={p.rate === r}
                onClick={() => {
                  p.onRate(r)
                  close()
                }}
              >
                {r}×
              </MenuItem>
            ))
          }
        </Dropdown>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <button
          className="text-ink-400 hover:text-white"
          onClick={() => p.onZoomLevel(Math.max(1, p.zoomLevel / 1.5))}
          aria-label="Zoom timeline out"
        >
          <ZoomOut size={15} />
        </button>
        <input
          type="range"
          className="range neutral w-28"
          min={0}
          max={1}
          step={0.001}
          value={Math.log(p.zoomLevel) / Math.log(12)}
          style={{ '--fill': `${zfill}%` } as React.CSSProperties}
          onChange={(e) => p.onZoomLevel(Math.pow(12, parseFloat(e.target.value)))}
          aria-label="Timeline zoom"
        />
        <button
          className="text-ink-400 hover:text-white"
          onClick={() => p.onZoomLevel(Math.min(12, p.zoomLevel * 1.5))}
          aria-label="Zoom timeline in"
        >
          <ZoomIn size={15} />
        </button>
      </div>
    </div>
  )
}

function SpeedMenu(p: Props): React.JSX.Element {
  const sel = p.selectedClip
  const cur = sel?.speed ?? 1
  const sped = p.clips.some((c) => (c.speed ?? 1) !== 1)
  return (
    <Dropdown
      side="top"
      width={250}
      trigger={(open) => (
        <button
          title="Speed"
          className={cx(
            'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-200 hover:bg-white/[0.08] hover:text-white',
            open && 'glass-chip text-white'
          )}
        >
          <Gauge size={16} />
          {sel && cur !== 1 ? `${cur}×` : 'Speed'}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
            {sel ? 'Selected clip' : 'Select a clip to change its speed'}
          </div>
          {sel && (
            <div className="mb-1 grid grid-cols-6 gap-1 px-1.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => p.onClipSpeed(s, s !== 1 && !!sel.mute)}
                  className={cx(
                    'h-8 rounded-full text-[12px] font-medium tabular-nums',
                    cur === s ? 'glass-chip text-white' : 'text-ink-300 hover:bg-white/[0.08]'
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
          {sel && cur !== 1 && (
            <MenuItem active={!!sel.mute} onClick={() => p.onClipSpeed(cur, !sel.mute)}>
              Mute while sped up
            </MenuItem>
          )}
          <div className="my-1 h-px bg-white/[0.07]" />
          <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium tracking-wide text-ink-400 uppercase">Typing</div>
          {p.typingCount > 0 ? (
            [2, 4].map((s) => (
              <MenuItem
                key={s}
                onClick={() => {
                  p.onSpeedUpTyping(s)
                  close()
                }}
                right={<span className="text-xs text-ink-400">{s}×</span>}
              >
                <span className="flex items-center gap-2">
                  <KeyboardKeys size={14} /> Speed up typing ({p.typingCount})
                </span>
              </MenuItem>
            ))
          ) : (
            <p className="px-2.5 pb-2 text-[11.5px] leading-relaxed text-ink-400">
              No typing found. Typing is detected from keystrokes recorded while you record (Settings → Advanced).
            </p>
          )}
          {sped && (
            <MenuItem
              onClick={() => {
                p.onClearSpeed()
                close()
              }}
            >
              Back to normal speed everywhere
            </MenuItem>
          )}
        </>
      )}
    </Dropdown>
  )
}
