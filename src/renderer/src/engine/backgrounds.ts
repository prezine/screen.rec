import type { BackgroundSettings } from '@shared/types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

export interface GradientPreset {
  id: string
  name: string
  angle: number // degrees, CSS convention (0 = to top, 90 = to right)
  stops: string[]
}

export const GRADIENTS: GradientPreset[] = [
  { id: 'aurora', name: 'Aurora', angle: 135, stops: ['#6a5cff', '#c34dff', '#ff6fa8'] },
  { id: 'ocean', name: 'Ocean', angle: 160, stops: ['#0f2b5b', '#1d6fd8', '#58d0ff'] },
  { id: 'sunset', name: 'Sunset', angle: 120, stops: ['#ff7a45', '#ff4d6d', '#7b2cbf'] },
  { id: 'mint', name: 'Mint', angle: 140, stops: ['#0bab64', '#3bb78f', '#c4f1d8'] },
  { id: 'peach', name: 'Peach', angle: 130, stops: ['#ffd1a9', '#ff9a8b', '#ff6a88'] },
  { id: 'midnight', name: 'Midnight', angle: 150, stops: ['#0b0c10', '#1f2235', '#3a3f6b'] },
  { id: 'lime', name: 'Lime', angle: 135, stops: ['#d4fc79', '#96e6a1'] },
  { id: 'ember', name: 'Ember', angle: 145, stops: ['#2b0a0a', '#8f1d1d', '#ff7b39'] },
  { id: 'sky', name: 'Sky', angle: 180, stops: ['#a1c4fd', '#c2e9fb'] },
  { id: 'grape', name: 'Grape', angle: 135, stops: ['#43137a', '#7a2fd0', '#e3a6ff'] },
  { id: 'steel', name: 'Steel', angle: 160, stops: ['#3a4250', '#6b7688', '#aab4c3'] },
  { id: 'candy', name: 'Candy', angle: 120, stops: ['#ff9de2', '#a18cd1', '#7f7fd5'] }
]

export function gradientCss(g: GradientPreset): string {
  return `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`
}

function paintGradient(ctx: Ctx, W: number, H: number, g: GradientPreset): void {
  const a = ((g.angle - 90) * Math.PI) / 180
  const len = Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))
  const cx = W / 2
  const cy = H / 2
  const dx = (Math.cos(a) * len) / 2
  const dy = (Math.sin(a) * len) / 2
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  g.stops.forEach((c, i) => grad.addColorStop(g.stops.length === 1 ? 0 : i / (g.stops.length - 1), c))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
}

// ---------------------------------------------------------------------------
// Wallpapers: procedural "mesh" gradients made of soft colour blobs.
// The same definition renders to CSS (swatches) and to canvas (preview/export).
// ---------------------------------------------------------------------------

export interface Blob {
  x: number // 0..1
  y: number // 0..1
  r: number // radius as a fraction of the larger side
  c: string
}

