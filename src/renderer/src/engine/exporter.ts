import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  UrlSource,
  VideoSampleSink,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type InputAudioTrack,
  type VideoCodec,
  type VideoSample
} from 'mediabunny'
import type { CursorData, EditState, ExportSettings, ProjectMeta } from '@shared/types'
import { api, mediaUrl } from '@renderer/lib/api'
import { ipcWritable } from '@renderer/lib/ipcWritable'
import { outputSize, renderFrame } from './compositor'
import { drawWatermark } from './overlays'
import { framePlan, speedOf, type Clip } from '@shared/clips'
import { layoutAt, usesCamera, usesCutout } from './layout'
import { PersonSegmenter, type Mask } from './segment'
import { SceneBuilder } from './scene'
import { duckCurve, loadSounds, renderSoundsChunk } from './sounds'
import { computePeaks } from './waveform'
import type { SoundItem } from '@shared/types'

export interface ExportJob {
  project: ProjectMeta
  edit: EditState
  cursor: CursorData
  words?: import('@shared/transcript').Word[]
  faceTrack?: import('./faceTrack').FaceTrack | null
  settings: ExportSettings
  /** Free plan: stamp "Made with Toom" in the corner */
  watermark?: boolean
  token: string
  onProgress: (p: number, info: string) => void
  signal: AbortSignal
}

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, 'very-high': QUALITY_VERY_HIGH }

async function pickVideoCodec(w: number, h: number, fps: number): Promise<VideoCodec> {
  for (const c of ['avc', 'hevc', 'vp9', 'av1'] as VideoCodec[]) {
    if (await canEncodeVideo(c, { width: w, height: h, frameRate: fps })) return c
  }
  throw new Error('No supported video encoder found on this machine')
}

async function pickAudioCodec(channels: number, sampleRate: number): Promise<AudioCodec | null> {
  for (const c of ['aac', 'opus'] as AudioCodec[]) {
    if (await canEncodeAudio(c, { numberOfChannels: channels, sampleRate })) return c
  }
  return null
}

/** Copy part of an AudioBuffer (from `offset` seconds, `length` seconds). */
function sliceAudio(buf: AudioBuffer, offset: number, length: number): AudioBuffer | null {
  const from = Math.max(0, Math.round(offset * buf.sampleRate))
  const to = Math.min(buf.length, from + Math.round(length * buf.sampleRate))
  if (to <= from) return null
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: to - from, sampleRate: buf.sampleRate })
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, to), c)
  return out
}

function silence(seconds: number, sampleRate: number, channels: number): AudioBuffer {
  return new AudioBuffer({
    numberOfChannels: channels,
    length: Math.max(1, Math.round(seconds * sampleRate)),
    sampleRate
  })
}

/**
 * Audio for the kept clips, back to back. Each clip contributes exactly frames/fps seconds
 * (padded with silence if the recording has gaps), so audio stays in sync with the video.
 */
async function* audioPieces(
  track: InputAudioTrack,
  plan: { clip: Clip; frames: number }[],
  fps: number,
  gain: number
): AsyncGenerator<AudioBuffer> {
  const rate = track.sampleRate
  const ch = track.numberOfChannels
  for (const { clip, frames } of plan) {
    const len = frames / fps
    const speed = speedOf(clip)
    if (clip.mute) {
      yield silence(len, rate, ch)
      continue
    }
    if (speed !== 1) {
      yield* spedUpAudio(track, clip, len, speed, gain)
      continue
    }
    let written = 0
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(clip.start, clip.start + len)) {
      const expected = clip.start + written
      if (timestamp > expected + 0.002) {
        const gap = Math.min(timestamp - expected, len - written)
        yield silence(gap, rate, ch)
        written += gap
      }
      const offset = Math.max(0, clip.start + written - timestamp)
      const piece = sliceAudio(buffer, offset, Math.min(buffer.duration - offset, len - written))
      if (piece) {
        if (gain !== 1) {
          for (let c = 0; c < piece.numberOfChannels; c++) {
            const d = piece.getChannelData(c)
            for (let k = 0; k < d.length; k++) d[k] = Math.max(-1, Math.min(1, d[k] * gain))
          }
        }
        yield piece
        written += piece.duration
      }
      if (written >= len - 1e-4) break
    }
    if (len - written > 0.001) yield silence(len - written, rate, ch)
  }
}

