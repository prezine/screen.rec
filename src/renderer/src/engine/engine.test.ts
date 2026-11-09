import { describe, expect, it } from 'vitest'
import type { CursorData } from '@shared/types'
import { detectDwells, generateAutoZooms } from './autozoom'
import { cameraTranslate, zoomScaleAt } from './camera'
import { contentRect, outputSize } from './compositor'
import { CursorPath, cursorOmega } from './cursor'

const cursor = (clicks: number[], samples: [number, number, number][] = [[0, 0.5, 0.5]]): CursorData => ({
  samples,
  clicks: clicks.map((t) => ({ t, x: 0.3, y: 0.4, button: 'left' as const })),
  tracked: true
})

describe('auto zoom', () => {
  it('clusters nearby clicks into one segment', () => {
    const z = generateAutoZooms(cursor([2, 3, 4]), 20)
    expect(z).toHaveLength(1)
    expect(z[0].start).toBeCloseTo(1.4)
    expect(z[0].end).toBeCloseTo(5.6)
  })

  it('separates distant clicks and clamps to duration', () => {
    const z = generateAutoZooms(cursor([0.2, 10, 19.5]), 20)
    expect(z).toHaveLength(3)
    expect(z[0].start).toBe(0)
    expect(z[2].end).toBe(20)
  })

  it('splits into separate zooms when the cursor travels far between clicks', () => {
    const d: CursorData = {
      tracked: true,
      samples: [[0, 0.5, 0.5]],
      clicks: [
        { t: 2, x: 0.05, y: 0.15, button: 'left' },
        { t: 4, x: 0.9, y: 0.07, button: 'left' },
        { t: 5.5, x: 0.5, y: 0.45, button: 'left' },
        { t: 6.5, x: 0.5, y: 0.52, button: 'left' }
      ]
    }
    const z = generateAutoZooms(d, 15)
    expect(z).toHaveLength(3)
    for (let i = 1; i < z.length; i++) expect(z[i].start).toBeGreaterThanOrEqual(z[i - 1].end)
  })

  it('merges nearby clicks in the same spot even across a pause', () => {
    const z = generateAutoZooms(cursor([2, 5]), 15)
    expect(z).toHaveLength(1)
  })

  it('returns nothing for untracked recordings', () => {
    expect(generateAutoZooms({ samples: [], clicks: [], tracked: false }, 10)).toEqual([])
  })

  it('falls back to cursor dwell detection when there are no clicks', () => {
    // move from left to right during 1-2s, then rest
    const samples: [number, number, number][] = []
    for (let t = 0; t <= 6; t += 1 / 60) {
      const x = t < 1 ? 0.1 : t < 2 ? 0.1 + 0.6 * (t - 1) : 0.7
      samples.push([t, x, 0.5])
    }
    const d = detectDwells({ samples, clicks: [], tracked: true }, 6)
    expect(d.length).toBeGreaterThanOrEqual(1)
    expect(d[0]).toBeGreaterThan(1.5)
    expect(d[0]).toBeLessThan(2.6)
  })
})

describe('zoom curve', () => {
  const seg = { id: 'a', start: 1, end: 5, scale: 2, auto: true }
  it('is 1 outside and full scale in the middle', () => {
    expect(zoomScaleAt(0.5, [seg])).toBe(1)
    expect(zoomScaleAt(3, [seg])).toBe(2)
    expect(zoomScaleAt(6, [seg])).toBe(1)
  })
  it('ramps monotonically', () => {
    let prev = 1
    for (let t = 1; t <= 1.8; t += 0.05) {
      const s = zoomScaleAt(t, [seg])
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = s
    }
  })
})

