import { useEffect, useRef, useState } from 'react'
import { X } from '@renderer/lib/icons'
import { api } from '@renderer/lib/api'
import { clamp } from '@renderer/engine/math'
import { cx } from '@renderer/lib/ui'

interface R {
  x: number
  y: number
  w: number
  h: number
}
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Drag =
  | { kind: 'new'; ox: number; oy: number }
  | { kind: 'move'; ox: number; oy: number; r: R }
  | { kind: 'resize'; h: Handle; r: R }

const MIN = 40
const ASPECTS: [string, number | null][] = [
  ['Free', null],
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['1:1', 1],
  ['9:16', 9 / 16]
]
const key = (id: string): string => `screenrec.area.${id}`

function norm(a: { x: number; y: number }, b: { x: number; y: number }): R {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

function fitAspect(r: R, ratio: number | null, W: number, H: number): R {
  if (!ratio) return r
  let w = r.w
  let h = w / ratio
  if (h > H) {
    h = H
    w = h * ratio
  }
  if (w > W) {
    w = W
    h = w / ratio
  }
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h }
}

export function AreaSelect({ displayId }: { displayId: string }): React.JSX.Element {
  const [rect, setRect] = useState<R | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key(displayId)) ?? 'null') as R | null
      if (saved)
        return { x: saved.x * innerWidth, y: saved.y * innerHeight, w: saved.w * innerWidth, h: saved.h * innerHeight }
    } catch {
      /* ignore */
    }
    return null
  })
  const [ratio, setRatio] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    document.documentElement.classList.add('toolbar') // transparent page background
  }, [])

  const finish = (r: R | null): void => {
    if (done.current) return
    done.current = true
    if (!r || r.w < MIN || r.h < MIN) {
      void api.area.result(null)
      return
    }
    const W = innerWidth
    const H = innerHeight
    const n = { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }
    try {
      localStorage.setItem(key(displayId), JSON.stringify(n))
    } catch {
      /* ignore */
    }
    void api.area.result({ displayId, rect: n })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null)
      if (e.key === 'Enter' && rect) finish(rect)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const W = innerWidth
      const H = innerHeight
      const px = clamp(e.clientX, 0, W)
      const py = clamp(e.clientY, 0, H)
      if (d.kind === 'new') {
        let r = norm({ x: d.ox, y: d.oy }, { x: px, y: py })
        if (ratio) {
          const w = Math.max(r.w, r.h * ratio)
          const h = w / ratio
          r = { x: px < d.ox ? d.ox - w : d.ox, y: py < d.oy ? d.oy - h : d.oy, w, h }
          r = { ...r, x: clamp(r.x, 0, W - r.w), y: clamp(r.y, 0, H - r.h) }
        }
        setRect(r)
      } else if (d.kind === 'move') {
        setRect({ ...d.r, x: clamp(d.r.x + px - d.ox, 0, W - d.r.w), y: clamp(d.r.y + py - d.oy, 0, H - d.r.h) })
      } else {
        const r = d.r
        let { x, y } = r
        let x2 = r.x + r.w
        let y2 = r.y + r.h
        if (d.h.includes('w')) x = Math.min(px, x2 - MIN)
        if (d.h.includes('e')) x2 = Math.max(px, x + MIN)
        if (d.h.includes('n')) y = Math.min(py, y2 - MIN)
        if (d.h.includes('s')) y2 = Math.max(py, y + MIN)
        let next = { x, y, w: x2 - x, h: y2 - y }
        if (ratio) {
          const w = d.h === 'n' || d.h === 's' ? next.h * ratio : next.w
          const h = w / ratio
          next = { x: d.h.includes('w') ? x2 - w : x, y: d.h.includes('n') ? y2 - h : y, w, h }
        }
        setRect(next)
      }
    }
    const up = (): void => {
      drag.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [ratio])

  const dpr = window.devicePixelRatio || 1
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const hpos = (h: Handle, r: R): React.CSSProperties => ({
    left: h.includes('w') ? -6 : h.includes('e') ? r.w - 6 : r.w / 2 - 6,
    top: h.includes('n') ? -6 : h.includes('s') ? r.h - 6 : r.h / 2 - 6,
    cursor: `${h}-resize`
  })
  const barBelow = rect ? rect.y + rect.h + 64 < innerHeight : true

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { kind: 'new', ox: e.clientX, oy: e.clientY }
        setDragging(true)
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
      }}
    >
      {!rect && <div className="absolute inset-0 bg-black/45" />}
      {!rect && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-2xl bg-ink-900/90 px-5 py-3.5 text-center text-sm text-ink-100 shadow-2xl ring-1 ring-white/10">
            Drag to select the area to record
            <div className="mt-1 text-xs text-ink-400">Esc to cancel</div>
          </div>
        </div>
      )}

      {rect && (
        <div
          className="absolute cursor-move rounded-[2px] outline-2 outline-white/90 outline-dashed"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)'
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            drag.current = { kind: 'move', ox: e.clientX, oy: e.clientY, r: rect }
            setDragging(true)
          }}
          onDoubleClick={() => finish(rect)}
        >
          {handles.map((h) => (
            <span
              key={h}
              className="absolute size-3 rounded-full border-2 border-brand-500 bg-white shadow"
              style={hpos(h, rect)}
              onPointerDown={(e) => {
                e.stopPropagation()
                drag.current = { kind: 'resize', h, r: rect }
                setDragging(true)
              }}
            />
          ))}
          <span className="pointer-events-none absolute -top-8 left-0 rounded-md bg-ink-900/90 px-2 py-1 text-[11px] font-medium tabular-nums text-white">
            {Math.round(rect.w * dpr)} × {Math.round(rect.h * dpr)}
          </span>
        </div>
      )}

      {rect && rect.w >= MIN && rect.h >= MIN && !dragging && (
        <div
          className="absolute flex items-center gap-1 rounded-2xl bg-ink-900/95 p-1.5 text-ink-100 shadow-2xl ring-1 ring-white/10"
          style={{
            left: clamp(rect.x + rect.w / 2 - 230, 8, innerWidth - 468),
            top: barBelow ? rect.y + rect.h + 14 : rect.y + rect.h - 64
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ASPECTS.map(([label, r]) => (
            <button
              key={label}
              onClick={() => {
                setRatio(r)
                setRect((cur) => (cur ? fitAspect(cur, r, innerWidth, innerHeight) : cur))
              }}
              className={cx(
                'h-8 rounded-lg px-2.5 text-xs font-medium',
                ratio === r ? 'bg-white/15 text-white' : 'text-ink-300 hover:bg-white/[0.07]'
              )}
            >
              {label}
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-white/10" />
          <button
            onClick={() => finish(null)}
            className="grid size-8 place-items-center rounded-lg text-ink-300 hover:bg-white/[0.07]"
            title="Cancel (Esc)"
          >
            <X size={16} />
          </button>
          <button
            onClick={() => finish(rect)}
            className="flex h-8 items-center gap-2 rounded-lg bg-red-500 px-3 text-xs font-semibold text-[#fff] hover:bg-red-400"
            title="Record (Enter)"
          >
            <span className="size-2 rounded-full bg-white" /> Record area
          </button>
        </div>
      )}
    </div>
  )
}
