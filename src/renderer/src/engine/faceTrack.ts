import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import { api, mediaUrl } from '@renderer/lib/api'
import { Faces } from './faces'

// Face tracking: find your face in the camera video so the camera crop can keep it centred as you
// move. Analysed once (on-device) and saved with the project as face-track.json.

import { FPS, smoothTrack, type FaceTrack } from './faceMath'
export { faceAt, smoothTrack, type FaceTrack } from './faceMath'

export async function analyseCamera(opts: {
  projectId: string
  cameraFile: string
  signal: AbortSignal
  onProgress: (p: number) => void
}): Promise<FaceTrack> {
  const faces = await Faces.create('VIDEO', 0.5)
  const input = new Input({ source: new UrlSource(mediaUrl(opts.projectId, opts.cameraFile)), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No camera video')
    const duration = await track.computeDuration()
    const times: number[] = []
    for (let t = 0; t < duration; t += 1 / FPS) times.push(t)
    const w = 320
    const h = Math.max(2, Math.round((w * track.displayHeight) / track.displayWidth))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    const raw: ([number, number, number, number] | [number, null, null, null])[] = []
    let i = 0
    for await (const sample of new VideoSampleSink(track).samplesAtTimestamps(times)) {
      if (opts.signal.aborted) {
        sample?.close()
        throw new DOMException('Cancelled', 'AbortError')
      }
      const t = times[i++]
      if (!sample) {
        raw.push([t, null, null, null])
        continue
      }
      ctx.drawImage(sample.toCanvasImageSource(), 0, 0, w, h)
      sample.close()
      // the biggest face is you
      const found = faces.detect(canvas, t * 1000).sort((a, b) => b.w * b.h - a.w * a.h)[0]
      raw.push(found ? [t, found.x + found.w / 2, found.y + found.h / 2, found.h] : [t, null, null, null])
      if (i % 10 === 0) opts.onProgress(t / duration)
    }
    if (!raw.some((r) => r[1] !== null)) throw new Error('No face found in the camera video.')
    return { version: 1, samples: smoothTrack(raw) }
  } finally {
    input.dispose()
    faces.close()
  }
}

export async function loadFaceTrack(projectId: string): Promise<FaceTrack | null> {
  try {
    const res = await fetch(mediaUrl(projectId, 'face-track.json', Date.now()))
    if (!res.ok) return null
    const t = (await res.json()) as FaceTrack
    return Array.isArray(t.samples) ? t : null
  } catch {
    return null
  }
}

export async function saveFaceTrack(projectId: string, t: FaceTrack): Promise<void> {
  const handle = await api.file.open({ projectId, name: 'face-track.json' })
  try {
    await api.file.write(handle, 0, new TextEncoder().encode(JSON.stringify(t)))
  } finally {
    await api.file.close(handle)
  }
}