describe('camera translate', () => {
  const W = 1920
  const H = 1080
  const rect = contentRect(W, H, 1920, 1080, 0.08)
  it('is centred at scale 1', () => {
    const { tx, ty } = cameraTranslate(W, H, rect, { x: 0.9, y: 0.9 }, 1)
    expect(tx).toBeCloseTo(0)
    expect(ty).toBeCloseTo(0)
  })
  it('never shows past the content edge when zoomed', () => {
    const s = 2.5
    const { tx, ty } = cameraTranslate(W, H, rect, { x: 1, y: 1 }, s)
    // right/bottom content edges must be at or beyond the canvas edge
    expect((rect.x + rect.w) * s + tx).toBeGreaterThanOrEqual(W - 1e-6)
    expect((rect.y + rect.h) * s + ty).toBeGreaterThanOrEqual(H - 1e-6)
  })
})

describe('layout', () => {
  it('computes even output sizes for each aspect', () => {
    expect(outputSize('16:9', 2880, 1800, 1080)).toEqual({ w: 1920, h: 1080 })
    expect(outputSize('9:16', 2880, 1800, 1080)).toEqual({ w: 1080, h: 1920 })
    expect(outputSize('1:1', 2880, 1800, 720)).toEqual({ w: 720, h: 720 })
    const auto = outputSize('auto', 2880, 1800, 1080)
    expect(auto.h).toBe(1080)
    expect(auto.w % 2).toBe(0)
  })
})

describe('cursor path', () => {
  it('interpolates without smoothing', () => {
    const p = new CursorPath(
      [
        [0, 0, 0],
        [1, 1, 1]
      ],
      1,
      cursorOmega(0)
    )
    expect(p.at(0.5)!.x).toBeCloseTo(0.5, 2)
  })
  it('smoothing lags behind but converges', () => {
    const p = new CursorPath(
      [
        [0, 0, 0],
        [0.01, 1, 1],
        [3, 1, 1]
      ],
      3,
      cursorOmega(0.8)
    )
    expect(p.at(0.05)!.x).toBeLessThan(0.5)
    expect(p.at(2.9)!.x).toBeCloseTo(1, 2)
  })
})

import {
  framePlan,
  nextPlayable,
  removeRange,
  restoreRange,
  setClipEdge,
  splitAt,
  toOutput,
  toSource,
  totalLength,
  type Clip
} from '@shared/clips'

describe('clips', () => {
  const base: Clip[] = [{ id: 'a', start: 0, end: 10 }]
  it('splits and removes ranges', () => {
    const s = splitAt(base, 4)
    expect(s.map((c) => [c.start, c.end])).toEqual([
      [0, 4],
      [4, 10]
    ])
    const r = removeRange(base, 2, 3)
    expect(r.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [3, 10]
    ])
    expect(totalLength(r)).toBeCloseTo(9)
  })
  it('maps source ↔ output time across gaps', () => {
    const r = removeRange(base, 2, 3)
    expect(toOutput(5, r)).toBeCloseTo(4)
    expect(toSource(4, r)).toBeCloseTo(5)
    expect(toOutput(2.5, r)).toBeCloseTo(2)
    expect(nextPlayable(2.5, r)).toBe(3)
    expect(nextPlayable(10, r)).toBeNull()
  })
  it('restores ranges and merges', () => {
    const r = restoreRange(removeRange(base, 2, 3), 2, 3, 10)
    expect(r).toHaveLength(1)
    expect(r[0].end - r[0].start).toBeCloseTo(10)
  })
  it('clamps edges to neighbours', () => {
    const s = removeRange(base, 4, 6)
    const moved = setClipEdge(s, s[1].id, 'start', 1, 10)
    expect(moved[1].start).toBe(4)
  })
  it('plans frames per clip', () => {
    expect(framePlan(removeRange(base, 2, 3), 30).map((p) => p.frames)).toEqual([60, 210])
  })
})

import { deleteWords, fillerIndices, isKept, restoreWords, trimPauses, type Word } from '@shared/transcript'