/** Silence for every kept clip (used when the recording itself contributes no audio). */
function* silencePieces(
  plan: { frames: number }[],
  fps: number,
  rate: number,
  channels: number
): Generator<AudioBuffer> {
  for (const { frames } of plan) {
    let left = frames / fps
    while (left > 1e-4) {
      const d = Math.min(1, left)
      yield silence(d, rate, channels)
      left -= d
    }
  }
}

/**
 * Mix music and sound effects into the recording's audio. Pieces arrive in output order; the added
 * sounds are rendered in 20 s chunks of output time and summed in, upmixing mono voice to stereo.
 */
async function* mixSounds(
  base: AsyncIterable<AudioBuffer> | Iterable<AudioBuffer>,
  items: SoundItem[],
  buffers: Map<string, AudioBuffer>,
  clips: Clip[],
  rate: number,
  duck: Float32Array | null
): AsyncGenerator<AudioBuffer> {
  const CHUNK = 20
  const chunkLen = CHUNK * rate
  const cache = new Map<number, AudioBuffer>()
  const chunk = async (i: number): Promise<AudioBuffer> => {
    let c = cache.get(i)
    if (!c) {
      c = await renderSoundsChunk(items, buffers, clips, i * CHUNK, CHUNK, rate, duck)
      cache.set(i, c)
      for (const k of cache.keys()) if (k < i - 1) cache.delete(k)
    }
    return c
  }
  let pos = 0 // output sample index
  for await (const piece of base) {
    const n = piece.length
    const out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate })
    for (let ch = 0; ch < 2; ch++) {
      const dst = out.getChannelData(ch)
      dst.set(piece.getChannelData(Math.min(ch, piece.numberOfChannels - 1)))
      let j = 0
      while (j < n) {
        const g = pos + j
        const ci = Math.floor(g / chunkLen)
        const c = await chunk(ci)
        const src = c.getChannelData(ch)
        const off = g - ci * chunkLen
        const take = Math.min(n - j, chunkLen - off)
        for (let k = 0; k < take; k++) {
          const v = dst[j + k] + (src[off + k] ?? 0)
          dst[j + k] = v > 1 ? 1 : v < -1 ? -1 : v
        }
        j += take
      }
    }
    pos += n
    yield out
  }
}

/**
 * A sped-up clip's audio: read `len × speed` seconds of the recording and play it `speed` times
 * faster (resampled, so the pitch rises — like fast-forwarding a tape). Exactly `len` seconds out.
 */
async function* spedUpAudio(
  track: InputAudioTrack,
  clip: Clip,
  len: number,
  speed: number,
  gain: number
): AsyncGenerator<AudioBuffer> {
  const rate = track.sampleRate
  const ch = track.numberOfChannels
  const want = Math.round(len * rate)
  let produced = 0
  let carry = 0 // fractional read position carried between buffers
  for await (const { buffer } of new AudioBufferSink(track).buffers(clip.start, clip.end)) {
    const n = buffer.length
    const outN = Math.min(want - produced, Math.floor((n - carry) / speed))
    if (outN <= 0) continue
    const out = new AudioBuffer({ numberOfChannels: ch, length: outN, sampleRate: rate })
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1))
      const dst = out.getChannelData(c)
      for (let i = 0; i < outN; i++) {
        const p = carry + i * speed
        const i0 = Math.floor(p)
        const f = p - i0
        const v = (src[i0] ?? 0) * (1 - f) + (src[i0 + 1] ?? src[i0] ?? 0) * f
        dst[i] = Math.max(-1, Math.min(1, v * gain))
      }
    }
    carry = carry + outN * speed - n
    if (carry < 0) carry = 0
    produced += outN
    yield out
    if (produced >= want) break
  }
  if (want - produced > 0) yield silence((want - produced) / rate, rate, ch)
}

