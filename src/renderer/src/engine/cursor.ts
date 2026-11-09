import type { CursorSample } from '@shared/types'
import { clamp, lerp } from './math'

const HZ = 120

/**
 * A cursor path resampled at a fixed rate and smoothed with a critically-damped spring.
 * Everything is precomputed so lookups are pure functions of time — the preview and the
 * exporter produce exactly the same motion.
 */
export class CursorPath {
  private readonly xs: Float32Array
  private readonly ys: Float32Array
  readonly empty: boolean

  /**
   * @param samples raw samples [t, x, y]
   * @param duration recording duration in seconds
   * @param omega spring angular frequency (rad/s); Infinity = no smoothing
   */
  constructor(samples: CursorSample[], duration: number, omega: number) {
    const n = Math.max(1, Math.ceil(Math.max(duration, samples.at(-1)?.[0] ?? 0) * HZ) + 1)
    this.xs = new Float32Array(n)
    this.ys = new Float32Array(n)
    this.empty = samples.length === 0
    if (this.empty) return

    // 1. resample raw samples with linear interpolation
    let j = 0
    for (let i = 0; i < n; i++) {
      const t = i / HZ
      while (j < samples.length - 2 && samples[j + 1][0] <= t) j++
      const a = samples[j]
      const b = samples[Math.min(j + 1, samples.length - 1)]
      if (t <= a[0] || a === b) {
        this.xs[i] = a[1]
        this.ys[i] = a[2]
      } else if (t >= b[0]) {
        this.xs[i] = b[1]
        this.ys[i] = b[2]
      } else {
        const k = (t - a[0]) / (b[0] - a[0])
        this.xs[i] = lerp(a[1], b[1], k)
        this.ys[i] = lerp(a[2], b[2], k)
      }
    }

    // 2. spring smoothing (semi-implicit Euler, critically damped)
    if (!Number.isFinite(omega)) return
    const dt = 1 / HZ
    let x = this.xs[0]
    let y = this.ys[0]
    let vx = 0
    let vy = 0
    for (let i = 0; i < n; i++) {
      const ax = omega * omega * (this.xs[i] - x) - 2 * omega * vx
      const ay = omega * omega * (this.ys[i] - y) - 2 * omega * vy
      vx += ax * dt
      vy += ay * dt
      x += vx * dt
      y += vy * dt
      this.xs[i] = x
      this.ys[i] = y
    }
  }

  at(t: number): { x: number; y: number } | null {
    if (this.empty) return null
    const f = clamp(t * HZ, 0, this.xs.length - 1)
    const i = Math.floor(f)
    const k = f - i
    const i2 = Math.min(i + 1, this.xs.length - 1)
    return { x: lerp(this.xs[i], this.xs[i2], k), y: lerp(this.ys[i], this.ys[i2], k) }
  }

  /** Speed in normalised units per second (used for motion blur-ish effects). */
  speed(t: number): number {
    const a = this.at(t - 1 / HZ)
    const b = this.at(t)
    if (!a || !b) return 0
    return Math.hypot(b.x - a.x, b.y - a.y) * HZ
  }
}

/** Map a 0..1 smoothing amount to a spring frequency. */
export function cursorOmega(smoothing: number): number {
  if (smoothing <= 0.001) return Infinity
  return lerp(45, 7, clamp(smoothing, 0, 1))
}

/** The zoom camera follows the cursor more lazily than the cursor itself. */
export function followOmega(follow: number): number {
  return lerp(9, 2.2, clamp(follow, 0, 1))
}
