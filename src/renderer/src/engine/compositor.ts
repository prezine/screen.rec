import type { AspectRatio, ClickEvent, CursorStyle, EditState, MaskSegment, NRect } from '@shared/types'
import { getBackgroundLayer, type BackgroundImage } from './backgrounds'
import { cameraTranslate, zoomScaleAt, type Rect } from './camera'
import type { CursorPath } from './cursor'
import { clamp, easeOutCubic } from './math'
import { geoAt, type Geo } from './layout'
import { drawOverlays, type Cue } from './overlays'
import { faceAt, type FaceTrack } from './faceMath'
import type { KeyEvent } from '@shared/keys'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface Scene {
  edit: EditState
  srcW: number
  srcH: number
  cursorPath: CursorPath | null
  followPath: CursorPath | null
  clicks: ClickEvent[]
  backgroundImage: BackgroundImage | null
  /** area recordings: region of the source frame to show */
  crop?: NRect
  /** the project has a camera track */
  hasCamera: boolean
  /** face tracking for the camera crop (camera time = t - cameraOffset) */
  faceTrack?: FaceTrack | null
  cameraOffset?: number
  /** captions + keycaps drawn over the finished frame */
  overlays?: { cues: Cue[]; keys: KeyEvent[]; mac: boolean }
}

export interface FrameInputs {
  /** source time in seconds */
  t: number
  screen: CanvasImageSource | null
  camera: CanvasImageSource | null
  cameraSize?: { w: number; h: number }
  /** intrinsic size of `screen` (needed to apply an area crop) */
  screenSize?: { w: number; h: number }
  /** person mask for the camera frame (alpha = person), any resolution, same aspect */
  cameraMask?: { source: CanvasImageSource; w: number; h: number } | null
  /** shutter for motion blur, seconds (≈ half a frame) */
  shutter?: number
}

const ASPECTS: Record<Exclude<AspectRatio, 'auto'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Output canvas size for a given "p" resolution (shorter side). */
export function outputSize(
  aspect: AspectRatio,
  srcW: number,
  srcH: number,
  shortSide: number
): { w: number; h: number } {
  const ratio = aspect === 'auto' ? (srcW > 0 && srcH > 0 ? srcW / srcH : 16 / 9) : ASPECTS[aspect]
  if (ratio >= 1) return { w: even(shortSide * ratio), h: even(shortSide) }
  return { w: even(shortSide), h: even(shortSide / ratio) }
}

/** Where the recording sits on the canvas before any zoom. */
export function contentRect(W: number, H: number, srcW: number, srcH: number, padding: number): Rect {
  const pad = padding * Math.min(W, H)
  const aw = Math.max(1, W - pad * 2)
  const ah = Math.max(1, H - pad * 2)
  const ratio = srcW > 0 && srcH > 0 ? srcW / srcH : 16 / 9
  let w = aw
  let h = aw / ratio
  if (h > ah) {
    h = ah
    w = ah * ratio
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawBackground(ctx: Ctx, W: number, H: number, scene: Scene): void {
  ctx.drawImage(
    getBackgroundLayer(Math.round(W), Math.round(H), scene.edit.background, scene.backgroundImage),
    0,
    0,
    W,
    H
  )
}

// macOS-style arrow, defined on a 0..1 box (tip at 0,0)
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.86],
  [0.22, 0.66],
  [0.36, 0.98],
  [0.5, 0.92],
  [0.36, 0.61],
  [0.64, 0.61]
]

