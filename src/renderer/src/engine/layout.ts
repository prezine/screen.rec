import type { CameraLayout, EditState, LayoutSegment } from '@shared/types'
import type { Rect } from './camera'
import { clamp, easeInOutCubic, lerp } from './math'

/** Where things go on the canvas for one camera layout. */
export interface Geo {
  /** viewport the screen recording (and its zoom) lives in — also its clip region */
  view: Rect
  /** where the recording sits before zoom (canvas px) */
  content: Rect
  screenAlpha: number
  /** camera frame rect (canvas px) */
  cam: Rect
  camRadius: number
  camAlpha: number
  /** 0..1: how much of the camera is shown as a background-removed cutout */
  cutout: number
  /** 0..1: draw the subtle rim + shadow of a framed camera */
  frame: number
}

export const LAYOUT_LABELS: Record<CameraLayout, string> = {
  overlay: 'Camera overlay',
  screen: 'Screen only',
  camera: 'Fullscreen camera',
  split: 'Split screen',
  cutout: 'Camera cutout'
}

export const TRANSITION = 0.45

function bubble(W: number, H: number, e: EditState, scale = 1): Rect {
  const m = Math.min(W, H)
  const size = e.camera.size * m * scale
  const margin = 0.035 * m
  const right = e.camera.corner.endsWith('right')
  const bottom = e.camera.corner.startsWith('bottom')
  return { x: right ? W - margin - size : margin, y: bottom ? H - margin - size : margin, w: size, h: size }
}

function bubbleRadius(e: EditState, r: Rect): number {
  const s = Math.min(r.w, r.h)
  return e.camera.shape === 'circle' ? s / 2 : e.camera.shape === 'rounded' ? s * 0.18 : s * 0.02
}

function fit(aspect: number, w: number, h: number): { w: number; h: number } {
  let cw = w
  let ch = w / aspect
  if (ch > h) {
    ch = h
    cw = h * aspect
  }
  return { w: cw, h: ch }
}

/** Recording placement on the full canvas with the frame padding. */
function paddedContent(W: number, H: number, aspect: number, padding: number): Rect {
  const pad = padding * Math.min(W, H)
  const { w, h } = fit(aspect, Math.max(1, W - pad * 2), Math.max(1, H - pad * 2))
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

export function layoutGeo(
  kind: CameraLayout,
  W: number,
  H: number,
  e: EditState,
  hasCamera: boolean,
  aspect = 16 / 9
): Geo {
  const full: Rect = { x: 0, y: 0, w: W, h: H }
  const m = Math.min(W, H)
  const pad = e.padding * m
  const frameRadius = Math.max(e.radius * m * 1.2, 6 * (m / 1080))
  if (!hasCamera) kind = 'screen'
  const content = paddedContent(W, H, aspect, e.padding)
  switch (kind) {
    case 'overlay': {
      const cam = bubble(W, H, e)
      return {
        view: full,
        content,
        screenAlpha: 1,
        cam,
        camRadius: bubbleRadius(e, cam),
        camAlpha: 1,
        cutout: 0,
        frame: 1
      }
    }
    case 'cutout': {
      const b = bubble(W, H, e, 1.55)
      // stand the person on the bottom edge
      const bottom = e.camera.corner.startsWith('bottom')
      const cam = { ...b, y: bottom ? H - b.h : b.y }
      return { view: full, content, screenAlpha: 1, cam, camRadius: 0, camAlpha: 1, cutout: 1, frame: 0 }
    }
    case 'camera': {
      const cam = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }
      return {
        view: full,
        content,
        screenAlpha: 0,
        cam,
        camRadius: pad > 0 ? frameRadius : 0,
        camAlpha: 1,
        cutout: 0,
        frame: 1
      }
    }
    case 'split': {
      // two equal panels — recording and camera — side by side (stacked when portrait)
      const gap = Math.max(pad, 0.03 * m)
      if (W >= H) {
        const pw = (W - gap * 3) / 2
        const box = fit(aspect, pw, H - gap * 2)
        const y = (H - box.h) / 2
        const lc = gap + pw / 2
        const rc = W - gap - pw / 2
        return {
          view: { x: 0, y: 0, w: W / 2, h: H },
          content: { x: lc - box.w / 2, y, w: box.w, h: box.h },
          screenAlpha: 1,
          cam: { x: rc - box.w / 2, y, w: box.w, h: box.h },
          camRadius: e.radius * Math.min(box.w, box.h),
          camAlpha: 1,
          cutout: 0,
          frame: 1
        }
      }
      const ph = (H - gap * 3) / 2
      const box = fit(aspect, W - gap * 2, ph)
      const x = (W - box.w) / 2
      const tc = gap + ph / 2
      const bc = H - gap - ph / 2
      return {
        view: { x: 0, y: 0, w: W, h: H / 2 },
        content: { x, y: tc - box.h / 2, w: box.w, h: box.h },
        screenAlpha: 1,
        cam: { x, y: bc - box.h / 2, w: box.w, h: box.h },
        camRadius: e.radius * Math.min(box.w, box.h),
        camAlpha: 1,
        cutout: 0,
        frame: 1
      }
    }
    case 'screen':
    default: {
      // camera collapses into its corner
      const b = bubble(W, H, e)
      const cam = { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 }
      return { view: full, content, screenAlpha: 1, cam, camRadius: 0, camAlpha: 0, cutout: 0, frame: 1 }
    }
  }
}

