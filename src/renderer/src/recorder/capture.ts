import type { DisplayInfo, RecorderCommand, RecordingOptions } from '@shared/types'
import { api } from '@renderer/lib/api'

export interface CaptureDevices {
  cameraId?: string
  microphoneId?: string
  fps?: number
  bitrate?: number
  noiseSuppression?: boolean
  echoCancellation?: boolean
}

function pickMime(candidates: string[]): string {
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

const SCREEN_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm'
]
const SCREEN_MIMES_NO_AUDIO = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm;codecs=h264', 'video/webm']

async function getDeviceStream(opts: RecordingOptions, fps: number): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: opts.sourceId },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: fps }
    },
    audio: false
  })
}

async function getScreenStream(opts: RecordingOptions, displays: DisplayInfo[], fps: number): Promise<MediaStream> {
  if (opts.kind === 'device') return getDeviceStream(opts, fps)
  const display = displays.find((d) => d.id === opts.displayId)
  const maxW = display ? Math.round(display.bounds.width * display.scaleFactor) : 3840
  const maxH = display ? Math.round(display.bounds.height * display.scaleFactor) : 2400

  // Preferred path: getDisplayMedia, resolved by the main process to the source we picked.
  await api.selectCapture({ sourceId: opts.sourceId, audio: opts.systemAudio })
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps }, width: { ideal: maxW }, height: { ideal: maxH } },
      audio: opts.systemAudio
    })
  } catch (err) {
    console.warn('getDisplayMedia failed, falling back to chromeMediaSource', err)
  }
  // Fallback: legacy Chromium desktop capture constraints.
  const legacy = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: opts.sourceId,
        maxWidth: maxW,
        maxHeight: maxH,
        maxFrameRate: fps
      }
    }
  } as unknown as MediaStreamConstraints
  return navigator.mediaDevices.getUserMedia(legacy)
}

/**
 * Owns the MediaStreams and MediaRecorders for one recording.
 * Lives in the (hidden) launcher window; the main process drives it with commands.
 */
export class CaptureSession {
  private streams: MediaStream[] = []
  private screenRec: MediaRecorder | null = null
  private cameraRec: MediaRecorder | null = null
  private audioCtx: AudioContext | null = null
  private pending: Promise<void>[] = []
  private screenStream: MediaStream | null = null
  private cameraStream: MediaStream | null = null
  private unsubscribe: (() => void) | null = null
  private cancelled = false

  constructor(
    private opts: RecordingOptions,
    private devices: CaptureDevices
  ) {}

  /** Acquire all streams up-front so permission problems surface before the countdown. */
  async acquire(): Promise<void> {
    const displays = await api.listDisplays()
    const screen = await getScreenStream(this.opts, displays, this.devices.fps ?? 60)
    this.streams.push(screen)

    const audioTracks: MediaStreamTrack[] = [...screen.getAudioTracks()]
    if (this.opts.microphone) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.devices.microphoneId ? { exact: this.devices.microphoneId } : undefined,
          echoCancellation: this.devices.echoCancellation ?? true,
          noiseSuppression: this.devices.noiseSuppression ?? true,
          autoGainControl: true
        }
      })
      this.streams.push(mic)
      audioTracks.push(...mic.getAudioTracks())
    }

    let audioTrack: MediaStreamTrack | null = null
    if (audioTracks.length === 1) audioTrack = audioTracks[0]
    else if (audioTracks.length > 1) {
      // mix system audio + mic into one track
      this.audioCtx = new AudioContext({ sampleRate: 48000 })
      const dest = this.audioCtx.createMediaStreamDestination()
      for (const t of audioTracks) this.audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest)
      audioTrack = dest.stream.getAudioTracks()[0]
    }

    const video = screen.getVideoTracks()[0]
    this.screenStream = new MediaStream(audioTrack ? [video, audioTrack] : [video])

    if (this.opts.camera) {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.devices.cameraId ? { exact: this.devices.cameraId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      })
      this.streams.push(this.cameraStream)
    }

    // If the user stops sharing from the OS UI, finish the recording gracefully.
    video.addEventListener('ended', () => {
      if (this.screenRec && this.screenRec.state !== 'inactive') void api.toolbar.command('stop')
    })
  }

  /** Hand control to the main process (countdown, toolbar) and wait for commands. */
  async run(): Promise<void> {
    this.unsubscribe = api.rec.onCommand((cmd) => void this.handle(cmd))
    await api.rec.prepare(this.opts)
  }

  private async handle(cmd: RecorderCommand): Promise<void> {
    try {
      switch (cmd) {
        case 'begin':
          return await this.begin()
        case 'pause':
          this.screenRec?.pause()
          this.cameraRec?.pause()
          return
        case 'resume':
          this.screenRec?.resume()
          this.cameraRec?.resume()
          return
        case 'stop':
          return await this.finish(false)
        case 'cancel':
          return await this.finish(true)
      }
    } catch (err) {
      this.cleanup()
      await api.rec.failed(err instanceof Error ? err.message : String(err))
    }
  }

  private makeRecorder(
    stream: MediaStream,
    track: 'screen' | 'camera',
    mimes: string[],
    bitrate: number
  ): MediaRecorder {
    const mimeType = pickMime(mimes)
    const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bitrate })
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0 || this.cancelled) return
      const p = e.data.arrayBuffer().then((data) => api.rec.chunk({ track, data }))
      this.pending.push(p)
    }
    return rec
  }

  private started(rec: MediaRecorder): Promise<number> {
    return new Promise((resolve, reject) => {
      rec.onstart = () => resolve(Date.now())
      rec.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error('MediaRecorder error'))
    })
  }

  private async begin(): Promise<void> {
    const screen = this.screenStream!
    const hasAudio = screen.getAudioTracks().length > 0
    const settings = screen.getVideoTracks()[0].getSettings()
    this.screenRec = this.makeRecorder(
      screen,
      'screen',
      hasAudio ? SCREEN_MIMES : SCREEN_MIMES_NO_AUDIO,
      this.devices.bitrate ?? 16_000_000
    )
    const screenStarted = this.started(this.screenRec)
    let cameraStarted: Promise<number> | undefined
    if (this.cameraStream) {
      this.cameraRec = this.makeRecorder(this.cameraStream, 'camera', SCREEN_MIMES_NO_AUDIO, 5_000_000)
      cameraStarted = this.started(this.cameraRec)
    }
    // 1s timeslices: data is flushed to disk continuously, so a crash loses at most ~1s.
    this.screenRec.start(1000)
    this.cameraRec?.start(1000)
    const [screenStartedAt, cameraStartedAt] = await Promise.all([screenStarted, cameraStarted])
    await api.rec.started({
      screenStartedAt,
      cameraStartedAt,
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      screenMime: this.screenRec.mimeType,
      cameraMime: this.cameraRec?.mimeType
    })
  }

  private stopRecorder(rec: MediaRecorder | null): Promise<void> {
    if (!rec || rec.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      rec.onstop = () => resolve()
      rec.stop()
    })
  }

  private async finish(cancel: boolean): Promise<void> {
    this.cancelled = cancel
    await Promise.all([this.stopRecorder(this.screenRec), this.stopRecorder(this.cameraRec)])
    // ondataavailable fires before onstop; wait for the last chunk writes
    await Promise.all(this.pending)
    this.cleanup()
    if (cancel) await api.rec.cancelled()
    else await api.rec.finished()
  }

  cleanup(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop())
    this.streams = []
    void this.audioCtx?.close()
    this.audioCtx = null
  }
}
