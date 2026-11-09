import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { api } from './api'

// Native Liquid Glass behind floating elements (macOS 26+).
// Each element registered here gets a click-through glass window placed exactly behind it.

type Info = Awaited<ReturnType<typeof api.glass.info>>
let infoPromise: Promise<Info> | null = null
export function glassInfo(): Promise<Info> {
  if (!infoPromise) infoPromise = api.glass.info().catch(() => ({ regions: false, material: 'none' as const }))
  return infoPromise
}

export function useGlassInfo(): Info | null {
  const [info, setInfo] = useState<Info | null>(null)
  useEffect(() => {
    void glassInfo().then(setInfo)
  }, [])
  return info
}

if (typeof window !== 'undefined') window.api?.glass?.onRefresh?.(() => refreshGlass())

const regions = new Map<string, { el: HTMLElement; r: number }>()
let raf = 0

function flush(): void {
  raf = 0
  const list: { id: string; x: number; y: number; w: number; h: number; r: number }[] = []
  regions.forEach(({ el, r }, id) => {
    const b = el.getBoundingClientRect()
    if (b.width < 2 || b.height < 2) return
    list.push({ id, x: b.left, y: b.top, w: b.width, h: b.height, r })
  })
  api.glass.setRegions(list)
}

/** Re-send all regions (after the window is shown again, or layout moved). */
export function refreshGlass(): void {
  if (!raf) raf = requestAnimationFrame(flush)
}

/** Put native glass behind `ref`'s element while it's mounted. `radius` in CSS px. */
export function useGlassRegion(
  ref: RefObject<HTMLElement | null>,
  id: string,
  radius: number,
  enabled = true
): boolean {
  const [native, setNative] = useState(false)
  const idRef = useRef(id)
  idRef.current = id
  useEffect(() => {
    void glassInfo().then((i) => setNative(i.regions))
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!native || !enabled || !el) return
    el.dataset.nativeGlass = ''
    regions.set(id, { el, r: radius })
    refreshGlass()
    const ro = new ResizeObserver(refreshGlass)
    ro.observe(el)
    window.addEventListener('resize', refreshGlass)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', refreshGlass)
      delete el.dataset.nativeGlass
      regions.delete(id)
      refreshGlass()
    }
  }, [ref, id, radius, native, enabled])
  return native
}