describe('transcript editing', () => {
  const words: Word[] = [
    { text: ' Hello', start: 0.5, end: 0.9 },
    { text: ' um', start: 1.0, end: 1.2 },
    { text: ' this', start: 1.3, end: 1.5 },
    { text: ' is', start: 1.55, end: 1.7 },
    { text: ' great.', start: 4.0, end: 4.5 }
  ]
  const clips: Clip[] = [{ id: 'a', start: 0, end: 6 }]
  it('deleting words cuts exactly their span', () => {
    const c = deleteWords(clips, words, 2, 3)
    expect(isKept(words[2], c)).toBe(false)
    expect(isKept(words[3], c)).toBe(false)
    expect(isKept(words[1], c)).toBe(true)
    expect(isKept(words[4], c)).toBe(true)
  })
  it('restores deleted words', () => {
    const c = restoreWords(deleteWords(clips, words, 2, 3), words, 2, 3, 6)
    expect(c).toHaveLength(1)
    expect(isKept(words[2], c)).toBe(true)
  })
  it('finds fillers and trims long pauses', () => {
    expect(fillerIndices(words, clips)).toEqual([1])
    const c = trimPauses(clips, words, 1, 0.25)
    expect(c).toHaveLength(2)
    expect(c[0].end).toBeCloseTo(1.95)
    expect(c[1].start).toBeCloseTo(3.75)
  })
})

import {
  clearSpeed,
  framePlan as plan2,
  setRangeSpeed,
  toOutput as out2,
  toSource as src2,
  totalLength as len2
} from '@shared/clips'
import { classifyKey, keycaps, typingRanges } from '@shared/keys'

describe('clip speed', () => {
  const base = [{ id: 'a', start: 0, end: 10 }]
  it('speeds up a range and shortens the output', () => {
    const c = setRangeSpeed(base, 2, 6, 4, true)
    expect(c.map((x) => [x.start, x.end, x.speed ?? 1])).toEqual([
      [0, 2, 1],
      [2, 6, 4],
      [6, 10, 1]
    ])
    expect(len2(c)).toBeCloseTo(2 + 1 + 4)
    expect(out2(4, c)).toBeCloseTo(2.5)
    expect(src2(2.5, c)).toBeCloseTo(4)
    expect(plan2(c, 30).map((p) => p.frames)).toEqual([60, 30, 120])
  })
  it('folds slivers into the sped-up part and can be undone', () => {
    const c = setRangeSpeed(base, 0.05, 9.97, 2)
    expect(c).toHaveLength(1)
    expect(c[0].speed).toBe(2)
    expect(clearSpeed(setRangeSpeed(base, 2, 6, 3))).toEqual([
      { id: 'a', start: 0, end: 10, speed: undefined, mute: undefined }
    ])
  })
})

