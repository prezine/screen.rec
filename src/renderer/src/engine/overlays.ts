import type { CaptionSettings, EditState, KeystrokeSettings } from '@shared/types'
import type { Clip } from '@shared/clips'
import { isKept, type Word } from '@shared/transcript'
import { keycaps, type KeyEvent } from '@shared/keys'
import { clamp, easeOutCubic } from './math'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ---------------------------------------------------------------------------
// captions
// ---------------------------------------------------------------------------

export interface Cue {
  words: Word[]
  start: number
  /** last moment the cue is on screen (holds a little after the last word) */
  until: number
}

/** Group kept transcript words into short caption cues. */
export function buildCues(words: Word[], clips: Clip[], style: CaptionSettings['style']): Cue[] {
  const maxWords = style === 'bold' ? 4 : 8
  const cues: Cue[] = []
  let cur: Word[] = []
  const kept = words.filter((w) => w.text.trim() && isKept(w, clips))
  const flush = (): void => {
    if (cur.length) cues.push({ words: cur, start: cur[0].start, until: cur[cur.length - 1].end + 0.6 })
    cur = []
  }
  for (const w of kept) {
    const prev = cur[cur.length - 1]
    if (
      prev &&
      (w.start - prev.end > 0.7 ||
        cur.length >= maxWords ||
        w.end - cur[0].start > 3.4 ||
        /[.?!…]$/.test(prev.text.trim()))
    )
      flush()
    cur.push(w)
  }
  flush()
  // a cue gives way to the next one
  for (let i = 0; i < cues.length - 1; i++) cues[i].until = Math.min(cues[i].until, cues[i + 1].start)
  return cues
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const FONT = '"Degular", -apple-system, "Segoe UI", system-ui, sans-serif'

/** Frosted glass behind a shape: blur what's already drawn there, tint, rim light. */
function glassPanel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, k: number): void {
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  const c = ctx.canvas as HTMLCanvasElement | OffscreenCanvas
  ctx.filter = `blur(${Math.round(16 * k)}px) saturate(1.6)`
  ctx.drawImage(c, x, y, w, h, x, y, w, h)
  ctx.filter = 'none'
  ctx.fillStyle = 'rgba(16,16,24,0.55)'
  ctx.fillRect(x, y, w, h)
  const sheen = ctx.createLinearGradient(0, y, 0, y + h)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.03)')
  sheen.addColorStop(1, 'rgba(255,255,255,0.06)')
  ctx.fillStyle = sheen
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
  const rim = ctx.createLinearGradient(x, y, x + w, y + h)
  rim.addColorStop(0, 'rgba(255,255,255,0.55)')
  rim.addColorStop(0.5, 'rgba(255,255,255,0.12)')
  rim.addColorStop(1, 'rgba(255,255,255,0.3)')
  ctx.strokeStyle = rim
  ctx.lineWidth = Math.max(1, 1.4 * k)
  ctx.stroke()
}

/** Height the captions block takes at the bottom (so keycaps can sit above it). */
export function captionsHeight(H: number, W: number, s: CaptionSettings): number {
  const k = Math.min(W, H) / 1080
  const size = (s.style === 'bold' ? 58 : 44) * k * s.size
  return size * 1.3 * 2 + size * 0.9
}

