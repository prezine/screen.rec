import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny'
import type { Transcript, Word } from '@shared/transcript'
import { api, mediaUrl } from '@renderer/lib/api'
import type { WorkerIn, WorkerOut } from './transcribe.worker'

export const RATE = 16000

export const WHISPER_MODELS = {
  fast: { id: 'onnx-community/whisper-tiny_timestamped', label: 'Fast', size: '≈45 MB' },
  accurate: { id: 'onnx-community/whisper-base_timestamped', label: 'Accurate', size: '≈90 MB' }
} as const

/** Decode the recording's audio as 16 kHz mono (streaming box-filter decimation). */
export async function extractAudio16k(
  url: string,
  duration: number,
  onProgress?: (p: number) => void
): Promise<Float32Array | null> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const srcRate = track.sampleRate
    const ratio = srcRate / RATE
    const out = new Float32Array(Math.ceil(duration * RATE) + RATE)
    let o = 0 // next output index
    let gi = 0 // global source sample index
    let sum = 0
    let count = 0
    let next = Math.floor(ratio)
    const push = (x: number): void => {
      sum += x
      count++
      gi++
      if (gi >= next) {
        if (o < out.length) out[o++] = sum / count
        sum = 0
        count = 0
        next = Math.floor((o + 1) * ratio)
      }
    }
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const startIdx = Math.round(timestamp * srcRate)
      while (gi < startIdx) push(0) // fill gaps with silence
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
      const n = buffer.length
      const inv = 1 / chans.length
      for (let k = 0; k < n; k++) {
        let v = 0
        for (const ch of chans) v += ch[k]
        push(v * inv)
      }
      onProgress?.(Math.min(1, timestamp / Math.max(duration, 0.001)))
    }
    return out.subarray(0, o)
  } finally {
    input.dispose()
  }
}

/** ≤30 s windows, cut at the quietest moment near the end of each window; silent windows are skipped. */
export function speechWindows(audio: Float32Array): [number, number][] {
  const frame = Math.round(RATE * 0.02)
  const n = Math.floor(audio.length / frame)
  const rms = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * frame; i < (f + 1) * frame; i++) s += audio[i] * audio[i]
    rms[f] = Math.sqrt(s / frame)
  }
  const max = 30 * RATE
  const out: [number, number][] = []
  let cur = 0
  while (cur < audio.length) {
    let end = audio.length
    if (audio.length - cur > max) {
      const lo = Math.floor((cur + 22 * RATE) / frame)
      const hi = Math.floor((cur + 29.5 * RATE) / frame)
      let best = hi
      for (let f = lo; f <= hi && f < n; f++) if (rms[f] < rms[best]) best = f
      end = best * frame
    }
    // skip near-silent windows
    let peak = 0
    for (let f = Math.floor(cur / frame); f < Math.floor(end / frame); f++) peak = Math.max(peak, rms[f])
    if (peak > 0.006) out.push([cur, end])
    cur = end
  }
  return out
}

export interface TranscribeProgress {
  stage: 'audio' | 'download' | 'transcribe'
  /** 0..1 */
  progress: number
  detail?: string
}

export interface TranscribeJob {
  promise: Promise<Word[]>
  cancel: () => void
  /** words appear as each window finishes */
  onWords?: (w: Word[]) => void
}

export function startTranscription(
  projectId: string,
  screenFile: string,
  duration: number,
  opts: { model: keyof typeof WHISPER_MODELS; language: string },
  onProgress: (p: TranscribeProgress) => void,
  onWords: (w: Word[]) => void
): TranscribeJob {
  let worker: Worker | null = null
  let cancelled = false
  const promise = (async () => {
    onProgress({ stage: 'audio', progress: 0 })
    const audio = await extractAudio16k(mediaUrl(projectId, screenFile), duration, (p) =>
      onProgress({ stage: 'audio', progress: p })
    )
    if (cancelled) throw new DOMException('Cancelled', 'AbortError')
    if (!audio) throw new Error('This recording has no audio to transcribe.')
    const windows = speechWindows(audio)
    if (!windows.length) return []
    worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
    return new Promise<Word[]>((resolve, reject) => {
      worker!.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data
        if (m.type === 'download')
          onProgress({
            stage: 'download',
            progress: m.total ? m.loaded / m.total : 0,
            detail: `${(m.loaded / 1e6).toFixed(0)} / ${(m.total / 1e6).toFixed(0)} MB`
          })
        else if (m.type === 'progress') onProgress({ stage: 'transcribe', progress: m.total ? m.done / m.total : 1 })
        else if (m.type === 'words') onWords(m.words)
        else if (m.type === 'done') resolve(m.words)
        else if (m.type === 'error') reject(new Error(friendly(m.message)))
      }
      worker!.onerror = (e) => reject(new Error(e.message || 'Transcription failed'))
      const msg: WorkerIn = {
        type: 'run',
        audio,
        windows,
        model: WHISPER_MODELS[opts.model].id,
        language: opts.language
      }
      worker!.postMessage(msg, [audio.buffer])
    }).finally(() => {
      worker?.terminate()
      worker = null
    })
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      worker?.terminate()
    }
  }
}

function friendly(msg: string): string {
  if (/fetch|network|Failed to load|ENOTFOUND|offline/i.test(msg)) {
    return 'The speech model needs to download once. Connect to the internet and try again — after that, transcription works offline.'
  }
  return msg
}

// ---- persistence (transcript.json in the project folder) ----

export async function loadTranscript(projectId: string): Promise<Transcript | null> {
  try {
    const res = await fetch(mediaUrl(projectId, 'transcript.json', Date.now()))
    if (!res.ok) return null
    const t = (await res.json()) as Transcript
    return Array.isArray(t.words) ? t : null
  } catch {
    return null
  }
}

export async function saveTranscript(projectId: string, t: Transcript): Promise<void> {
  const handle = await api.file.open({ projectId, name: 'transcript.json' })
  try {
    await api.file.write(handle, 0, new TextEncoder().encode(JSON.stringify(t)))
  } finally {
    await api.file.close(handle)
  }
}
