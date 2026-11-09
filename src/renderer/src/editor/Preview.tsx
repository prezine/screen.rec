import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { SoundPlayer, duckCurve } from '@renderer/engine/sounds'
import { contentSize, type EditState, type ProjectMeta } from '@shared/types'
import { mediaUrl } from '@renderer/lib/api'
import { clipAt, firstStart, lastEnd, nextPlayable, speedOf } from '@shared/clips'
import { outputSize, renderFrame, type Scene } from '@renderer/engine/compositor'
import { layoutAt, usesCutout } from '@renderer/engine/layout'
import { PersonSegmenter, type Mask } from '@renderer/engine/segment'

// Keep videos in the DOM (so they keep decoding) but invisible.
const HIDDEN: React.CSSProperties = { position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }

export interface PlayerHandle {
  play(): void
  pause(): void
  toggle(): void
  seek(t: number): void
  readonly time: number
  readonly playing: boolean
  canvas(): HTMLCanvasElement | null
}

export type PreviewQuality = 1 | 0.5 | 0.25

interface Props {
  project: ProjectMeta
  edit: EditState
  scene: Scene
  quality: PreviewQuality
  rate: number
  onTime: (t: number) => void
  onPlaying: (p: boolean) => void
  onCutoutStatus?: (s: 'idle' | 'loading' | 'ready' | 'error', message?: string) => void
  /** editing overlay drawn over the canvas (CSS px size of the canvas) */
  overlay?: (width: number, height: number) => React.ReactNode
  /** recording waveform (30/s) — music ducks under your voice */
  peaks?: Float32Array | null
  /** silence everything (while recording a voice-over) */
  muted?: boolean
}