function drawCursor(ctx: Ctx, x: number, y: number, size: number, style: CursorStyle, alpha = 1): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(x, y)
  ctx.scale(size, size)
  if (style === 'dot' || style === 'ring') {
    ctx.beginPath()
    ctx.arc(0, 0, style === 'dot' ? 0.22 : 0.32, 0, Math.PI * 2)
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 0.15
    ctx.shadowOffsetY = 0.03
    if (style === 'dot') {
      ctx.fillStyle = '#111'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = 0.07
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(120,140,170,0.18)'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      // dark outer + light inner stroke: visible on any background
      ctx.lineWidth = 0.12
      ctx.strokeStyle = 'rgba(20,24,32,0.75)'
      ctx.stroke()
      ctx.lineWidth = 0.05
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  const light = style === 'arrow-light'
  ctx.beginPath()
  ARROW.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  ctx.closePath()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 0.12
  ctx.shadowOffsetY = 0.04
  ctx.fillStyle = light ? '#fff' : '#111'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.07
  ctx.strokeStyle = light ? '#111' : '#fff'
  ctx.stroke()
  ctx.restore()
}

const CLICK_DURATION = 0.55
const GLASS_DURATION = 0.7

interface ZoomTr {
  s: number
  tx: number
  ty: number
}

function zoomAt(t: number, scene: Scene, vw: number, vh: number, rect: Rect): ZoomTr {
  const s = zoomScaleAt(t, scene.edit.zooms)
  const focus = scene.followPath?.at(t) ?? { x: 0.5, y: 0.5 }
  const { tx, ty } = cameraTranslate(vw, vh, rect, { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) }, s)
  return { s, tx, ty }
}

// ---- privacy masks ------------------------------------------------------------

const MASK_FADE = 0.12

export function maskAlpha(m: MaskSegment, t: number): number {
  if (t < m.start || t > m.end) return 0
  const f = Math.min(MASK_FADE, (m.end - m.start) / 2)
  return f <= 0 ? 1 : clamp(Math.min((t - m.start) / f, (m.end - t) / f), 0, 1)
}

let maskScratch: OffscreenCanvas | null = null

function sourceSize(input: FrameInputs): { w: number; h: number } | null {
  if (input.screenSize) return input.screenSize
  const s = input.screen as {
    displayWidth?: number
    displayHeight?: number
    videoWidth?: number
    videoHeight?: number
    width?: number
    height?: number
  } | null
  if (!s) return null
  const w = s.displayWidth ?? s.videoWidth ?? (typeof s.width === 'number' ? s.width : 0)
  const h = s.displayHeight ?? s.videoHeight ?? (typeof s.height === 'number' ? s.height : 0)
  return w > 0 && h > 0 ? { w, h } : null
}

/** Blur / pixelate / cover parts of the recording. `rect` is where the recording is drawn. */
function drawMasks(ctx: Ctx, scene: Scene, input: FrameInputs, rect: Rect): void {
  const masks = scene.edit.masks
  if (!masks.length) return
  const size = sourceSize(input)
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const unit = rect.w / 1600
  for (const m of masks) {
    const a = maskAlpha(m, input.t)
    if (a <= 0) continue
    const dx = rect.x + m.rect.x * rect.w
    const dy = rect.y + m.rect.y * rect.h
    const dw = m.rect.w * rect.w
    const dh = m.rect.h * rect.h
    if (dw < 1 || dh < 1) continue
    ctx.save()
    ctx.globalAlpha *= a
    roundedRect(ctx, dx, dy, dw, dh, Math.min(dw, dh) * 0.14)
    ctx.clip()
    if (m.style === 'solid' || !input.screen || !size) {
      ctx.fillStyle = m.color ?? '#101014'
      ctx.fillRect(dx, dy, dw, dh)
    } else {
      // matching region of the source frame
      const sx = (c.x + m.rect.x * c.w) * size.w
      const sy = (c.y + m.rect.y * c.h) * size.h
      const sw = m.rect.w * c.w * size.w
      const sh = m.rect.h * c.h * size.h
      if (m.style === 'blur') {
        const px = Math.max(2, (6 + 34 * m.strength) * unit)
        // sample a little beyond the box so the blur doesn't fade to transparent at the edges
        const padD = px * 2
        const padX = (padD * sw) / dw
        const padY = (padD * sh) / dh
        ctx.filter = `blur(${px.toFixed(1)}px)`
        ctx.drawImage(
          input.screen,
          sx - padX,
          sy - padY,
          sw + padX * 2,
          sh + padY * 2,
          dx - padD,
          dy - padD,
          dw + padD * 2,
          dh + padD * 2
        )
        ctx.filter = 'none'
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(dx, dy, dw, dh)
      } else {
        const cell = Math.max(3, (8 + 32 * m.strength) * unit)
        const cw = Math.max(1, Math.ceil(dw / cell))
        const ch = Math.max(1, Math.ceil(dh / cell))
        if (!maskScratch) maskScratch = new OffscreenCanvas(cw, ch)
        if (maskScratch.width < cw || maskScratch.height < ch) {
          maskScratch.width = Math.max(maskScratch.width, cw)
          maskScratch.height = Math.max(maskScratch.height, ch)
        }
        const sc = maskScratch.getContext('2d')!
        sc.imageSmoothingEnabled = true
        sc.clearRect(0, 0, cw, ch)
        sc.drawImage(input.screen, sx, sy, sw, sh, 0, 0, cw, ch)
        const smooth = ctx.imageSmoothingEnabled
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(maskScratch, 0, 0, cw, ch, dx, dy, cw * cell, ch * cell)
        ctx.imageSmoothingEnabled = smooth
      }
    }
    ctx.restore()
  }
}

