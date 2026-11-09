import { useCallback, useEffect, useRef, useState } from 'react'

/** Camera + microphone inputs; re-enumerates on device changes. */
export function useMediaDevices(): {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
  refresh: () => Promise<void>
  unlock: (kind: 'video' | 'audio') => Promise<void>
} {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const refresh = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    setCameras(all.filter((d) => d.kind === 'videoinput' && d.deviceId))
    setMics(all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications'))
  }, [])
  /** Device labels are empty until the page has used a device once. */
  const unlock = useCallback(
    async (kind: 'video' | 'audio') => {
      const all = await navigator.mediaDevices.enumerateDevices()
      if (all.some((d) => (kind === 'video' ? d.kind === 'videoinput' : d.kind === 'audioinput') && d.label)) return
      try {
        const s = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { video: true } : { audio: true })
        s.getTracks().forEach((t) => t.stop())
      } catch {
        /* permission denied: labels stay generic */
      }
      await refresh()
    },
    [refresh]
  )
  useEffect(() => {
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])
  return { cameras, mics, refresh, unlock }
}

export function deviceLabel(d: MediaDeviceInfo | undefined, fallback: string): string {
  if (!d) return fallback
  return (d.label || fallback).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
}

/** Small live camera preview. */
export function CameraPreview({ deviceId, className }: { deviceId: string; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let stream: MediaStream | null = null
    let alive = true
    setError(false)
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 640 } } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (ref.current) ref.current.srcObject = s
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId])
  return (
    <div className={className}>
      {error ? (
        <div className="grid size-full place-items-center text-xs text-ink-400">Camera unavailable</div>
      ) : (
        <video ref={ref} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
      )}
    </div>
  )
}

/** Live microphone level bar. */
export function MicLevel({ deviceId }: { deviceId: string }): React.JSX.Element {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: deviceId === 'default' ? undefined : { exact: deviceId } } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 512
        ctx.createMediaStreamSource(s).connect(an)
        const data = new Float32Array(an.fftSize)
        let level = 0
        const tick = (): void => {
          an.getFloatTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v))
          level = Math.max(peak, level * 0.9)
          if (bar.current) bar.current.style.width = `${Math.min(100, Math.sqrt(level) * 120)}%`
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => undefined)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId])
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div
        ref={bar}
        className="h-full w-0 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-400 to-amber-300 transition-[width] duration-75"
      />
    </div>
  )
}
