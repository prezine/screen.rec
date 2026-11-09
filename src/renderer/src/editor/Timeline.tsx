import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Plus } from '@renderer/lib/icons'
import type { ClickEvent } from '@shared/types'
import { setClipEdge, type Clip } from '@shared/clips'
import { clamp, formatTime } from '@renderer/engine/math'
import { cx } from '@renderer/lib/ui'

/** Anything placed on a lane: zooms, camera layouts. */
export interface Segment {
  id: string
  start: number
  end: number
}

export interface LaneSpec<T extends Segment> {
  id: string
  label: string
  items: T[]
  selected: string | null
  /** pill colour classes */
  tone: string
  render: (item: T, width: number) => ReactNode
  onChange: (items: T[]) => void
  onSelect: (id: string | null) => void
  onAddAt: (t: number) => void
  addLabel: string
  emptyHint: string
}

interface Props {
  duration: number
  time: number
  playing: boolean
  zoomLevel: number // 1 = fit
  onZoomLevel: (z: number) => void
  clips: Clip[]
  selectedClip: string | null
  onClips: (clips: Clip[]) => void
  onSelectClip: (id: string | null) => void
  clicks: ClickEvent[]
  peaks: Float32Array | null
  onSeek: (t: number) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lanes: LaneSpec<any>[]
}

type Drag =
  | { kind: 'seek' }
  | { kind: 'clip'; id: string; side: 'start' | 'end' }
  | { kind: 'seg'; lane: string; mode: 'move' | 'l' | 'r'; id: string; grabT: number; orig: Segment }

const PAD = 20
const MIN_SEG = 0.5

function tickStep(pxPerSec: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pxPerSec >= 70) return s
  return 1200
}

function Waveform({ peaks, width, height }: { peaks: Float32Array; width: number; height: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const w = Math.max(1, Math.min(16000, Math.round(width)))
    c.width = w
    c.height = height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, height)
    ctx.fillStyle = 'rgba(0,0,0,0.26)'
    const bar = 2
    const gap = 1
    const mid = height / 2
    for (let x = 0; x < w; x += bar + gap) {
      const a = Math.floor((x / w) * peaks.length)
      const b = Math.max(a + 1, Math.floor(((x + bar + gap) / w) * peaks.length))
      let v = 0
      for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i])
      const h = Math.max(1, v * (height - 10))
      ctx.fillRect(x, mid - h / 2, bar, h)
    }
  }, [peaks, width, height])
  return <canvas ref={ref} style={{ width, height }} className="pointer-events-none absolute top-0 left-0" />
}

const STRIPES: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 6px, transparent 6px 12px)'
}

