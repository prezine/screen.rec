// Browser-side harness: exercises remux + export with a mocked preload API.
import type { CursorData } from '@shared/types'
import { defaultEditState } from '@shared/defaults'

declare global {
  interface Window {
    runPipeline: () => Promise<unknown>
  }
}

const BASE = `${location.origin}/p`
;(globalThis as { __MEDIA_BASE__?: string }).__MEDIA_BASE__ = BASE

let nextHandle = 1
const handles = new Map<number, string>()
;(window as unknown as { api: unknown }).api = {
  file: {
    async open(t: { projectId: string; name: string } | { token: string }) {
      const name = 'token' in t ? `export-${t.token}.mp4` : t.name
      const id = nextHandle++
      handles.set(id, name)
      await fetch(`${BASE}/test/${name}?op=truncate`, { method: 'POST' })
      return id
    },
    async write(h: number, pos: number, data: Uint8Array) {
      await fetch(`${BASE}/test/${handles.get(h)}?op=write&pos=${pos}`, { method: 'POST', body: data })
    },
    async close(h: number) {
      handles.delete(h)
      return null
    }
  },
  projects: { removeFile: async () => undefined }
}

async function recordSynthetic(seconds: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 1280
  c.height = 800
  const ctx = c.getContext('2d')!
  const stream = c.captureStream(60)
  const ac = new AudioContext()
  const osc = ac.createOscillator()
  const dest = ac.createMediaStreamDestination()
  osc.connect(dest)
  osc.start()
  stream.addTrack(dest.stream.getAudioTracks()[0])
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 6e6 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const t0 = performance.now()
  let raf = 0
  const draw = (): void => {
    const t = (performance.now() - t0) / 1000
    ctx.fillStyle = '#f4f4f6'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#2f6bff'
    ctx.fillRect(100 + t * 200, 300, 200, 120)
    ctx.fillStyle = '#111'
    ctx.font = '48px sans-serif'
    ctx.fillText(`t=${t.toFixed(2)}`, 60, 100)
    raf = requestAnimationFrame(draw)
  }
  draw()
  rec.start(500)
  await new Promise((r) => setTimeout(r, seconds * 1000))
  await new Promise<void>((r) => {
    rec.onstop = () => r()
    rec.stop()
  })
  cancelAnimationFrame(raf)
  osc.stop()
  return new Blob(chunks, { type: 'video/webm' })
}

window.runPipeline = async () => {
  const { remuxToMp4, probe } = await import('@renderer/engine/convert')
  const { exportVideo } = await import('@renderer/engine/exporter')
  const { generateAutoZooms } = await import('@renderer/engine/autozoom')

  const webm = await recordSynthetic(3)
  await fetch(`${BASE}/test/screen.webm?op=put`, { method: 'POST', body: webm })
  await remuxToMp4('test', 'screen.webm', 'screen.mp4')
  const info = await probe(`${BASE}/test/screen.mp4`)

  const cursor: CursorData = {
    tracked: true,
    samples: Array.from({ length: 180 }, (_, i) => [i / 60, 0.2 + (i / 180) * 0.6, 0.45] as [number, number, number]),
    clicks: [{ t: 1.2, x: 0.45, y: 0.45, button: 'left' }]
  }
  const edit = defaultEditState(info.duration, false)
  edit.zooms = generateAutoZooms(cursor, info.duration)
  if (location.hash.includes('cut')) edit.clips = (await import('@shared/clips')).removeRange(edit.clips, 1, 2)
  edit.cursor.overlay = true
  if (location.hash.includes('speed'))
    edit.clips = (await import('@shared/clips')).setRangeSpeed(edit.clips, 1, 2, 4, false)
  if (location.hash.includes('sounds')) {
    // music under the whole video + a ding at 2.5 s (recording time)
    edit.audio.muted = true // so only the added sounds are measured
    edit.sounds = [
      {
        id: 'm',
        kind: 'music',
        source: { type: 'preset', id: 'ambient' },
        start: 0,
        end: info.duration,
        offset: 0,
        volume: 0.5,
        fadeIn: 0,
        fadeOut: 0,
        loop: true
      },
      {
        id: 'd',
        kind: 'sfx',
        source: { type: 'preset', id: 'ding' },
        start: 2.5,
        end: 3,
        offset: 0,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        loop: false
      }
    ]
  }
  const project = {
    id: 'test',
    name: 'test',
    createdAt: Date.now(),
    status: 'ready' as const,
    source: {
      kind: 'screen' as const,
      name: 't',
      width: info.width,
      height: info.height,
      crop: location.hash.includes('crop') ? { x: 0, y: 0, w: 0.5, h: 1 } : undefined
    },
    files: { screen: 'screen.mp4' },
    cameraOffset: 0,
    duration: info.duration
  }
  const log: string[] = []
  await exportVideo({
    project,
    edit,
    cursor,
    settings: { resolution: 720, fps: 30, quality: 'medium' },
    token: 'out',
    signal: new AbortController().signal,
    onProgress: (p, i) => log.push(`${p.toFixed(2)} ${i}`)
  })
  // measure the exported audio: loudness per 0.25 s
  const { ALL_FORMATS, AudioBufferSink, Input, UrlSource } = await import('mediabunny')
  const out = new Input({ source: new UrlSource(`${BASE}/test/export-out.mp4`), formats: ALL_FORMATS })
  const at = await out.getPrimaryAudioTrack()
  const rms: number[] = []
  let audio = null
  if (at) {
    const sums: number[] = []
    const counts: number[] = []
    for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers()) {
      const d = buffer.getChannelData(0)
      for (let i = 0; i < d.length; i += 4) {
        const b = Math.floor((timestamp + i / buffer.sampleRate) / 0.25)
        sums[b] = (sums[b] ?? 0) + d[i] * d[i]
        counts[b] = (counts[b] ?? 0) + 1
      }
    }
    for (let b = 0; b < sums.length; b++) rms.push(+Math.sqrt((sums[b] ?? 0) / (counts[b] || 1)).toFixed(3))
    audio = {
      channels: at.numberOfChannels,
      rate: at.sampleRate,
      duration: +(await at.computeDuration()).toFixed(3),
      rms
    }
  }
  const vt = await out.getPrimaryVideoTrack()
  const video = vt
    ? { duration: +(await vt.computeDuration()).toFixed(3), frames: (await vt.computePacketStats()).packetCount }
    : null
  out.dispose()
  return { info, zooms: edit.zooms.length, audio, video, log: log.slice(-1) }
}