describe('keystrokes', () => {
  it('keeps shortcuts, anonymises typing', () => {
    expect(classifyKey('C', ['meta'])).toBe('shortcut')
    expect(classifyKey('C', ['shift'])).toBe('typing')
    expect(classifyKey('Enter', [])).toBe('special')
    expect(classifyKey('Shift', ['shift'])).toBe('ignore')
    expect(keycaps({ t: 0, key: 'Z', mods: ['shift', 'meta'] }, true)).toEqual(['⇧', '⌘', 'Z'])
    expect(keycaps({ t: 0, key: 'Z', mods: ['ctrl', 'shift'] }, false)).toEqual(['Ctrl', 'Shift', 'Z'])
  })
  it('finds typing bursts', () => {
    const typing = [
      ...Array.from({ length: 20 }, (_, i) => 2 + i * 0.15),
      9,
      12.1,
      ...Array.from({ length: 10 }, (_, i) => 15 + i * 0.2)
    ]
    expect(typingRanges(typing).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([
      [2, 5],
      [15, 16.95]
    ])
  })
})

import { findInLine, luhn } from '@shared/privacy'

describe('privacy detection', () => {
  const line = (s: string) =>
    s.split(' ').map((text, i) => ({ text, bbox: { x0: i * 100, y0: 0, x1: i * 100 + 90, y1: 20 } }))
  const kinds = (s: string) => findInLine(line(s)).map((f) => [f.kind, f.text])
  it('finds emails, cards, phones and keys', () => {
    expect(kinds('Send to kofi@studio.co today')).toEqual([['email', 'kofi@studio.co']])
    expect(luhn('4242424242424242')).toBe(true)
    expect(kinds('Card 4242 4242 4242 4242 exp 12/28')).toEqual([['card', '4242 4242 4242 4242']])
    expect(kinds('Call +234 803 555 0142 now')).toEqual([['phone', '+234 803 555 0142']])
    expect(kinds('key sk_live_51HxTq9Lk2Zp0aBcDeFgH12')).toEqual([['key', 'sk_live_51HxTq9Lk2Zp0aBcDeFgH12']])
    expect(kinds('ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')[0][0]).toBe('key')
  })
  it('ignores amounts, dates and ordinary words', () => {
    expect(kinds('Gross volume $48,240.00 12.4% vs last week')).toEqual([])
    expect(kinds('Created 2026-11-08 18:42 by Ada')).toEqual([])
    expect(kinds('Card 4242 4242 4242 4241')).toEqual([])
    expect(kinds('internationalization-configuration-settings')).toEqual([])
  })
  it('maps a match back to the words it covers', () => {
    const f = findInLine(line('Card 4242 4242 4242 4242'))[0]
    expect(f.bbox).toEqual({ x0: 100, y0: 0, x1: 490, y1: 20 })
  })
})

import { faceAt, smoothTrack } from './faceMath'

describe('face tracking', () => {
  it('holds through gaps, ignores wobble, follows real moves', () => {
    const raw: ([number, number, number, number] | [number, null, null, null])[] = []
    for (let i = 0; i < 50; i++) {
      const t = i / 5
      if (i >= 10 && i < 14)
        raw.push([t, null, null, null]) // face lost for a moment
      else raw.push([t, (i < 25 ? 0.4 : 0.7) + (i % 2 ? 0.004 : -0.004), 0.45, 0.3])
    }
    const s = smoothTrack(raw)
    expect(s).toHaveLength(50)
    // steady while the face wobbles by ±0.4%
    expect(Math.abs(s[20][1] - 0.4)).toBeLessThan(0.01)
    // ends up where you moved to
    expect(s[49][1]).toBeGreaterThan(0.66)
    const mid = faceAt({ version: 1, samples: s }, 2.1)!
    expect(mid.x).toBeGreaterThan(0.38)
  })
})

import { replaceWords } from '@shared/transcript'
describe('editing transcript text', () => {
  const ws = [
    { text: ' Hello', start: 0, end: 0.4 },
    { text: ' panda', start: 0.5, end: 0.9 },
    { text: ' crow', start: 1, end: 1.3 },
    { text: ' today.', start: 1.4, end: 1.8 }
  ]
  it('keeps timings when the word count matches', () => {
    const out = replaceWords(ws, 1, 1, 'Panda')
    expect(out.map((w) => w.text).join('')).toBe(' Hello Panda crow today.')
    expect(out[1]).toMatchObject({ start: 0.5, end: 0.9 })
  })
  it('merges or splits words within the original span', () => {
    const merged = replaceWords(ws, 1, 2, 'Pandascrow')
    expect(merged.map((w) => w.text)).toEqual([' Hello', ' Pandascrow', ' today.'])
    expect(merged[1].start).toBe(0.5)
    expect(merged[1].end).toBeLessThanOrEqual(1.3)
    const split = replaceWords(ws, 0, 0, 'Hi there,')
    expect(split.map((w) => w.text)).toEqual([' Hi', ' there,', ' panda', ' crow', ' today.'])
    expect(split[1].start).toBeGreaterThan(split[0].start)
    expect(split[1].end).toBeLessThanOrEqual(0.4)
  })
  it('removes words when the text is cleared', () => {
    expect(replaceWords(ws, 3, 3, '  ').map((w) => w.text)).toEqual([' Hello', ' panda', ' crow'])
  })
})
