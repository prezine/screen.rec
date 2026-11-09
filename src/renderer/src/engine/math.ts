export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
/** Smooth, slightly "camera-like" ease used for zoom in/out. */
export const easeInOutQuint = (t: number): number => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2)

export function uid(prefix = 'z'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`
}

export function formatTime(sec: number, withMs = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const base = `${m}:${String(s).padStart(2, '0')}`
  if (!withMs) return base
  const cs = Math.floor((sec % 1) * 100)
  return `${base}.${String(cs).padStart(2, '0')}`
}
