import { clipAt, removeRange, restoreRange, type Clip } from './clips'

/** One spoken word, times in source seconds. */
export interface Word {
  text: string
  start: number
  end: number
}

export interface Transcript {
  version: 1
  model: string
  language?: string
  createdAt: number
  /** last time someone corrected the text by hand */
  editedAt?: number
  words: Word[]
}

const FILLER = /^(u+m+|u+h+m*|e+r+m*|h+m+|m+h*m+|a+h+|e+h+|uhh+|umm+)[.,!?…]*$/i

export function isFiller(w: Word): boolean {
  return FILLER.test(w.text.trim())
}

/** A word counts as kept if its middle is inside a kept clip. */
export function isKept(w: Word, clips: Clip[]): boolean {
  return clipAt((w.start + w.end) / 2, clips) !== null
}

/** Source range to cut when deleting words i..j: hugs the words, never eats into neighbours. */
export function rangeForWords(words: Word[], i: number, j: number, pad = 0.04): [number, number] {
  const a = Math.max(words[i - 1]?.end ?? 0, words[i].start - pad)
  const b = Math.min(words[j + 1]?.start ?? Infinity, words[j].end + pad)
  return [a, b]
}

export function deleteWords(clips: Clip[], words: Word[], i: number, j: number): Clip[] {
  const [a, b] = rangeForWords(words, Math.min(i, j), Math.max(i, j))
  return removeRange(clips, a, b)
}

export function restoreWords(clips: Clip[], words: Word[], i: number, j: number, duration: number): Clip[] {
  const lo = Math.min(i, j)
  const hi = Math.max(i, j)
  // restore up to the neighbouring words so the gap between them comes back too
  const a = lo > 0 ? words[lo - 1].end : words[lo].start - 0.1
  const b = hi < words.length - 1 ? words[hi + 1].start : words[hi].end + 0.1
  return restoreRange(clips, a, Math.min(duration, b), duration)
}

/** Indices of kept filler words ("um", "uh", …). */
export function fillerIndices(words: Word[], clips: Clip[]): number[] {
  return words.flatMap((w, i) => (isFiller(w) && isKept(w, clips) ? [i] : []))
}

export function removeFillers(clips: Clip[], words: Word[]): Clip[] {
  let out = clips
  for (const i of fillerIndices(words, clips)) out = deleteWords(out, words, i, i)
  return out
}

/** Silences between consecutive kept words longer than `min` seconds. */
export function longPauses(words: Word[], clips: Clip[], min = 1): [number, number][] {
  const kept = words.filter((w) => isKept(w, clips))
  const out: [number, number][] = []
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].start - kept[i - 1].end
    if (gap > min) out.push([kept[i - 1].end, kept[i].start])
  }
  return out
}

/** Shorten long pauses, leaving `keep` seconds of breathing room on each side. */
export function trimPauses(clips: Clip[], words: Word[], min = 1, keep = 0.25): Clip[] {
  let out = clips
  for (const [a, b] of longPauses(words, clips, min)) out = removeRange(out, a + keep, b - keep)
  return out
}

/** Group words into paragraphs at long silences, for display. */
export function paragraphs(words: Word[], gap = 1.6): number[][] {
  const out: number[][] = []
  words.forEach((w, i) => {
    const prev = words[i - 1]
    if (!prev || w.start - prev.end > gap || (/[.?!]$/.test(prev.text.trim()) && w.start - prev.end > 0.9))
      out.push([i])
    else out[out.length - 1].push(i)
  })
  return out
}

/**
 * Replace the text of words lo..hi (fixing a misheard word, punctuation, a name…). Timing is kept:
 * the same number of words keep their own times; otherwise the new words share the original
 * span in proportion to their length. Empty text removes the words from the transcript (and so
 * from captions) without cutting the video.
 */
export function replaceWords(words: Word[], lo: number, hi: number, text: string): Word[] {
  const a = Math.max(0, Math.min(lo, hi))
  const b = Math.min(words.length - 1, Math.max(lo, hi))
  if (a > b) return words
  const tokens = text.split(/\s+/).filter(Boolean)
  const old = words.slice(a, b + 1)
  let next: Word[]
  if (tokens.length === old.length) {
    next = old.map((w, i) => ({ ...w, text: ` ${tokens[i]}` }))
  } else if (tokens.length) {
    const start = old[0].start
    const span = old[old.length - 1].end - start
    const total = tokens.reduce((n, t) => n + t.length + 1, 0)
    let at = start
    next = tokens.map((t) => {
      const len = (span * (t.length + 1)) / total
      const w = { text: ` ${t}`, start: at, end: at + len * 0.92 }
      at += len
      return w
    })
  } else next = []
  return [...words.slice(0, a), ...next, ...words.slice(b + 1)]
}