export function drawCaptions(ctx: Ctx, W: number, H: number, cues: Cue[], t: number, s: CaptionSettings): void {
  const cue = cues.find((c) => t >= c.start - 0.08 && t < c.until)
  if (!cue) return
  const k = Math.min(W, H) / 1080
  const bold = s.style === 'bold'
  const fontSize = (bold ? 58 : 44) * k * s.size
  ctx.save()
  ctx.font = `${bold ? 800 : 600} ${fontSize}px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  const text = (w: Word): string => (bold ? w.text.trim().toUpperCase() : w.text.trim())
  // the bold outline eats into the gaps, so bold gets wider spaces
  const space = fontSize * (bold ? 0.42 : 0.27)
  // wrap into lines
  const maxW = W * (bold ? 0.7 : 0.78)
  const lines: { w: Word; width: number }[][] = [[]]
  let lineW = 0
  for (const w of cue.words) {
    const width = ctx.measureText(text(w)).width
    if (lines[lines.length - 1].length && lineW + space + width > maxW) {
      lines.push([])
      lineW = 0
    }
    lines[lines.length - 1].push({ w, width })
    lineW += (lineW ? space : 0) + width
  }
  const lineH = fontSize * 1.3
  // How much of each word is on screen. With "pop", words appear as they're spoken, so the
  // backdrop grows with the text instead of sitting there long and half-empty.
  const reveal = (w: Word): number =>
    s.animation === 'pop' ? easeOutCubic(clamp((t - w.start + 0.04) / 0.16, 0, 1)) : 1
  const widths = lines.map((l) =>
    l.reduce((sum, x) => {
      const r = reveal(x.w)
      return r > 0 ? sum + (sum > 0 ? space * r : 0) + x.width * r : sum
    }, 0)
  )
  const shownLines = lines.map((l) => reveal(l[0].w) > 0)
  const nLines = shownLines.filter(Boolean).length
  if (!nLines) {
    ctx.restore()
    return
  }
  const blockW = Math.max(...widths)
  const blockH = nLines * lineH
  const margin = H * 0.075
  const top = s.position === 'top' ? margin : H - margin - blockH

  // cue enter / exit
  const enter = clamp((t - cue.start + 0.08) / 0.2, 0, 1)
  const exit = clamp((cue.until - t) / 0.18, 0, 1)
  let alpha = s.animation === 'none' ? 1 : Math.min(easeOutCubic(enter), exit)
  if (s.animation === 'pop') alpha = exit
  const lift = s.animation === 'rise' ? (1 - easeOutCubic(enter)) * 24 * k : 0
  ctx.globalAlpha = alpha
  ctx.translate(0, lift)

  // backdrop
  const padX = fontSize * 0.55
  const padY = fontSize * 0.3
  const bx = (W - blockW) / 2 - padX
  const by = top - padY
  if (s.style === 'box') {
    roundRect(ctx, bx, by, blockW + padX * 2, blockH + padY * 2, fontSize * 0.42)
    ctx.fillStyle = 'rgba(8,8,12,0.78)'
    ctx.fill()
  } else if (s.style === 'karaoke') {
    // a soft dark pill keeps it readable on light screens
    roundRect(ctx, bx, by, blockW + padX * 2, blockH + padY * 2, fontSize * 0.7)
    ctx.fillStyle = 'rgba(10,10,16,0.55)'
    ctx.fill()
  } else if (s.style === 'glass') {
    glassPanel(ctx, bx, by, blockW + padX * 2, blockH + padY * 2, fontSize * 0.6, k)
  }

  // words
  const current = cue.words.findIndex((w, i) => t >= w.start && t < (cue.words[i + 1]?.start ?? w.end + 0.25))
  let row = 0
  lines.forEach((line, li) => {
    if (!shownLines[li]) return
    let x = (W - widths[li]) / 2
    const y = top + lineH * (row++ + 0.78)
    for (const { w, width } of line) {
      const r = reveal(w)
      if (r <= 0) continue
      const idx = cue.words.indexOf(w)
      const spoken = t >= w.start
      const isCur = idx === current
      let scale = 1
      let a = 1
      if (s.animation === 'pop') {
        // words pop in as they're spoken
        const p = clamp((t - w.start + 0.04) / 0.16, 0, 1)
        if (p <= 0) a = 0
        scale = 0.7 + 0.3 * easeOutBack(p)
        a *= Math.min(1, p * 2)
      }
      if (bold && isCur) scale *= 1.08
      let fill = '#ffffff'
      if (s.style === 'karaoke') fill = isCur ? s.highlight : spoken ? '#ffffff' : 'rgba(255,255,255,0.45)'
      else if (isCur && s.style !== 'clean') fill = s.highlight
      ctx.save()
      ctx.globalAlpha = alpha * a
      ctx.translate(x + width / 2, y - fontSize * 0.32)
      ctx.scale(scale, scale)
      ctx.translate(-width / 2, fontSize * 0.32)
      if (bold) {
        ctx.lineJoin = 'round'
        ctx.lineWidth = fontSize * 0.16
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'
        ctx.strokeText(text(w), 0, 0)
      } else if (s.style === 'clean') {
        // no backdrop: a dark outline plus shadow keeps it legible on any screen
        ctx.lineJoin = 'round'
        ctx.lineWidth = fontSize * 0.09
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = 12 * k
        ctx.strokeText(text(w), 0, 0)
        ctx.shadowColor = 'transparent'
      }
      ctx.fillStyle = fill
      ctx.fillText(text(w), 0, 0)
      ctx.restore()
      x += (width + space) * r
    }
  })
  ctx.restore()
}

function easeOutBack(p: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2
}

// ---------------------------------------------------------------------------
// keycaps
// ---------------------------------------------------------------------------

const HOLD = 1.2

export function keyEventsFor(keys: KeyEvent[] | undefined, s: KeystrokeSettings): KeyEvent[] {
  if (!keys || s.mode === 'off') return []
  return s.mode === 'all' ? keys : keys.filter((e) => e.mods.some((m) => m !== 'shift'))
}

export function drawKeycaps(
  ctx: Ctx,
  W: number,
  H: number,
  events: KeyEvent[],
  t: number,
  s: KeystrokeSettings,
  mac: boolean,
  bottomOffset: number
): void {
  // the latest event within its hold time; a newer one replaces it
  let i = -1
  for (let j = 0; j < events.length && events[j].t <= t; j++) i = j
  if (i < 0) return
  const e = events[i]
  const until = Math.min(e.t + HOLD, events[i + 1]?.t ?? Infinity)
  if (t >= until + 0.15) return
  const k = Math.min(W, H) / 1080
  const capH = 64 * k * s.size
  const gap = 10 * k * s.size
  const fontSize = capH * 0.42
  const labels = keycaps(e, mac)
  ctx.save()
  ctx.font = `600 ${fontSize}px ${FONT}`
  const widths = labels.map((l) => Math.max(capH, ctx.measureText(l).width + capH * 0.62))
  const total = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1)
  const margin = H * 0.07
  const y0 = s.position === 'top' ? margin : H - margin - capH - bottomOffset
  const appear = clamp((t - e.t) / 0.18, 0, 1)
  const fade = clamp((until + 0.15 - t) / 0.15, 0, 1)
  const scale = 0.82 + 0.18 * easeOutBack(appear)
  const press = t - e.t < 0.12 ? 3 * k * s.size : 0
  ctx.globalAlpha = Math.min(appear * 1.6, 1) * fade
  ctx.translate(W / 2, y0 + capH / 2)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -(y0 + capH / 2))
  const dark = s.style === 'dark'
  let x = (W - total) / 2
  labels.forEach((label, li) => {
    const w = widths[li]
    const r = capH * 0.22
    const depth = 5 * k * s.size
    // body (the key's side)
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 18 * k
    ctx.shadowOffsetY = 8 * k
    roundRect(ctx, x, y0 + depth, w, capH, r)
    ctx.fillStyle = dark ? '#0d0d12' : '#a9a9b6'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    // top face
    const fy = y0 + press
    const face = ctx.createLinearGradient(0, fy, 0, fy + capH)
    face.addColorStop(0, dark ? '#3c3c48' : '#ffffff')
    face.addColorStop(1, dark ? '#24242c' : '#e6e6ec')
    roundRect(ctx, x, fy, w, capH - (depth - press) * 0.2, r)
    ctx.fillStyle = face
    ctx.fill()
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
    ctx.lineWidth = Math.max(1, 1.2 * k)
    ctx.stroke()
    // highlight along the top edge
    roundRect(ctx, x + 2 * k, fy + 1.5 * k, w - 4 * k, capH * 0.45, r * 0.8)
    const hl = ctx.createLinearGradient(0, fy, 0, fy + capH * 0.45)
    hl.addColorStop(0, dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.9)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hl
    ctx.fill()
    // label
    ctx.fillStyle = dark ? '#f4f4f7' : '#26262e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, fy + capH * 0.47)
    x += w + gap
  })
  ctx.restore()
}

/** Everything drawn on top of the finished frame (captions, keycaps). */
export function drawOverlays(
  ctx: Ctx,
  W: number,
  H: number,
  edit: EditState,
  t: number,
  cues: Cue[],
  keyEvents: KeyEvent[],
  mac: boolean
): void {
  const capsOn = edit.captions.enabled && cues.length > 0
  if (capsOn) drawCaptions(ctx, W, H, cues, t, edit.captions)
  if (keyEvents.length && edit.keystrokes.mode !== 'off') {
    const under = capsOn && edit.captions.position === edit.keystrokes.position && edit.keystrokes.position === 'bottom'
    drawKeycaps(ctx, W, H, keyEvents, t, edit.keystrokes, mac, under ? captionsHeight(H, W, edit.captions) : 0)
  }
}

/** "Made with Toom" mark for Free plan exports, bottom-right. */
export function drawWatermark(ctx: Ctx, W: number, H: number): void {
  const s = Math.min(W, H)
  const font = Math.max(11, Math.round(s * 0.026))
  const padX = font * 0.8
  const h = font * 2
  const margin = Math.round(s * 0.03)
  ctx.save()
  ctx.font = `600 ${font}px -apple-system, "SF Pro Text", "Segoe UI", Inter, sans-serif`
  const label = 'Made with Toom'
  const dot = font * 0.42
  const w = ctx.measureText(label).width + padX * 2 + dot * 2.2
  const x = W - margin - w
  const y = H - margin - h
  ctx.globalAlpha = 0.9
  ctx.fillStyle = 'rgba(12,12,16,0.55)'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = Math.max(1, font * 0.06)
  ctx.stroke()
  ctx.fillStyle = '#8f80ff'
  ctx.beginPath()
  ctx.arc(x + padX + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + padX + dot * 2.2, y + h / 2 + font * 0.04)
  ctx.restore()
}