/** Where the recording is on the canvas at time t (after layout and zoom) — for editing overlays. */
export function contentOnCanvas(t: number, W: number, H: number, scene: Scene): { rect: Rect; clip: Rect } {
  const aspect = scene.srcW > 0 && scene.srcH > 0 ? scene.srcW / scene.srcH : 16 / 9
  const g = geoAt(t, W, H, scene.edit, scene.hasCamera, aspect)
  const view = g.view
  const rect = { x: g.content.x - view.x, y: g.content.y - view.y, w: g.content.w, h: g.content.h }
  const tr = zoomAt(t, scene, view.w, view.h, rect)
  return {
    rect: { x: view.x + tr.tx + rect.x * tr.s, y: view.y + tr.ty + rect.y * tr.s, w: rect.w * tr.s, h: rect.h * tr.s },
    clip: view
  }
}

/** Draw the recording (and its cursor/clicks) into `rect`, in the current (zoomed) coordinate space. */
function drawContent(ctx: Ctx, scene: Scene, input: FrameInputs, rect: Rect, k: number, withShadow = true): void {
  const { edit } = scene
  const radius = edit.radius * Math.min(rect.w, rect.h)
  if (withShadow && edit.shadow > 0 && edit.padding > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(0,0,0,${0.55 * edit.shadow})`
    ctx.shadowBlur = 70 * edit.shadow * k
    ctx.shadowOffsetY = 24 * edit.shadow * k
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
  }

  const drawScreen = (): void => {
    if (input.screen) {
      const c = scene.crop
      if (c && input.screenSize) {
        const { w: fw, h: fh } = input.screenSize
        ctx.drawImage(input.screen, c.x * fw, c.y * fh, c.w * fw, c.h * fh, rect.x, rect.y, rect.w, rect.h)
      } else ctx.drawImage(input.screen, rect.x, rect.y, rect.w, rect.h)
    } else {
      ctx.fillStyle = '#16181d'
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
  }

  // the recording with privacy masks applied — also what the glass click effect magnifies
  const drawMasked = (): void => {
    drawScreen()
    drawMasks(ctx, scene, input, rect)
  }

  ctx.save()
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius)
  ctx.clip()
  drawMasked()

  const t = input.t
  const unit = rect.w / 1600 // cursor/click sizes scale with the recording on screen
  const size = edit.cursor.size
  const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: rect.x + p.x * rect.w,
    y: rect.y + p.y * rect.h
  })

  // click effects
  if (edit.cursor.clickEffect !== 'none' && scene.cursorPath) {
    const dur = edit.cursor.clickEffect === 'glass' ? GLASS_DURATION : CLICK_DURATION
    for (const c of scene.clicks) {
      const dt = t - c.t
      if (dt < 0 || dt > dur) continue
      const p = dt / dur
      const { x: px, y: py } = toPx(c)
      if (edit.cursor.clickEffect === 'ripple') {
        ctx.beginPath()
        ctx.arc(px, py, (8 + 38 * easeOutCubic(p)) * unit * size, 0, Math.PI * 2)
        ctx.lineWidth = 3.5 * unit * (1 - p * 0.6)
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - p)})`
        ctx.stroke()
      } else if (edit.cursor.clickEffect === 'circle') {
        ctx.beginPath()
        ctx.arc(px, py, 26 * unit * size * (1 - 0.5 * easeOutCubic(p)), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(80,140,255,${0.45 * (1 - p)})`
        ctx.fill()
      } else {
        drawGlass(ctx, px, py, 52 * unit * size, p, unit, drawMasked)
      }
    }
  }

  // cursor (+ motion trail)
  const cur = scene.cursorPath?.at(t)
  if (cur && cur.x >= -0.02 && cur.x <= 1.02 && cur.y >= -0.02 && cur.y <= 1.02) {
    const { x: cx, y: cy } = toPx(cur)
    if (edit.cursor.highlight) {
      ctx.beginPath()
      ctx.arc(cx, cy, 34 * unit * size, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 214, 10, 0.28)'
      ctx.fill()
    }
    if (edit.cursor.overlay) {
      let press = 1
      for (const c of scene.clicks) {
        const dt = t - c.t
        if (dt >= 0 && dt < 0.18) press = Math.min(press, 0.82 + 0.18 * (dt / 0.18))
      }
      const px = 30 * unit * size * press
      const blur = edit.motionBlur.cursor
      if (blur > 0) {
        const span = 0.05 * blur
        const prev = scene.cursorPath!.at(t - span)
        if (prev) {
          const a = toPx(prev)
          const dist = Math.hypot(cx - a.x, cy - a.y)
          // only streak when the cursor travels more than ~a fifth of its own size within the shutter
          if (dist > px * 0.2) {
            const n = Math.min(8, 3 + Math.round(dist / (px * 0.25)))
            for (let i = n; i >= 1; i--) {
              const q = scene.cursorPath!.at(t - (span * i) / n)
              if (!q) continue
              const g = toPx(q)
              drawCursor(ctx, g.x, g.y, px, edit.cursor.style, 0.22 * (1 - (i - 1) / n))
            }
          }
        }
      }
      drawCursor(ctx, cx, cy, px, edit.cursor.style)
    }
  }
  ctx.restore()
}

/** Glass bubble: a magnifying lens with a specular highlight that pops in and fades. */
function drawGlass(ctx: Ctx, px: number, py: number, R: number, p: number, unit: number, drawScreen: () => void): void {
  const grow = easeOutCubic(Math.min(1, p / 0.3))
  const r = R * (0.45 + 0.55 * grow) * (1 + 0.04 * Math.sin(Math.min(1, p / 0.3) * Math.PI))
  const alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45
  if (alpha <= 0 || r <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  // drop shadow + faint tint so the bubble reads on light and dark UIs
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 28 * unit
  ctx.shadowOffsetY = 10 * unit
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fill()
  ctx.restore()
  // magnified content
  ctx.save()
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.clip()
  const m = 1 + 0.3 * grow
  ctx.translate(px, py)
  ctx.scale(m, m)
  ctx.translate(-px, -py)
  drawScreen()
  ctx.restore()
  // glass shading
  const body = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.05, px, py, r)
  body.addColorStop(0, 'rgba(255,255,255,0.38)')
  body.addColorStop(0.35, 'rgba(255,255,255,0.08)')
  body.addColorStop(0.8, 'rgba(255,255,255,0.0)')
  body.addColorStop(1, 'rgba(255,255,255,0.22)')
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = body
  ctx.fill()
  ctx.fillStyle = 'rgba(140,180,255,0.07)'
  ctx.fill()
  // dark outer rim, bright inner rim
  ctx.lineWidth = Math.max(1, 3 * unit)
  ctx.strokeStyle = 'rgba(15,20,35,0.28)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(px, py, r - Math.max(1, 2 * unit), 0, Math.PI * 2)
  ctx.lineWidth = Math.max(1, 2 * unit)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.stroke()
  // inner rim shade
  ctx.beginPath()
  ctx.arc(px, py, r - ctx.lineWidth, Math.PI * 0.15, Math.PI * 0.85)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.stroke()
  // specular
  ctx.beginPath()
  ctx.ellipse(px - r * 0.38, py - r * 0.48, r * 0.26, r * 0.12, -0.6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fill()
  ctx.restore()
}

/** Draw `src` to fill `r` (cover), optionally mirrored. */
type Focus = { x: number; y: number; zoom: number } | null

function coverDraw(
  ctx: Ctx,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  r: Rect,
  mirror: boolean,
  focus: Focus = null
): void {
  const scale = Math.max(r.w / sw, r.h / sh) * (focus?.zoom ?? 1)
  const cw = r.w / scale
  const ch = r.h / scale
  let sx = (sw - cw) / 2
  // bias slightly up for portrait-ish frames so faces stay in view
  let sy = Math.max(0, (sh - ch) / 2 - (sh - ch) * 0.15)
  if (focus) {
    // face tracking: centre on the face (a touch above the middle, like a portrait), within the frame
    sx = clamp(focus.x * sw - cw / 2, 0, sw - cw)
    sy = clamp(focus.y * sh - ch * 0.44, 0, sh - ch)
  }
  if (mirror) {
    ctx.save()
    ctx.translate(r.x + r.w, r.y)
    ctx.scale(-1, 1)
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, r.w, r.h)
    ctx.restore()
  } else ctx.drawImage(src, sx, sy, cw, ch, r.x, r.y, r.w, r.h)
}

let scratch: OffscreenCanvas | null = null

function drawCamera(ctx: Ctx, g: Geo, scene: Scene, input: FrameInputs, k: number): void {
  if (g.camAlpha < 0.01 || g.cam.w < 2 || g.cam.h < 2) return
  const { cam } = g
  const mirror = scene.edit.camera.mirror
  const hasFrame = !!(input.camera && input.cameraSize)
  const mask = input.cameraMask
  const cut = mask && hasFrame ? g.cutout : 0
  const framed = 1 - cut
  const face = scene.edit.camera.faceTracking ? faceAt(scene.faceTrack, input.t - (scene.cameraOffset ?? 0)) : null
  const focus: Focus = face ? { x: face.x, y: face.y, zoom: scene.edit.camera.faceZoom ?? 1.35 } : null

  if (framed > 0.01) {
    ctx.save()
    ctx.globalAlpha *= g.camAlpha * framed
    if (g.frame > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${0.45 * g.frame})`
      ctx.shadowBlur = 40 * k
      ctx.shadowOffsetY = 14 * k
      roundedRect(ctx, cam.x, cam.y, cam.w, cam.h, g.camRadius)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.restore()
    }
    ctx.save()
    roundedRect(ctx, cam.x, cam.y, cam.w, cam.h, g.camRadius)
    ctx.clip()
    if (hasFrame) coverDraw(ctx, input.camera!, input.cameraSize!.w, input.cameraSize!.h, cam, mirror, focus)
    else {
      ctx.fillStyle = '#16181d'
      ctx.fillRect(cam.x, cam.y, cam.w, cam.h)
    }
    ctx.restore()
    if (g.frame > 0) {
      roundedRect(ctx, cam.x, cam.y, cam.w, cam.h, g.camRadius)
      ctx.lineWidth = 3 * k
      ctx.strokeStyle = `rgba(255,255,255,${0.18 * g.frame})`
      ctx.stroke()
    }
    ctx.restore()
  }

  if (cut > 0.01 && mask) {
    const w = Math.max(2, Math.round(cam.w))
    const h = Math.max(2, Math.round(cam.h))
    if (!scratch || scratch.width !== w || scratch.height !== h) scratch = new OffscreenCanvas(w, h)
    const sc = scratch.getContext('2d')!
    sc.globalCompositeOperation = 'source-over'
    sc.clearRect(0, 0, w, h)
    coverDraw(sc, input.camera!, input.cameraSize!.w, input.cameraSize!.h, { x: 0, y: 0, w, h }, mirror, focus)
    sc.globalCompositeOperation = 'destination-in'
    sc.imageSmoothingEnabled = true
    sc.imageSmoothingQuality = 'high'
    coverDraw(sc, mask.source, mask.w, mask.h, { x: 0, y: 0, w, h }, mirror, focus)
    sc.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.globalAlpha *= g.camAlpha * cut
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 30 * k
    ctx.shadowOffsetY = 10 * k
    ctx.drawImage(scratch, cam.x, cam.y, cam.w, cam.h)
    ctx.restore()
  }
}