async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url)
    return await createImageBitmap(await res.blob())
  } catch {
    return null
  }
}

export async function exportVideo(job: ExportJob): Promise<void> {
  const { project, edit, settings, signal } = job
  const fps = settings.fps
  const plan = framePlan(edit.clips.length ? edit.clips : [{ id: 'all', start: 0, end: project.duration }], fps)
  const frameCount = plan.reduce((n, p) => n + p.frames, 0)

  const screenInput = new Input({
    source: new UrlSource(mediaUrl(project.id, project.files.screen)),
    formats: ALL_FORMATS
  })
  const cameraInput =
    project.files.camera && usesCamera(edit)
      ? new Input({ source: new UrlSource(mediaUrl(project.id, project.files.camera)), formats: ALL_FORMATS })
      : null
  const handle = await api.file.open({ token: job.token })
  let output: Output | null = null
  // released in `finally`, also when the export fails or is cancelled (decoders hold GPU frames)
  const held: { release: () => unknown }[] = []
  let ok = false

  try {
    const screenTrack = await screenInput.getPrimaryVideoTrack()
    if (!screenTrack) throw new Error('Recording has no video track')
    const frameW = screenTrack.displayWidth
    const frameH = screenTrack.displayHeight
    const crop = project.source.crop
    const srcW = crop ? frameW * crop.w : frameW
    const srcH = crop ? frameH * crop.h : frameH
    const camTrack = cameraInput ? await cameraInput.getPrimaryVideoTrack() : null
    const audioTrack = edit.audio.muted || edit.audio.volume <= 0 ? null : await screenInput.getPrimaryAudioTrack()

    const { w: W, h: H } = outputSize(edit.aspect, srcW, srcH, settings.resolution)
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Could not create a 2D canvas')

    const videoCodec = await pickVideoCodec(W, H, fps)
    // music and sound effects you added
    const sounds = edit.sounds ?? []
    const soundBuffers = sounds.length ? await loadSounds(project.id, sounds) : null
    const withSounds = !!soundBuffers && soundBuffers.size > 0
    const audioRate = audioTrack?.sampleRate ?? 48000
    const audioChannels = withSounds ? 2 : (audioTrack?.numberOfChannels ?? 2)
    const audioCodec = audioTrack || withSounds ? await pickAudioCodec(audioChannels, audioRate) : null

    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(ipcWritable(handle), { chunked: true, chunkSize: 8 * 1024 * 1024 })
    })
    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: QUALITY[settings.quality],
      keyFrameInterval: 2
    })
    output.addVideoTrack(videoSource, { frameRate: fps })
    const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null
    if (audioSource) output.addAudioTrack(audioSource)
    await output.start()

    // scene
    let bg: ImageBitmap | null = null
    held.push({ release: () => bg?.close() })
    if (edit.background.kind === 'image') bg = await loadImage(mediaUrl(project.id, edit.background.value))
    const scene = new SceneBuilder(job.cursor, project.duration, !!project.files.camera)
      .setWords(job.words ?? [])
      .setFaceTrack(job.faceTrack ?? null, project.cameraOffset)
      .build(edit, srcW, srcH, bg ? { source: bg, w: bg.width, h: bg.height, key: edit.background.value } : null, crop)

    // audio pump, interleaved with video so the muxer never has to buffer much
    const gain = edit.audio.volume
    let audioIter: AsyncIterator<AudioBuffer> | null = null
    if (audioSource) {
      const base = audioTrack ? audioPieces(audioTrack, plan, fps, gain) : silencePieces(plan, fps, audioRate, 2)
      if (withSounds) {
        const music = sounds.some((x) => x.kind === 'music')
        const peaks =
          music && edit.audio.duck > 0 && audioTrack
            ? await computePeaks(mediaUrl(project.id, project.files.screen), project.duration).catch(() => null)
            : null
        const clips = edit.clips.length ? edit.clips : [{ id: 'all', start: 0, end: project.duration }]
        const voice = sounds.filter((x) => x.kind === 'voice').map((x) => [x.start, x.end] as [number, number])
        audioIter = mixSounds(
          base,
          sounds,
          soundBuffers!,
          clips,
          audioRate,
          duckCurve(peaks, edit.audio.duck, 30, voice, project.duration)
        )
      } else audioIter = base as AsyncIterator<AudioBuffer>
    }
    let audioWritten = 0 // seconds of output audio
    let audioDone = !audioIter
    const pumpAudio = async (untilOutputTime: number): Promise<void> => {
      while (audioIter && !audioDone && audioWritten < untilOutputTime) {
        const next = await audioIter.next()
        if (next.done) {
          audioDone = true
          break
        }
        await audioSource!.add(next.value)
        audioWritten += next.value.duration
      }
    }

    // source timestamps of every output frame, clip after clip
    const frameTimes: number[] = []
    for (const { clip, frames } of plan)
      for (let k = 0; k < frames; k++) frameTimes.push(clip.start + (k * speedOf(clip)) / fps)
    function* times(offset: number): Generator<number> {
      for (const t of frameTimes) yield Math.max(0, t - offset)
    }
    const screenFrames = new VideoSampleSink(screenTrack).samplesAtTimestamps(times(0))
    const camFrames = camTrack ? new VideoSampleSink(camTrack).samplesAtTimestamps(times(project.cameraOffset)) : null
    held.push({ release: () => screenFrames.return(undefined) })
    if (camFrames) held.push({ release: () => camFrames.return(undefined) })
    const camSize = camTrack ? { w: camTrack.displayWidth, h: camTrack.displayHeight } : undefined

    const segmenter = camTrack && usesCutout(edit) ? await PersonSegmenter.create() : null
    if (segmenter) held.push({ release: () => segmenter.close() })

    const t0 = performance.now()
    for (let i = 0; i < frameCount; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const s = await screenFrames.next()
      const c = camFrames ? await camFrames.next() : null
      const screenSample: VideoSample | null = s.done ? null : s.value
      const camSample: VideoSample | null = c && !c.done ? c.value : null
      const t = frameTimes[i]
      const camSrc = camSample ? camSample.toCanvasImageSource() : null
      let cameraMask: Mask | null = null
      if (segmenter && camSrc && camSize) {
        const lt = layoutAt(t, edit)
        if (lt.from === 'cutout' || lt.to === 'cutout')
          cameraMask = segmenter.mask(camSrc, camSize.w, camSize.h, (i * 1000) / fps)
      }
      renderFrame(ctx, W, H, scene, {
        t,
        cameraMask,
        shutter: 1 / fps / 2,
        screen: screenSample ? screenSample.toCanvasImageSource() : null,
        screenSize: { w: frameW, h: frameH },
        camera: camSrc,
        cameraSize: camSize
      })
      if (job.watermark) drawWatermark(ctx, W, H)
      screenSample?.close()
      camSample?.close()
      await videoSource.add(i / fps, 1 / fps)
      await pumpAudio(i / fps + 0.5)

      if (i % 10 === 0) {
        const elapsed = (performance.now() - t0) / 1000
        const rate = (i + 1) / Math.max(elapsed, 0.001)
        const eta = (frameCount - i - 1) / rate
        job.onProgress(i / frameCount, `${Math.round(rate)} fps · ~${Math.ceil(eta)}s left`)
      }
    }
    await pumpAudio(Infinity)
    job.onProgress(1, 'Finalising…')
    await output.finalize()
    ok = true
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled')
      await output.cancel().catch(() => undefined)
    throw err
  } finally {
    for (const h of held.reverse()) await Promise.resolve(h.release()).catch(() => undefined)
    await api.file.close(handle, !ok)
    screenInput.dispose()
    cameraInput?.dispose()
  }
}
