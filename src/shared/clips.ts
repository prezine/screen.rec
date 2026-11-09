/**
 * Clip model: the parts of the recording that are kept, as ordered, non-overlapping
 * ranges in *source* time. Cuts, trims and transcript deletions all edit this list.
 * Output (exported) time is source time with the gaps removed, and sped-up clips shortened.
 */

export interface Clip {
  id: string
  start: number
  end: number
  /** playback speed (1 = normal). A 2× clip lasts half as long in the output. */
  speed?: number
  /** silence the recording's audio in this clip (e.g. sped-up typing) */
  mute?: boolean
}

export const speedOf = (c: Clip): number => (c.speed && c.speed > 0 ? c.speed : 1)
/** Seconds this clip lasts in the output. */
export const outLength = (c: Clip): number => Math.max(0, c.end - c.start) / speedOf(c)

const EPS = 1e-4
export const MIN_CLIP = 0.1

let counter = 0
export function clipId(): string {
  counter = (counter + 1) % 1e6
  return `c${Date.now().toString(36)}${counter.toString(36)}`
}

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start)
}

export function totalLength(clips: Clip[]): number {
  return clips.reduce((s, c) => s + outLength(c), 0)
}

export function clipAt(t: number, clips: Clip[]): Clip | null {
  return clips.find((c) => t >= c.start - EPS && t < c.end - EPS) ?? null
}

/** t if it's inside a clip, else the start of the next clip, else null (past the end). */
export function nextPlayable(t: number, clips: Clip[]): number | null {
  for (const c of clips) {
    if (t < c.start - EPS) return c.start
    if (t < c.end - EPS) return t
  }
  return null
}

export function firstStart(clips: Clip[]): number {
  return clips[0]?.start ?? 0
}

export function lastEnd(clips: Clip[]): number {
  return clips.at(-1)?.end ?? 0
}

/** Source time → output time (gaps removed). Times inside a gap map to the gap's output position. */
export function toOutput(t: number, clips: Clip[]): number {
  let o = 0
  for (const c of clips) {
    if (t <= c.start) return o
    if (t < c.end) return o + (t - c.start) / speedOf(c)
    o += outLength(c)
  }
  return o
}

/** Output time → source time. */
export function toSource(o: number, clips: Clip[]): number {
  let acc = 0
  for (const c of clips) {
    const len = outLength(c)
    if (o < acc + len) return c.start + (o - acc) * speedOf(c)
    acc += len
  }
  return lastEnd(clips)
}

/** Split the clip under t into two. No-op if t isn't inside a clip or too close to an edge. */
export function splitAt(clips: Clip[], t: number): Clip[] {
  const c = clipAt(t, clips)
  if (!c || t - c.start < MIN_CLIP || c.end - t < MIN_CLIP) return clips
  return sortClips([...clips.filter((x) => x !== c), { ...c, end: t }, { ...c, id: clipId(), start: t }])
}

/** Remove [a, b] from the kept ranges. */
export function removeRange(clips: Clip[], a: number, b: number): Clip[] {
  if (b - a <= EPS) return clips
  const out: Clip[] = []
  for (const c of clips) {
    if (b <= c.start || a >= c.end) {
      out.push(c)
      continue
    }
    if (a - c.start > MIN_CLIP / 2) out.push({ ...c, end: a })
    if (c.end - b > MIN_CLIP / 2) out.push({ ...c, id: a - c.start > MIN_CLIP / 2 ? clipId() : c.id, start: b })
  }
  return out
}

/** Add [a, b] back to the kept ranges (used when restoring deleted transcript words). */
export function restoreRange(clips: Clip[], a: number, b: number, duration: number): Clip[] {
  a = Math.max(0, a)
  b = Math.min(duration, b)
  if (b - a <= EPS) return clips
  return mergeTouching(sortClips([...clips, { id: clipId(), start: a, end: b }]))
}

/** Merge overlapping or touching clips. */
export function mergeTouching(clips: Clip[]): Clip[] {
  const out: Clip[] = []
  for (const c of sortClips(clips)) {
    const last = out.at(-1)
    if (last && c.start <= last.end + 1e-3 && speedOf(c) === speedOf(last) && !!c.mute === !!last.mute)
      last.end = Math.max(last.end, c.end)
    else out.push({ ...c })
  }
  return out
}

export function deleteClip(clips: Clip[], id: string): Clip[] {
  if (clips.length <= 1) return clips
  return clips.filter((c) => c.id !== id)
}

/** Move one edge of a clip, bounded by its neighbours, the recording and a minimum length. */
export function setClipEdge(clips: Clip[], id: string, side: 'start' | 'end', t: number, duration: number): Clip[] {
  const i = clips.findIndex((c) => c.id === id)
  if (i < 0) return clips
  const c = clips[i]
  const prevEnd = i > 0 ? clips[i - 1].end : 0
  const nextStart = i < clips.length - 1 ? clips[i + 1].start : duration
  const next =
    side === 'start'
      ? { ...c, start: Math.min(Math.max(t, prevEnd), c.end - MIN_CLIP) }
      : { ...c, end: Math.max(Math.min(t, nextStart), c.start + MIN_CLIP) }
  return clips.map((x, j) => (j === i ? next : x))
}

/** Output length of a clip list for a given frame rate, frame-exact. */
export function framePlan(clips: Clip[], fps: number): { clip: Clip; frames: number }[] {
  return clips.map((clip) => ({ clip, frames: Math.max(1, Math.round(outLength(clip) * fps)) }))
}

/**
 * Play [a, b] (recording time) at `speed`, splitting clips at the range's edges.
 * Slivers shorter than MIN_CLIP are folded into the sped-up part rather than left behind.
 */
export function setRangeSpeed(clips: Clip[], a: number, b: number, speed: number, mute = false): Clip[] {
  if (b - a <= EPS) return clips
  const out: Clip[] = []
  for (const c of clips) {
    if (b <= c.start || a >= c.end) {
      out.push(c)
      continue
    }
    let s = Math.max(a, c.start)
    let e = Math.min(b, c.end)
    if (s - c.start < MIN_CLIP) s = c.start
    if (c.end - e < MIN_CLIP) e = c.end
    if (s > c.start) out.push({ ...c, end: s })
    out.push({ ...c, id: s > c.start ? clipId() : c.id, start: s, end: e, speed, mute })
    if (e < c.end) out.push({ ...c, id: clipId(), start: e })
  }
  return mergeTouching(out)
}

/** Back to normal speed everywhere (re-joining pieces that were only split for speed). */
export function clearSpeed(clips: Clip[]): Clip[] {
  return mergeTouching(clips.map((c) => ({ ...c, speed: undefined, mute: undefined })))
}
