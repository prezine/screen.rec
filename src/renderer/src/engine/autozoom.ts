import type { CursorData, ZoomSegment } from '@shared/types'
import { uid } from './math'

export interface AutoZoomOptions {
  scale: number
  /** seconds before the first click of a cluster to start zooming in */
  lead: number
  /** seconds after the last click of a cluster to stay zoomed */
  tail: number
  /** clicks closer than this (s) belong to the same cluster */
  clusterGap: number
  /** segments closer than this (s) get merged */
  mergeGap: number
  /** a click this far (normalised) from the previous one starts a new zoom */
  travel: number
  minLength: number
}

export const defaultAutoZoom: AutoZoomOptions = {
  scale: 1.9,
  lead: 0.6,
  tail: 1.6,
  clusterGap: 2.5,
  mergeGap: 1.0,
  travel: 0.3,
  minLength: 1.6
}

/**
 * Moments where the cursor travelled somewhere and then settled — used as a stand-in for
 * clicks when click tracking was unavailable (e.g. no Accessibility permission on macOS).
 */
export function detectDwells(cursor: CursorData, duration: number): number[] {
  const step = 0.1
  const pos: { x: number; y: number }[] = []
  let j = 0
  const s = cursor.samples
  if (s.length < 2) return []
  for (let t = 0; t <= duration; t += step) {
    while (j < s.length - 1 && s[j + 1][0] <= t) j++
    pos.push({ x: s[j][1], y: s[j][2] })
  }
  const events: number[] = []
  const settle = Math.round(0.8 / step)
  const travel = Math.round(0.8 / step)
  let cooldownUntil = -1
  for (let i = travel; i < pos.length - settle; i++) {
    if (i < cooldownUntil) continue
    const p = pos[i]
    const before = pos[i - travel]
    const moved = Math.hypot(p.x - before.x, p.y - before.y)
    if (moved < 0.06) continue
    let still = true
    for (let k = 1; k <= settle; k++) {
      const q = pos[i + k]
      if (Math.hypot(q.x - p.x, q.y - p.y) > 0.025) {
        still = false
        break
      }
    }
    if (still) {
      events.push(i * step)
      cooldownUntil = i + settle
    }
  }
  return events
}

export function generateAutoZooms(
  cursor: CursorData,
  duration: number,
  opts: AutoZoomOptions = defaultAutoZoom
): ZoomSegment[] {
  if (!cursor.tracked || duration <= 0) return []
  type P = { t: number; x: number; y: number }
  let points: P[] = cursor.clicks.filter((c) => c.button === 'left').map((c) => ({ t: c.t, x: c.x, y: c.y }))
  if (points.length === 0) points = detectDwells(cursor, duration).map((t) => ({ t, ...positionAt(cursor, t) }))
  points = points.filter((p) => p.t >= 0 && p.t <= duration).sort((a, b) => a.t - b.t)
  if (points.length === 0) return []

  // cluster: split on long pauses, or when the cursor jumps somewhere far away
  interface Cluster {
    a: number
    b: number
    first: P
    last: P
  }
  const clusters: Cluster[] = []
  for (const p of points) {
    const c = clusters.at(-1)
    const far = c ? Math.hypot(p.x - c.last.x, p.y - c.last.y) > opts.travel : false
    if (c && p.t - c.b <= opts.clusterGap && !far) {
      c.b = p.t
      c.last = p
    } else clusters.push({ a: p.t, b: p.t, first: p, last: p })
  }

  const segs: { start: number; end: number; last: P }[] = []
  for (const c of clusters) {
    let start = Math.max(0, c.a - opts.lead)
    let end = Math.min(duration, c.b + opts.tail)
    if (end - start < opts.minLength) {
      const mid = (start + end) / 2
      start = Math.max(0, mid - opts.minLength / 2)
      end = Math.min(duration, start + opts.minLength)
    }
    const prev = segs.at(-1)
    if (prev && start - prev.end <= opts.mergeGap) {
      const near = Math.hypot(c.first.x - prev.last.x, c.first.y - prev.last.y) <= opts.travel
      if (near) {
        // same area, short gap: keep zoomed in rather than bouncing out and back
        prev.end = Math.max(prev.end, end)
        prev.last = c.last
        continue
      }
      // different area: hand over at the midpoint instead of overlapping
      if (prev.end > start) {
        const mid = (prev.end + start) / 2
        prev.end = mid - 0.05
        start = mid + 0.05
      }
    }
    if (end - start >= 0.6) segs.push({ start, end, last: c.last })
  }

  return segs.map((s) => ({ id: uid(), start: s.start, end: s.end, scale: opts.scale, auto: true }))
}

function positionAt(cursor: CursorData, t: number): { x: number; y: number } {
  let best = cursor.samples[0]
  for (const s of cursor.samples) {
    if (s[0] > t) break
    best = s
  }
  return best ? { x: best[1], y: best[2] } : { x: 0.5, y: 0.5 }
}
