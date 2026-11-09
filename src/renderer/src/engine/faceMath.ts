// Face-track maths (no browser APIs, so it can be unit-tested).

export interface FaceTrack {
  version: 1
  /** [camera time, centre x, centre y, face height] — normalised to the camera frame, smoothed */
  samples: [number, number, number, number][]
}

export const FPS = 5

export function faceAt(track: FaceTrack | null | undefined, t: number): { x: number; y: number; size: number } | null {
  const s = track?.samples
  if (!s || !s.length) return null
  if (t <= s[0][0]) return { x: s[0][1], y: s[0][2], size: s[0][3] }
  const last = s[s.length - 1]
  if (t >= last[0]) return { x: last[1], y: last[2], size: last[3] }
  // binary search
  let lo = 0
  let hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  const k = (t - a[0]) / (b[0] - a[0] || 1)
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, size: a[3] + (b[3] - a[3]) * k }
}

/**
 * Smooth like a camera operator: ignore small wobbles, then follow with a gentle lag.
 * Gaps (no face found) hold the last position.
 */
export function smoothTrack(
  raw: ([number, number, number, number] | [number, null, null, null])[]
): FaceTrack['samples'] {
  const filled: [number, number, number, number][] = []
  let lastSeen: [number, number, number] | null = null
  for (const r of raw) {
    if (r[1] !== null) lastSeen = [r[1], r[2] as number, r[3] as number]
    filled.push([r[0], lastSeen?.[0] ?? 0.5, lastSeen?.[1] ?? 0.45, lastSeen?.[2] ?? 0.3])
  }
  // back-fill the start if the face appeared late
  const first = filled.findIndex((_, i) => raw[i][1] !== null)
  for (let i = 0; i < first; i++)
    filled[i] = [filled[i][0], ...filled[first].slice(1)] as [number, number, number, number]
  // centred moving average (±0.6 s), then a dead zone + lag pass
  const half = Math.round(0.6 * FPS)
  const avg = filled.map((_, i) => {
    let x = 0
    let y = 0
    let z = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(filled.length - 1, i + half); j++) {
      x += filled[j][1]
      y += filled[j][2]
      z += filled[j][3]
      n++
    }
    return [filled[i][0], x / n, y / n, z / n] as [number, number, number, number]
  })
  const out: [number, number, number, number][] = []
  let cur = avg[0] ? [...avg[0]] : null
  for (const a of avg) {
    if (!cur) break
    const dx = a[1] - cur[1]
    const dy = a[2] - cur[2]
    // only re-frame when you've really moved (3% of the frame), then ease toward it
    const far = Math.hypot(dx, dy) > 0.03
    const k = far ? 0.35 : 0.08
    cur = [a[0], cur[1] + dx * k, cur[2] + dy * k, cur[3] + (a[3] - cur[3]) * 0.1]
    out.push([a[0], +cur[1].toFixed(4), +cur[2].toFixed(4), +cur[3].toFixed(4)])
  }
  return out
}