/** Render one composed frame. Pure with respect to (scene, inputs). */
export function renderFrame(ctx: Ctx, W: number, H: number, scene: Scene, input: FrameInputs): void {
  const { edit } = scene
  const k = Math.min(W, H) / 1080 // unit scale relative to a 1080p canvas
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  drawBackground(ctx, W, H, scene)

  const aspect = scene.srcW > 0 && scene.srcH > 0 ? scene.srcW / scene.srcH : 16 / 9
  const g = geoAt(input.t, W, H, edit, scene.hasCamera, aspect)
  const view = g.view
  // content rect in view-local coordinates
  const rect = { x: g.content.x - view.x, y: g.content.y - view.y, w: g.content.w, h: g.content.h }

  if (g.screenAlpha > 0.01) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(view.x, view.y, view.w, view.h)
    ctx.clip()
    ctx.translate(view.x, view.y)
    ctx.globalAlpha = g.screenAlpha

    // camera motion blur: average a few sub-frame zoom states when the camera moves
    const now = zoomAt(input.t, scene, view.w, view.h, rect)
    const shutter = (input.shutter ?? 1 / 60) * edit.motionBlur.camera
    let samples: ZoomTr[] = [now]
    if (shutter > 0) {
      const then = zoomAt(input.t - shutter, scene, view.w, view.h, rect)
      const move =
        Math.abs(now.tx - then.tx) + Math.abs(now.ty - then.ty) + Math.abs(now.s - then.s) * Math.max(view.w, view.h)
      if (move > 1.5) {
        const n = Math.min(8, 2 + Math.round(move / 6))
        samples = []
        for (let i = n - 1; i >= 0; i--)
          samples.push(zoomAt(input.t - (shutter * i) / (n - 1), scene, view.w, view.h, rect))
      }
    }
    samples.forEach((tr, i) => {
      ctx.save()
      ctx.globalAlpha = g.screenAlpha * (i === 0 ? 1 : 1 / (i + 1))
      ctx.translate(tr.tx, tr.ty)
      ctx.scale(tr.s, tr.s)
      drawContent(ctx, scene, input, rect, k, i === 0)
      ctx.restore()
    })
    ctx.restore()
  }

  if (scene.hasCamera) drawCamera(ctx, g, scene, input, k)
  if (scene.overlays)
    drawOverlays(ctx, W, H, edit, input.t, scene.overlays.cues, scene.overlays.keys, scene.overlays.mac)
  ctx.restore()
}
