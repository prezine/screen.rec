import type { ZoomSegment } from '@shared/types'
import { clamp, easeInOutQuint } from './math'

/** Duration of the zoom-in / zoom-out ramps for a segment. */
export function rampDuration(seg: ZoomSegment): number {
  return Math.min(0.8, (seg.end - seg.start) / 2.5)
}

/** Zoom scale at time t (1 = no zoom). Pure function of the segments. */
export function zoomScaleAt(t: number, zooms: ZoomSegment[]): number {
  let best = 1
  for (const z of zooms) {
    if (t <= z.start || t >= z.end) continue
    const ramp = rampDuration(z)
    let e = 1
    if (t < z.start + ramp) e = easeInOutQuint((t - z.start) / ramp)
    else if (t > z.end - ramp) e = easeInOutQuint((z.end - t) / ramp)
    const s = 1 + (z.scale - 1) * clamp(e, 0, 1)
    if (s > best) best = s
  }
  return best
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Translation that keeps the focus point centred while never revealing
 * empty space past the content edges (once the content is larger than the canvas).
 */
export function cameraTranslate(
  W: number,
  H: number,
  content: Rect,
  focus: { x: number; y: number },
  s: number
): { tx: number; ty: number } {
  const fx = content.x + focus.x * content.w
  const fy = content.y + focus.y * content.h
  const axis = (size: number, start: number, len: number, f: number): number => {
    const desired = size / 2 - f * s
    const lo = size - (start + len) * s
    const hi = -start * s
    return lo <= hi ? clamp(desired, lo, hi) : (lo + hi) / 2
  }
  return { tx: axis(W, content.x, content.w, fx), ty: axis(H, content.y, content.h, fy) }
}
