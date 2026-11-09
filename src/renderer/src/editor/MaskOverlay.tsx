import { useRef } from 'react'
import type { MaskSegment, NRect } from '@shared/types'
import { contentOnCanvas, type Scene } from '@renderer/engine/compositor'
import { clamp } from '@renderer/engine/math'
import { cx } from '@renderer/lib/ui'

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 0.02

/** Drag/resize box for the selected privacy mask, drawn over the preview in the zoomed space. */
export function MaskOverlay({
  scene,
  time,
  width,
  height,
  mask,
  onChange
}: {
  scene: Scene
  time: number
  width: number
  height: number
  mask: MaskSegment
  onChange: (rect: NRect) => void
}): React.JSX.Element {
  const drag = useRef<{ h: Handle; x: number; y: number; start: NRect } | null>(null)
  const { rect: content } = contentOnCanvas(time, width, height, scene)
  const r = mask.rect
  const box = {
    left: content.x + r.x * content.w,
    top: content.y + r.y * content.h,
    width: r.w * content.w,
    height: r.h * content.h
  }
  const active = time >= mask.start && time <= mask.end

  const onDown = (h: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { h, x: e.clientX, y: e.clientY, start: { ...r } }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / content.w
    const dy = (e.clientY - d.y) / content.h
    const s = d.start
    let { x, y, w, h } = s
    if (d.h === 'move') {
      x = clamp(s.x + dx, 0, 1 - s.w)
      y = clamp(s.y + dy, 0, 1 - s.h)
    } else {
      if (d.h.includes('w')) {
        x = clamp(s.x + dx, 0, s.x + s.w - MIN)
        w = s.x + s.w - x
      }
      if (d.h.includes('e')) w = clamp(s.w + dx, MIN, 1 - s.x)
      if (d.h.includes('n')) {
        y = clamp(s.y + dy, 0, s.y + s.h - MIN)
        h = s.y + s.h - y
      }
      if (d.h.includes('s')) h = clamp(s.h + dy, MIN, 1 - s.y)
    }
    onChange({ x, y, w, h })
  }
  const onUp = (): void => {
    drag.current = null
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
      <div
        className={cx(
          'pointer-events-auto absolute cursor-move rounded-[6px]',
          active && 'shadow-[0_0_0_9999px_rgba(0,0,0,0.18)] ring-2 ring-rose-400'
        )}
        style={{ ...box, outline: active ? undefined : '2px dashed rgba(251,113,133,0.7)', outlineOffset: -2 }}
        onPointerDown={onDown('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {!active && (
          <span className="absolute -top-6 left-0 rounded bg-[#000]/70 px-1.5 py-0.5 text-[10.5px] whitespace-nowrap text-[#fff]">
            Not visible at the playhead
          </span>
        )}
        {HANDLES.map((h) => (
          <span
            key={h}
            onPointerDown={onDown(h)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            className="absolute size-3 rounded-full bg-[#fff] shadow ring-2 ring-rose-400"
            style={{
              left: h.includes('w') ? -6 : h.includes('e') ? 'calc(100% - 6px)' : 'calc(50% - 6px)',
              top: h.includes('n') ? -6 : h.includes('s') ? 'calc(100% - 6px)' : 'calc(50% - 6px)',
              cursor: `${h === 'n' || h === 's' ? 'ns' : h === 'e' || h === 'w' ? 'ew' : h === 'ne' || h === 'sw' ? 'nesw' : 'nwse'}-resize`
            }}
          />
        ))}
      </div>
    </div>
  )
}