const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k)
})

export function mixGeo(a: Geo, b: Geo, k: number): Geo {
  if (k <= 0) return a
  if (k >= 1) return b
  return {
    view: lerpRect(a.view, b.view, k),
    content: lerpRect(a.content, b.content, k),
    screenAlpha: lerp(a.screenAlpha, b.screenAlpha, k),
    cam: lerpRect(a.cam, b.cam, k),
    camRadius: lerp(a.camRadius, b.camRadius, k),
    camAlpha: lerp(a.camAlpha, b.camAlpha, k),
    cutout: lerp(a.cutout, b.cutout, k),
    frame: lerp(a.frame, b.frame, k)
  }
}

/** Which layouts are active at t, and how far the transition between them has progressed. */
export function layoutAt(t: number, e: EditState): { from: CameraLayout; to: CameraLayout; k: number } {
  const base = e.camera.layout
  const seg = e.layouts.find((s) => t >= s.start && t < s.end)
  if (!seg) return { from: base, to: base, k: 1 }
  const len = seg.end - seg.start
  const T = Math.min(TRANSITION, len / 2)
  if (t < seg.start + T) return { from: base, to: seg.layout, k: easeInOutCubic(clamp((t - seg.start) / T, 0, 1)) }
  if (t > seg.end - T) return { from: seg.layout, to: base, k: easeInOutCubic(clamp((t - (seg.end - T)) / T, 0, 1)) }
  return { from: seg.layout, to: seg.layout, k: 1 }
}

export function geoAt(t: number, W: number, H: number, e: EditState, hasCamera: boolean, aspect: number): Geo {
  const { from, to, k } = layoutAt(t, e)
  const b = layoutGeo(to, W, H, e, hasCamera, aspect)
  return from === to ? b : mixGeo(layoutGeo(from, W, H, e, hasCamera, aspect), b, k)
}

/** Does any part of the edit show the camera / need background removal? */
export function usesCamera(e: EditState): boolean {
  return e.camera.layout !== 'screen' || e.layouts.some((l) => l.layout !== 'screen')
}
export function usesCutout(e: EditState): boolean {
  return e.camera.layout === 'cutout' || e.layouts.some((l) => l.layout === 'cutout')
}

export function newLayoutSegment(t: number, duration: number, layout: CameraLayout, id: string): LayoutSegment {
  const start = clamp(t, 0, Math.max(0, duration - 1))
  return { id, start, end: Math.min(duration, start + 3), layout }
}