export interface Wallpaper {
  id: string
  name: string
  group: 'Vivid' | 'Soft' | 'Dark'
  base: string
  blobs: Blob[]
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'dusk',
    name: 'Dusk',
    group: 'Vivid',
    base: '#1b2a6b',
    blobs: [
      { x: 0.05, y: 0.15, r: 0.55, c: '#e9806e' },
      { x: 0.55, y: 1.0, r: 0.6, c: '#f2a65a' },
      { x: 0.95, y: 0.1, r: 0.55, c: '#2a52be' },
      { x: 0.4, y: 0.45, r: 0.45, c: '#3b5bdb' }
    ]
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    group: 'Vivid',
    base: '#063a5c',
    blobs: [
      { x: 0.1, y: 0.9, r: 0.6, c: '#00b4a6' },
      { x: 0.9, y: 0.15, r: 0.55, c: '#3a86ff' },
      { x: 0.5, y: 0.4, r: 0.4, c: '#48cae4' }
    ]
  },
  {
    id: 'bloom',
    name: 'Bloom',
    group: 'Vivid',
    base: '#5a189a',
    blobs: [
      { x: 0.0, y: 0.0, r: 0.6, c: '#ff5d8f' },
      { x: 1.0, y: 1.0, r: 0.65, c: '#ff9e00' },
      { x: 0.75, y: 0.2, r: 0.4, c: '#c77dff' }
    ]
  },
  {
    id: 'citrus',
    name: 'Citrus',
    group: 'Vivid',
    base: '#ff8800',
    blobs: [
      { x: 0.15, y: 0.2, r: 0.55, c: '#ffd60a' },
      { x: 0.85, y: 0.85, r: 0.6, c: '#ff4d00' },
      { x: 0.9, y: 0.1, r: 0.35, c: '#ffb703' }
    ]
  },
  {
    id: 'meadow',
    name: 'Meadow',
    group: 'Vivid',
    base: '#1b4332',
    blobs: [
      { x: 0.1, y: 0.1, r: 0.55, c: '#95d5b2' },
      { x: 0.9, y: 0.9, r: 0.6, c: '#2d6a4f' },
      { x: 0.7, y: 0.3, r: 0.4, c: '#d8f3dc' }
    ]
  },
  {
    id: 'flamingo',
    name: 'Flamingo',
    group: 'Vivid',
    base: '#ff6b9d',
    blobs: [
      { x: 0.0, y: 1.0, r: 0.6, c: '#ffc2d1' },
      { x: 1.0, y: 0.0, r: 0.55, c: '#c9184a' },
      { x: 0.6, y: 0.6, r: 0.4, c: '#ff8fab' }
    ]
  },
  {
    id: 'glacier',
    name: 'Glacier',
    group: 'Soft',
    base: '#dfe9f3',
    blobs: [
      { x: 0.1, y: 0.1, r: 0.55, c: '#ffffff' },
      { x: 0.9, y: 0.8, r: 0.6, c: '#a2c4f0' },
      { x: 0.6, y: 0.2, r: 0.4, c: '#cddafd' }
    ]
  },
  {
    id: 'blush',
    name: 'Blush',
    group: 'Soft',
    base: '#fde2e4',
    blobs: [
      { x: 0.0, y: 0.0, r: 0.6, c: '#fad2e1' },
      { x: 1.0, y: 1.0, r: 0.6, c: '#e2ece9' },
      { x: 0.8, y: 0.2, r: 0.4, c: '#ffd6a5' }
    ]
  },
  {
    id: 'lavender',
    name: 'Lavender',
    group: 'Soft',
    base: '#e0d7ff',
    blobs: [
      { x: 0.15, y: 0.85, r: 0.6, c: '#bdb2ff' },
      { x: 0.85, y: 0.15, r: 0.55, c: '#ffc6ff' },
      { x: 0.5, y: 0.5, r: 0.35, c: '#f1eaff' }
    ]
  },
  {
    id: 'sand',
    name: 'Sand',
    group: 'Soft',
    base: '#f4e1c1',
    blobs: [
      { x: 0.1, y: 0.2, r: 0.55, c: '#fff1d6' },
      { x: 0.9, y: 0.9, r: 0.6, c: '#e9b872' },
      { x: 0.8, y: 0.15, r: 0.35, c: '#f7d9a8' }
    ]
  },
  {
    id: 'nebula',
    name: 'Nebula',
    group: 'Dark',
    base: '#0b0b1e',
    blobs: [
      { x: 0.15, y: 0.25, r: 0.5, c: '#5a2ca0' },
      { x: 0.85, y: 0.8, r: 0.55, c: '#1e3a8a' },
      { x: 0.7, y: 0.15, r: 0.3, c: '#be185d' }
    ]
  },
  {
    id: 'abyss',
    name: 'Abyss',
    group: 'Dark',
    base: '#020617',
    blobs: [
      { x: 0.0, y: 1.0, r: 0.6, c: '#0f766e' },
      { x: 1.0, y: 0.0, r: 0.55, c: '#1e40af' },
      { x: 0.5, y: 0.5, r: 0.3, c: '#0e7490' }
    ]
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    group: 'Dark',
    base: '#0a0a0a',
    blobs: [
      { x: 0.2, y: 0.2, r: 0.55, c: '#27272a' },
      { x: 0.85, y: 0.85, r: 0.5, c: '#3f3f46' },
      { x: 0.8, y: 0.2, r: 0.3, c: '#18181b' }
    ]
  },
  {
    id: 'ember-night',
    name: 'Ember',
    group: 'Dark',
    base: '#120404',
    blobs: [
      { x: 0.1, y: 0.95, r: 0.55, c: '#9a031e' },
      { x: 0.95, y: 0.1, r: 0.45, c: '#e36414' },
      { x: 0.55, y: 0.5, r: 0.3, c: '#5f0f40' }
    ]
  }
]

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  )
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function wallpaperCss(w: Wallpaper): string {
  const layers = w.blobs.map(
    (b) => `radial-gradient(circle at ${b.x * 100}% ${b.y * 100}%, ${hexA(b.c, 1)} 0%, ${hexA(b.c, 0)} ${b.r * 140}%)`
  )
  return `${layers.join(', ')}, ${w.base}`
}