export const Preview = forwardRef<PlayerHandle, Props>(function Preview(
  { project, edit, scene, quality, rate, onTime, onPlaying, onCutoutStatus, overlay, peaks, muted },
  ref
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  // music and sound effects play through Web Audio, scheduled against the video's clock
  const sounds = useRef<SoundPlayer | null>(null)
  const hasMusic = edit.sounds.some((x) => x.kind === 'music')
  const voiceKey = JSON.stringify(edit.sounds.filter((x) => x.kind === 'voice').map((x) => [x.start, x.end]))
  const duck = useMemo(
    () =>
      hasMusic
        ? duckCurve(peaks ?? null, edit.audio.duck, 30, JSON.parse(voiceKey) as [number, number][], project.duration)
        : null,
    [hasMusic, peaks, edit.audio.duck, voiceKey, project.duration]
  )
  const duckRef = useRef(duck)
  duckRef.current = duck
  const rateRef = useRef(rate)
  rateRef.current = rate
  const mutedRef = useRef(!!muted)
  mutedRef.current = !!muted
  useEffect(() => {
    sounds.current = new SoundPlayer(project.id)
    return () => {
      sounds.current?.close()
      sounds.current = null
    }
  }, [project.id])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screenRef = useRef<HTMLVideoElement>(null)
  const camRef = useRef<HTMLVideoElement>(null)
  const sceneRef = useRef(scene)
  const editRef = useRef(edit)
  const cbRef = useRef({ onTime, onPlaying })
  const [box, setBox] = useState({ w: 800, h: 450 })
  const dirty = useRef(true)
  const segRef = useRef<PersonSegmenter | null>(null)
  const needCutout = usesCutout(edit) && !!project.files.camera
  const statusRef = useRef(onCutoutStatus)
  statusRef.current = onCutoutStatus

  // load the person segmenter only when a cutout layout is used
  useEffect(() => {
    if (!needCutout || segRef.current) return
    let alive = true
    statusRef.current?.('loading')
    PersonSegmenter.create()
      .then((s) => {
        if (!alive) return s.close()
        segRef.current = s
        dirty.current = true
        statusRef.current?.('ready')
      })
      .catch((err) => statusRef.current?.('error', err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [needCutout])
  useEffect(
    () => () => {
      segRef.current?.close()
      segRef.current = null
    },
    []
  )
  sceneRef.current = scene
  editRef.current = edit
  cbRef.current = { onTime, onPlaying }

  // redraw when the scene changes; while paused we otherwise skip rendering entirely
  useEffect(() => {
    dirty.current = true
  }, [scene])

  useEffect(() => {
    const mark = (): void => {
      dirty.current = true
    }
    const vids = [screenRef.current, camRef.current].filter((v): v is HTMLVideoElement => !!v)
    const evs = ['seeked', 'loadeddata', 'canplay'] as const
    vids.forEach((v) => evs.forEach((ev) => v.addEventListener(ev, mark)))
    return () => vids.forEach((v) => evs.forEach((ev) => v.removeEventListener(ev, mark)))
  }, [])

  useImperativeHandle(ref, () => ({
    play() {
      const v = screenRef.current
      if (!v) return
      const clips = editRef.current.clips
      const at = nextPlayable(v.currentTime, clips)
      if (at === null || v.currentTime >= lastEnd(clips) - 0.05) v.currentTime = firstStart(clips)
      else if (at !== v.currentTime) v.currentTime = at
      void v.play()
    },
    pause() {
      screenRef.current?.pause()
    },
    toggle() {
      const v = screenRef.current
      if (!v) return
      if (v.paused) this.play()
      else v.pause()
    },
    seek(t: number) {
      const v = screenRef.current
      if (v) v.currentTime = Math.max(0, Math.min(t, project.duration))
    },
    get time() {
      return screenRef.current?.currentTime ?? 0
    },
    get playing() {
      return !!screenRef.current && !screenRef.current.paused
    },
    canvas() {
      return canvasRef.current
    }
  }))

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // audio + rate follow the edit
  useEffect(() => {
    const v = screenRef.current
    if (!v) return
    v.volume = Math.min(1, edit.audio.volume)
    // sped-up clips sound sped up (like the export), rather than time-stretched
    ;(v as HTMLVideoElement & { preservesPitch: boolean }).preservesPitch = false
  }, [edit.audio.volume])
  // playback rate and mute follow the clip under the playhead (see the render loop)

  const cs = contentSize(project.source)
  const out = outputSize(edit.aspect, cs.w, cs.h, 1080)
  const ratio = out.w / out.h
  let cssW = box.w
  let cssH = box.w / ratio
  if (cssH > box.h) {
    cssH = box.h
    cssW = box.h * ratio
  }
  const dpr = window.devicePixelRatio || 1
  const pxW = Math.max(2, Math.round(Math.min(out.w * 2, cssW * dpr) * quality))
  const pxH = Math.max(2, Math.round(Math.min(out.h * 2, cssH * dpr) * quality))

  useEffect(() => {
    let raf = 0
    let lastReport = 0
    let wasPlaying = false
    let lastT = -1
    let lastW = 0
    let lastH = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const c = canvasRef.current
      const v = screenRef.current
      if (!c || !v) return
      const ctx = c.getContext('2d', { alpha: false })
      if (!ctx) return
      const ed = editRef.current
      const t = v.currentTime
      if (!v.paused) {
        // skip cut gaps; stop at the end of the last clip
        const next = nextPlayable(t + 1 / 240, ed.clips)
        if (next === null) {
          v.pause()
          v.currentTime = lastEnd(ed.clips)
        } else if (next > t + 1 / 120) {
          v.currentTime = next
        }
      }

      // clip speed / mute
      const clip = clipAt(t, ed.clips)
      const want = rateRef.current * (clip ? speedOf(clip) : 1)
      if (Math.abs(v.playbackRate - want) > 1e-3) v.playbackRate = want
      if (camRef.current && Math.abs(camRef.current.playbackRate - want) > 1e-3) camRef.current.playbackRate = want
      const mute = ed.audio.muted || !!clip?.mute || mutedRef.current
      if (v.muted !== mute) v.muted = mute

      sounds.current?.update(
        t,
        !v.paused && !v.seeking,
        mutedRef.current ? [] : ed.sounds,
        ed.clips,
        rateRef.current,
        duckRef.current
      )

      const cam = camRef.current
      const sizeChanged = c.width !== lastW || c.height !== lastH
      if (v.paused && !dirty.current && !sizeChanged && t === lastT && !v.seeking) {
        if (wasPlaying) {
          wasPlaying = false
          cbRef.current.onPlaying(false)
        }
        return
      }
      dirty.current = false
      lastT = t
      lastW = c.width
      lastH = c.height
      if (cam && cam.readyState >= 1) {
        const target = t - project.cameraOffset
        if (Math.abs(cam.currentTime - target) > (v.paused ? 0.03 : 0.2)) cam.currentTime = Math.max(0, target)
        if (v.paused && !cam.paused) cam.pause()
        if (!v.paused && cam.paused && target >= 0) void cam.play().catch(() => undefined)
      }

      let cameraMask: Mask | null = null
      if (segRef.current && cam && cam.readyState >= 2) {
        const lt = layoutAt(t, ed)
        if (lt.from === 'cutout' || lt.to === 'cutout')
          cameraMask = segRef.current.mask(cam, cam.videoWidth, cam.videoHeight, now)
      }
      renderFrame(ctx, c.width, c.height, sceneRef.current, {
        t,
        cameraMask,
        shutter: 1 / 120,
        screen: v.readyState >= 2 ? v : null,
        screenSize: { w: v.videoWidth, h: v.videoHeight },
        camera: cam && cam.readyState >= 2 ? cam : null,
        cameraSize: cam ? { w: cam.videoWidth, h: cam.videoHeight } : undefined
      })

      const playing = !v.paused
      if (playing !== wasPlaying) {
        wasPlaying = playing
        cbRef.current.onPlaying(playing)
      }
      if (now - lastReport > 33) {
        lastReport = now
        cbRef.current.onTime(t)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [project.cameraOffset])

  return (
    <div ref={wrapRef} className="flex size-full items-center justify-center">
      <div className="relative shrink-0" style={{ width: cssW, height: cssH }}>
        <canvas
          ref={canvasRef}
          width={pxW}
          height={pxH}
          style={{ width: cssW, height: cssH }}
          className="block rounded-md bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.06]"
        />
        {overlay?.(cssW, cssH)}
      </div>
      <video
        ref={screenRef}
        src={mediaUrl(project.id, project.files.screen)}
        preload="auto"
        playsInline
        style={HIDDEN}
      />
      {project.files.camera && (
        <video
          ref={camRef}
          src={mediaUrl(project.id, project.files.camera)}
          preload="auto"
          playsInline
          muted
          style={HIDDEN}
        />
      )}
    </div>
  )
})