export function Timeline(p: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(1000)
  const [hover, setHover] = useState<{ lane: string; t: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  const props = useRef(p)
  props.current = p

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dur = Math.max(0.01, p.duration)
  const trackW = Math.max(100, (viewW - PAD * 2) * p.zoomLevel)
  const pps = trackW / dur
  const x = (t: number): number => t * pps

  const timeAt = (clientX: number): number => {
    const r = innerRef.current!.getBoundingClientRect()
    return clamp((clientX - r.left - PAD) / pps, 0, dur)
  }

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !p.playing || p.zoomLevel <= 1) return
    const px = PAD + x(p.time)
    if (px > el.scrollLeft + el.clientWidth - 60 || px < el.scrollLeft) el.scrollLeft = px - 80
  })

  // ⌘/Ctrl + wheel zooms the timeline
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const cur = props.current
      cur.onZoomLevel(clamp(cur.zoomLevel * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 12))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const cur = props.current
      const t = timeAt(e.clientX)
      if (d.kind === 'seek') cur.onSeek(t)
      else if (d.kind === 'clip') {
        const next = setClipEdge(cur.clips, d.id, d.side, t, dur)
        cur.onClips(next)
        const c = next.find((c) => c.id === d.id)
        if (c) cur.onSeek(d.side === 'start' ? c.start : c.end - 1 / 60)
      } else {
        const lane = cur.lanes.find((l) => l.id === d.lane)
        if (!lane) return
        const o = d.orig
        let next: Segment
        if (d.mode === 'move') {
          const len = o.end - o.start
          const start = clamp(o.start + (t - d.grabT), 0, dur - len)
          next = { ...o, start, end: start + len }
        } else if (d.mode === 'l') next = { ...o, start: clamp(t, 0, o.end - MIN_SEG) }
        else next = { ...o, end: clamp(t, o.start + MIN_SEG, dur) }
        lane.onChange(lane.items.map((z: Segment) => (z.id === d.id ? { ...next, auto: false } : z)))
      }
    }
    const up = (): void => {
      drag.current = null
      setDragging(false)
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dur, pps])

  const startDrag = (e: React.PointerEvent, d: Drag, cursor = ''): void => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = d
    setDragging(true)
    document.body.style.cursor = cursor
  }

  const step = tickStep(pps)
  const ticks: number[] = []
  for (let t = 0; t <= dur + 1e-6; t += step) ticks.push(t)
  const minor = step / 2
  const laneFree = (items: Segment[], t: number): boolean => !items.some((z) => t >= z.start - 0.2 && t <= z.end + 0.2)

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-x-auto overflow-y-hidden"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        p.lanes.forEach((l) => l.onSelect(null))
        p.onSelectClip(null)
        p.onSeek(timeAt(e.clientX))
        startDrag(e, { kind: 'seek' })
      }}
    >
      <div ref={innerRef} className="relative min-h-full pb-2" style={{ width: trackW + PAD * 2 }}>
        {/* ruler */}
        <div className="relative h-11" style={{ marginLeft: PAD }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute top-[18px] flex -translate-x-1/2 flex-col items-center"
              style={{ left: x(t) }}
            >
              <span className="text-[11px] font-medium tabular-nums text-ink-400">{formatTime(t)}</span>
              <span className="mt-1 size-[3px] rounded-full bg-ink-500" />
            </div>
          ))}
          {ticks.map((t) =>
            t + minor < dur ? (
              <span
                key={`m${t}`}
                className="absolute top-[36px] size-[3px] -translate-x-1/2 rounded-full bg-ink-600"
                style={{ left: x(t + minor) }}
              />
            ) : null
          )}
        </div>

        {/* clip lane */}
        <div className="relative mt-1 h-[64px]" style={{ marginLeft: PAD, width: trackW }}>
          <div className="absolute inset-0 rounded-xl bg-ink-800/50 ring-1 ring-white/[0.04]" style={STRIPES} />
          {p.clips.map((c, i) => {
            const w = Math.max(6, x(c.end) - x(c.start))
            const sel = p.selectedClip === c.id
            return (
              <div
                key={c.id}
                className={cx(
                  'absolute top-0 bottom-0 overflow-hidden rounded-xl bg-gradient-to-b from-clip-400 to-clip-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]',
                  sel && 'ring-2 ring-white'
                )}
                style={{ left: x(c.start), width: w }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  p.lanes.forEach((l) => l.onSelect(null))
                  p.onSelectClip(c.id)
                  p.onSeek(timeAt(e.clientX))
                  startDrag(e, { kind: 'seek' })
                }}
              >
                {p.peaks && (
                  <div className="absolute top-0 bottom-0" style={{ left: -x(c.start), width: trackW }}>
                    <Waveform peaks={p.peaks} width={trackW} height={64} />
                  </div>
                )}
                {p.clicks.map((k, j) =>
                  k.t >= c.start && k.t <= c.end ? (
                    <span
                      key={j}
                      className="absolute bottom-2 size-1.5 -translate-x-1/2 rounded-full bg-[#fff]/80"
                      style={{ left: x(k.t) - x(c.start) }}
                    />
                  ) : null
                )}
                {(c.speed ?? 1) !== 1 && (
                  // sped-up clip: striped overlay + badge
                  <div
                    className="pointer-events-none absolute inset-0 rounded-[inherit]"
                    style={{
                      background: 'repeating-linear-gradient(115deg, rgba(0,0,0,0.12) 0 6px, transparent 6px 14px)'
                    }}
                  >
                    <span className="absolute top-2 left-3 flex items-center gap-1 rounded-full bg-[#000]/55 px-2 py-0.5 text-[10.5px] font-semibold text-[#fff]">
                      {c.speed}× {c.mute && <span className="text-[#fff]/60">· muted</span>}
                    </span>
                  </div>
                )}
                {w > 70 && (
                  <div className="pointer-events-none absolute top-2 right-4 flex flex-col items-end rounded-md bg-clip-400/80 px-1.5 py-0.5 leading-tight text-[#000]/65">
                    <span className="text-[10px] font-semibold tracking-wide uppercase">
                      {p.clips.length > 1 ? `Clip ${i + 1}` : 'Clip'}
                    </span>
                    <span className="text-xs font-semibold tabular-nums">
                      {((c.end - c.start) / (c.speed ?? 1)).toFixed(1)}s
                    </span>
                  </div>
                )}
                {(['start', 'end'] as const).map((side) => (
                  <div
                    key={side}
                    onPointerDown={(e) => {
                      p.onSelectClip(c.id)
                      startDrag(e, { kind: 'clip', id: c.id, side }, 'ew-resize')
                    }}
                    className={cx(
                      'absolute top-0 bottom-0 z-10 flex w-3 cursor-ew-resize items-center justify-center bg-clip-600 hover:bg-clip-400',
                      side === 'start' ? 'left-0 rounded-l-xl' : 'right-0 rounded-r-xl'
                    )}
                    title={
                      side === 'start' ? 'Drag to trim the start of this clip' : 'Drag to trim the end of this clip'
                    }
                  >
                    <span className="h-6 w-0.5 rounded-full bg-black/40" />
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* segment lanes (zooms, layouts) */}
        {p.lanes.map((lane) => {
          const hoverT = hover?.lane === lane.id ? hover.t : null
          return (
            <div
              key={lane.id}
              className="relative mt-2.5 h-9"
              style={{ marginLeft: PAD, width: trackW }}
              onPointerMove={(e) => setHover({ lane: lane.id, t: timeAt(e.clientX) })}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const t = timeAt(e.clientX)
                if (laneFree(lane.items, t)) {
                  e.stopPropagation()
                  lane.onAddAt(t)
                }
              }}
            >
              <div className="absolute inset-y-1 inset-x-0 rounded-full bg-ink-800/40" />
              {lane.items.length === 0 && hoverT === null && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-ink-500">
                  {lane.emptyHint}
                </span>
              )}
              {hoverT !== null && laneFree(lane.items, hoverT) && !dragging && (
                <div
                  className="pointer-events-none absolute inset-y-1 flex items-center gap-1 rounded-full border border-dashed border-white/25 bg-white/[0.04] px-2.5 text-[11px] font-medium text-ink-200"
                  style={{ left: x(hoverT), width: Math.max(80, x(Math.min(dur, hoverT + 2.5)) - x(hoverT)) }}
                >
                  <Plus size={12} /> {lane.addLabel}
                </div>
              )}
              {lane.items.map((z: Segment) => {
                const sel = lane.selected === z.id
                const w = Math.max(10, x(z.end) - x(z.start))
                return (
                  <div
                    key={z.id}
                    onPointerDown={(e) => {
                      p.lanes.forEach((l) => l.onSelect(l.id === lane.id ? z.id : null))
                      p.onSelectClip(null)
                      startDrag(
                        e,
                        { kind: 'seg', lane: lane.id, mode: 'move', id: z.id, grabT: timeAt(e.clientX), orig: z },
                        'grabbing'
                      )
                    }}
                    className={cx(
                      'absolute inset-y-1 flex cursor-grab items-center gap-1 overflow-hidden rounded-full px-3 text-[11px] font-semibold whitespace-nowrap text-[#fff]/90 transition-shadow',
                      lane.tone,
                      sel ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/40'
                    )}
                    style={{ left: x(z.start), width: w }}
                  >
                    {lane.render(z, w)}
                    <span
                      className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize"
                      onPointerDown={(e) => {
                        p.lanes.forEach((l) => l.onSelect(l.id === lane.id ? z.id : null))
                        startDrag(
                          e,
                          { kind: 'seg', lane: lane.id, mode: 'l', id: z.id, grabT: 0, orig: z },
                          'ew-resize'
                        )
                      }}
                    />
                    <span
                      className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize"
                      onPointerDown={(e) => {
                        p.lanes.forEach((l) => l.onSelect(l.id === lane.id ? z.id : null))
                        startDrag(
                          e,
                          { kind: 'seg', lane: lane.id, mode: 'r', id: z.id, grabT: 0, orig: z },
                          'ew-resize'
                        )
                      }}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-20" style={{ left: PAD + x(p.time) }}>
          <div className="absolute top-0.5 -left-[7px] size-3.5 rounded-full bg-brand-500 shadow-[0_0_0_3px_rgba(109,92,255,0.25)] ring-2 ring-white/90" />
          <div className="absolute top-3.5 bottom-2 -left-px w-0.5 rounded-full bg-brand-400" />
        </div>
      </div>
    </div>
  )
}