function paintWallpaper(ctx: Ctx, W: number, H: number, w: Wallpaper): void {
  ctx.fillStyle = w.base
  ctx.fillRect(0, 0, W, H)
  const L = Math.max(W, H)
  for (const b of w.blobs) {
    const x = b.x * W
    const y = b.y * H
    const r = b.r * 1.4 * L
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, hexA(b.c, 1))
    g.addColorStop(0.5, hexA(b.c, 0.5))
    g.addColorStop(1, hexA(b.c, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
}

export const SOLIDS = [
  '#0d0e12',
  '#ffffff',
  '#f2f2f7',
  '#1c1c1e',
  '#2f6bff',
  '#ff5a36',
  '#18a957',
  '#ffcc00',
  '#7c3aed',
  '#ec4899'
]

// ---------------------------------------------------------------------------
// Background layer (cached — the background is static, so it's rendered once per size/settings)
// ---------------------------------------------------------------------------

export interface BackgroundImage {
  source: CanvasImageSource
  w: number
  h: number
  key: string
}

const cache = new Map<string, OffscreenCanvas>()

function paintBase(ctx: Ctx, W: number, H: number, bg: BackgroundSettings, img: BackgroundImage | null): void {
  if (bg.kind === 'wallpaper') {
    paintWallpaper(ctx, W, H, WALLPAPERS.find((w) => w.id === bg.value) ?? WALLPAPERS[0])
  } else if (bg.kind === 'gradient') {
    paintGradient(ctx, W, H, GRADIENTS.find((g) => g.id === bg.value) ?? GRADIENTS[0])
  } else if (bg.kind === 'solid') {
    ctx.fillStyle = bg.value
    ctx.fillRect(0, 0, W, H)
  } else if (bg.kind === 'image' && img) {
    const s = Math.max(W / img.w, H / img.h)
    ctx.drawImage(img.source, (W - img.w * s) / 2, (H - img.h * s) / 2, img.w * s, img.h * s)
  } else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
  }
}

export function getBackgroundLayer(
  W: number,
  H: number,
  bg: BackgroundSettings,
  img: BackgroundImage | null
): OffscreenCanvas {
  const key = `${W}x${H}|${bg.kind}|${bg.value}|${bg.blur}|${bg.kind === 'image' ? (img?.key ?? 'none') : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  const blurPx = bg.blur * Math.min(W, H) * 0.04
  if (blurPx > 0.5 && bg.kind !== 'solid') {
    // paint to a temp layer, then blur it slightly enlarged so edges don't fade
    const tmp = new OffscreenCanvas(W, H)
    paintBase(tmp.getContext('2d')!, W, H, bg, img)
    const m = blurPx * 2
    ctx.filter = `blur(${blurPx}px)`
    ctx.drawImage(tmp, -m, -m, W + m * 2, H + m * 2)
    ctx.filter = 'none'
  } else {
    paintBase(ctx, W, H, bg, img)
  }
  // a 4K layer is ~33 MB; keep only the few sizes in use (preview + export)
  if (cache.size >= 3) cache.delete(cache.keys().next().value!)
  cache.set(key, canvas)
  return canvas
}
