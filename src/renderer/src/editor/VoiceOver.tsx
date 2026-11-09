import { useEffect, useRef, useState } from 'react'
import type { EditState, ProjectMeta, SoundItem } from '@shared/types'
import { toOutput, toSource } from '@shared/clips'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/lib/settings'
import { Mic, Square } from '@renderer/lib/icons'
import { ToggleRow, cx } from '@renderer/lib/ui'
import { formatTime, uid } from '@renderer/engine/math'
import { deviceLabel, useMediaDevices } from '@renderer/launcher/media'
import type { Update } from './SidePanel'

export interface PlayerControl {
  play(): void
  pause(): void
  readonly time: number
  readonly playing: boolean
}

type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

/**
 * Record narration over the edit: the preview plays from the playhead while your mic records.
 * The take is saved into the project and laid on the Voice lane, lined up with what you watched.
 */
export function VoiceOver({
  project,
  edit,
  update,
  player,
  onPreviewMuted,
  onAdded
}: {
  project: ProjectMeta
  edit: EditState
  update: Update
  player: () => PlayerControl | null
  /** silence the preview (and added sounds) while recording, so speakers don't bleed into the mic */
  onPreviewMuted: (m: boolean) => void
  onAdded: (id: string) => void
}): React.JSX.Element {
  const { settings, set } = useSettings()
  const { mics, unlock } = useMediaDevices()
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [muteWhile, setMuteWhile] = useState(true)
  const level = useRef<HTMLDivElement>(null)
  const session = useRef<{
    stream: MediaStream
    rec: MediaRecorder
    chunks: Blob[]
    start: number
    wall: number
    ctx: AudioContext
    raf: number
    timer: number
  } | null>(null)
  const micId =
    settings?.devices.microphoneId && settings.devices.microphoneId !== 'default'
      ? settings.devices.microphoneId
      : undefined

  useEffect(() => {
    void unlock('audio')
  }, [unlock])
  useEffect(() => () => cleanup(), []) // eslint-disable-line react-hooks/exhaustive-deps

  function cleanup(): void {
    const s = session.current
    if (!s) return
    cancelAnimationFrame(s.raf)
    clearInterval(s.timer)
    s.stream.getTracks().forEach((t) => t.stop())
    void s.ctx.close()
    session.current = null
    onPreviewMuted(false)
  }

  const start = async (): Promise<void> => {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micId ? { exact: micId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
    } catch {
      setError('Couldn’t open the microphone. Check that Toom is allowed to use it in System Settings → Privacy.')
      return
    }
    const mime =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 160_000 } : undefined)
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    const meter = (): void => {
      an.getFloatTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
      if (level.current) level.current.style.width = `${Math.min(100, Math.sqrt(peak) * 120)}%`
      if (session.current) session.current.raf = requestAnimationFrame(meter)
    }
    session.current = { stream, rec, chunks: [], start: 0, wall: 0, ctx, raf: requestAnimationFrame(meter), timer: 0 }
    rec.ondataavailable = (e) => e.data.size && session.current?.chunks.push(e.data)

    // 3-2-1, then roll the preview and start recording together
    setPhase('countdown')
    for (let n = 3; n > 0; n--) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 800))
      if (!session.current) return
    }
    const p = player()
    if (!p) return cleanup()
    if (muteWhile) onPreviewMuted(true)
    session.current.start = p.time
    rec.start(250)
    session.current.wall = performance.now()
    p.play()
    setPhase('recording')
    setElapsed(0)
    session.current.timer = window.setInterval(() => {
      const s = session.current
      if (!s) return
      setElapsed((performance.now() - s.wall) / 1000)
      // stop by itself when the video reaches the end
      if (!player()?.playing && performance.now() - s.wall > 600) void stop()
    }, 200)
  }

  const stop = async (): Promise<void> => {
    const s = session.current
    if (!s || s.rec.state === 'inactive') return
    setPhase('saving')
    const seconds = (performance.now() - s.wall) / 1000
    player()?.pause()
    const done = new Promise<void>((r) => (s.rec.onstop = () => r()))
    s.rec.stop()
    await done
    const blob = new Blob(s.chunks, { type: s.rec.mimeType || 'audio/webm' })
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
    cleanup()
    try {
      const n = edit.sounds.filter((x) => x.kind === 'voice').length + 1
      const file = `vo-${uid('v')}.${ext}`
      const handle = await api.file.open({ projectId: project.id, name: file })
      try {
        await api.file.write(handle, 0, new Uint8Array(await blob.arrayBuffer()))
      } finally {
        await api.file.close(handle)
      }
      // the take lines up with output time (it ran across any cuts / speed changes you watched)
      const end = toSource(toOutput(s.start, edit.clips) + seconds, edit.clips)
      const item: SoundItem = {
        id: uid('s'),
        kind: 'voice',
        source: { type: 'file', file, name: `Voice-over ${n}` },
        start: s.start,
        end: Math.max(s.start + 0.2, Math.min(project.duration, end)),
        offset: 0,
        volume: 1,
        fadeIn: 0.05,
        fadeOut: 0.1,
        loop: false
      }
      update((e) => ({ ...e, sounds: [...e.sounds, item].sort((a, b) => a.start - b.start) }))
      onAdded(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setPhase('idle')
  }

  const cancel = (): void => {
    player()?.pause()
    session.current?.rec.state === 'recording' && session.current.rec.stop()
    cleanup()
    setPhase('idle')
  }

  const busy = phase !== 'idle'
  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/20">{error}</p>
      )}
      {!busy && (
        <>
          <select
            value={settings?.devices.microphoneId ?? 'default'}
            onChange={(e) => set({ devices: { microphoneId: e.target.value } })}
            className="mb-3 h-9 w-full rounded-full bg-black/25 px-3 text-[12.5px] ring-1 ring-white/10 outline-none"
          >
            <option value="default">System default microphone</option>
            {mics
              .filter((m) => m.deviceId !== 'default')
              .map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {deviceLabel(m, 'Microphone')}
                </option>
              ))}
          </select>
          <ToggleRow
            label="Silence the preview while I talk"
            on={muteWhile}
            onChange={setMuteWhile}
            hint="Keeps your speakers out of the mic. Turn off if you wear headphones and want to hear the recording."
          />
          <button
            onClick={() => void start()}
            className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-red-400 to-red-600 text-[13.5px] font-semibold text-[#fff] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_10px_24px_-10px_rgba(239,68,68,0.9)] hover:brightness-110"
          >
            <Mic size={16} /> Record from {formatTime(player()?.time ?? 0)}
          </button>
        </>
      )}
      {busy && (
        <div className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/[0.07]">
          {phase === 'countdown' && (
            <div className="flex items-center justify-between">
              <span key={count} className="countdown-pop text-[34px] leading-none font-semibold tabular-nums">
                {count}
              </span>
              <span className="text-[12.5px] text-ink-300">Get ready to talk…</span>
              <button onClick={cancel} className="h-8 rounded-full px-3 text-[12px] text-ink-300 hover:bg-white/10">
                Cancel
              </button>
            </div>
          )}
          {(phase === 'recording' || phase === 'saving') && (
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  'size-2.5 shrink-0 rounded-full bg-red-500',
                  phase === 'recording' && 'animate-pulse-dot'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[18px] leading-none font-semibold tabular-nums">{formatTime(elapsed)}</div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div ref={level} className="h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75" />
                </div>
              </div>
              <button
                onClick={() => void stop()}
                disabled={phase === 'saving'}
                title="Stop"
                className="grid size-10 place-items-center rounded-full bg-red-500 text-[#fff] hover:bg-red-400 disabled:opacity-50"
              >
                <Square size={14} fill="currentColor" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
