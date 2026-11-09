import { useEffect } from 'react'
import type { AppSettings } from '@shared/settings'
import { api } from './api'

// Liquid Glass, in CSS.
// - Settings → Appearance drive a few CSS variables (tint, frost, highlights).
// - Refraction: every `.glass` element gets an SVG displacement map shaped like its own rounded
//   outline, used as a backdrop filter. Content behind the rim bends inward like light through the
//   thick edge of a lens, with a faint colour fringe; the middle stays undistorted.

type Appearance = AppSettings['appearance']

export function glassVars(a: Appearance): Record<string, string> {
  const t = a.transparency
  const tint = a.glass === 'tinted' ? 0.86 - 0.42 * t : 0.6 - 0.5 * t
  return {
    '--glass-tint-a': tint.toFixed(3),
    '--glass-blur': `${Math.round(4 + 40 * a.blur)}px`,
    '--glass-sat': `${Math.round(150 + 50 * a.blur)}%`,
    '--glass-spec': a.highlights.toFixed(2)
  }
}

let current: Appearance | null = null

// The recording controls (island, toolbar) and the area picker sit over whatever is on screen,
// next to the notch: they stay dark in every theme.
const ALWAYS_DARK = ['/island', '/toolbar', '/area']
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** light or dark for this window, from Settings → Appearance → Theme (System follows the OS) */
export function resolveTheme(mode: Appearance['theme'] | undefined): 'light' | 'dark' {
  const route = location.hash.replace(/^#/, '')
  if (ALWAYS_DARK.some((r) => route.startsWith(r))) return 'dark'
  if (mode === 'light' || mode === 'dark') return mode
  return darkQuery?.matches === false ? 'light' : 'dark'
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(current?.theme)
}
darkQuery?.addEventListener('change', () => applyTheme())

export function applyAppearance(a: Appearance): void {
  current = a
  const root = document.documentElement
  for (const [k, v] of Object.entries(glassVars(a))) root.style.setProperty(k, v)
  root.dataset.glass = a.glass
  applyTheme()
  scheduleScan()
}

/** Keep this window's glass in sync with settings. Mount once per window. */
export function useAppearance(): void {
  useEffect(() => {
    let alive = true
    void api.settings.get().then((s) => alive && applyAppearance(s.appearance))
    const off = api.settings.onChanged((s) => applyAppearance(s.appearance))
    startRefraction()
    return () => {
      alive = false
      off()
    }
  }, [])
}

// ---------------------------------------------------------------------------
// refraction
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
let defs: SVGDefsElement | null = null
const filters = new Map<string, string>() // shape key → filter id
let nextId = 0

function ensureDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  svg.style.pointerEvents = 'none'
  defs = document.createElementNS(SVG_NS, 'defs')
  svg.appendChild(defs)
  document.body.appendChild(svg)
  filters.clear()
  return defs
}

/**
 * Displacement map for a rounded rectangle: neutral grey in the middle; within `bezel` of the edge,
 * red/green encode a push toward the centre that grows sharply at the rim (a convex glass edge).
 */
export function displacementMap(w: number, h: number, r: number, bezel: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const d = img.data
  const hx = w / 2
  const hy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx
      const py = y + 0.5 - hy
      // signed distance to the rounded rect (negative inside)
      const qx = Math.abs(px) - hx + r
      const qy = Math.abs(py) - hy + r
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
      const inside = -sd
      let dx = 0
      let dy = 0
      if (inside < bezel && inside > -1) {
        // outward normal
        let nx: number
        let ny: number
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1
          nx = (qx / l) * Math.sign(px)
          ny = (qy / l) * Math.sign(py)
        } else if (qx > qy) {
          nx = Math.sign(px)
          ny = 0
        } else {
          nx = 0
          ny = Math.sign(py)
        }
        const k = 1 - Math.max(0, inside) / bezel // 0 inside → 1 at the rim
        // a rounded glass edge: gentle near the middle, bending hardest at the rim
        const m = 1 - Math.sqrt(Math.max(0, 1 - k * k))
        dx = -nx * m
        dy = -ny * m
      }
      const i = (y * w + x) * 4
      d[i] = 128 + dx * 127
      d[i + 1] = 128 + dy * 127
      d[i + 2] = 128
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

function filterFor(w: number, h: number, r: number, strength: number): string {
  const bezel = Math.max(8, Math.min(44, Math.min(w, h) * 0.42))
  const scale = Math.round(10 + 80 * strength)
  const key = `${w}x${h}r${r}s${scale}`
  const hit = filters.get(key)
  if (hit) return hit
  const root = ensureDefs()
  const id = `toom-glass-${nextId++}`
  const f = document.createElementNS(SVG_NS, 'filter')
  f.id = id
  f.setAttribute('x', '0')
  f.setAttribute('y', '0')
  f.setAttribute('width', String(w))
  f.setAttribute('height', String(h))
  f.setAttribute('filterUnits', 'userSpaceOnUse')
  f.setAttribute('primitiveUnits', 'userSpaceOnUse')
  f.setAttribute('color-interpolation-filters', 'sRGB')
  const map = displacementMap(w, h, r, bezel)
  // red, green and blue bend by slightly different amounts → a faint prism fringe at the rim
  const channel = (s: number, row: string, name: string): string =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${name}d"/>` +
    `<feColorMatrix in="${name}d" type="matrix" values="${row}" result="${name}"/>`
  f.innerHTML =
    `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
    channel(scale, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r') +
    channel(scale * 0.94, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g') +
    channel(scale * 0.88, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b') +
    `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
  root.appendChild(f)
  filters.set(key, id)
  // keep the defs small: drop the oldest filters
  if (filters.size > 48) {
    const [oldKey, oldId] = filters.entries().next().value as [string, string]
    filters.delete(oldKey)
    document.getElementById(oldId)?.remove()
  }
  return id
}

const BASE = 'blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(1.04)'
let started = false
let pending = 0
const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleScan()) : null
const observed = new WeakSet<Element>()

function scheduleScan(): void {
  if (!started || pending) return
  pending = requestAnimationFrame(scan)
}

function scan(): void {
  pending = 0
  const a = current
  const on = !!a && a.glass !== 'solid' && a.refraction > 0.01
  document.querySelectorAll<HTMLElement>('.glass, .glass-strong').forEach((el) => {
    if (resize && !observed.has(el)) {
      observed.add(el)
      resize.observe(el)
    }
    if (!on || 'nativeGlass' in el.dataset) {
      if (el.dataset.refract) {
        el.style.removeProperty('backdrop-filter')
        el.style.removeProperty('-webkit-backdrop-filter')
        delete el.dataset.refract
      }
      return
    }
    const w = Math.round(el.offsetWidth)
    const h = Math.round(el.offsetHeight)
    if (w < 8 || h < 8 || w * h > 1_600_000) return
    const cs = getComputedStyle(el)
    const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2)
    const id = filterFor(w, h, Math.round(r), a!.refraction)
    if (el.dataset.refract === id) return
    el.dataset.refract = id
    const value = `${BASE} url(#${id})`
    el.style.setProperty('backdrop-filter', value)
    el.style.setProperty('-webkit-backdrop-filter', value)
  })
}

function startRefraction(): void {
  if (started) return
  started = true
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-native-glass']
  })
  scheduleScan()
}
