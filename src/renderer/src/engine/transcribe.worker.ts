/// <reference lib="webworker" />
// Speech-to-text worker: Whisper (word timestamps) via Transformers.js, fully on-device.
// The ONNX runtime is bundled with the app; the model downloads once and is cached.
import { env, pipeline } from '@huggingface/transformers'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'

export interface WorkerWord {
  text: string
  start: number
  end: number
}

export type WorkerIn = {
  type: 'run'
  audio: Float32Array
  /** [startSample, endSample) windows of ≤30 s */
  windows: [number, number][]
  model: string
  language: string
}

export type WorkerOut =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'words'; words: WorkerWord[] }
  | { type: 'done'; words: WorkerWord[] }
  | { type: 'error'; message: string }

const RATE = 16000
const post = (m: WorkerOut): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

env.allowLocalModels = false
env.useBrowserCache = true
const onnx = env.backends.onnx as unknown as { wasm: { wasmPaths: unknown; numThreads: number } }
onnx.wasm.wasmPaths = {
  wasm: new URL(ortWasmUrl, self.location.href).href,
  mjs: new URL(ortMjsUrl, self.location.href).href
}
onnx.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 2)
  : 1

type Asr = (
  audio: Float32Array,
  opts: Record<string, unknown>
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>
const cache = new Map<string, Promise<Asr>>()

function load(model: string): Promise<Asr> {
  let p = cache.get(model)
  if (!p) {
    const files = new Map<string, { loaded: number; total: number }>()
    p = pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (d: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (d.status === 'progress' && d.file) {
          files.set(d.file, { loaded: d.loaded ?? 0, total: d.total ?? 0 })
          let loaded = 0
          let total = 0
          files.forEach((f) => {
            loaded += f.loaded
            total += f.total
          })
          post({ type: 'download', loaded, total })
        }
      }
    }) as unknown as Promise<Asr>
    p.catch(() => cache.delete(model))
    cache.set(model, p)
  }
  return p
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  if (msg.type !== 'run') return
  try {
    const asr = await load(msg.model)
    const all: WorkerWord[] = []
    post({ type: 'progress', done: 0, total: msg.windows.length })
    for (let i = 0; i < msg.windows.length; i++) {
      const [a, b] = msg.windows[i]
      const out = await asr(msg.audio.subarray(a, b), {
        return_timestamps: 'word',
        task: 'transcribe',
        ...(msg.language ? { language: msg.language } : {})
      })
      const offset = a / RATE
      const words: WorkerWord[] = []
      for (const c of out.chunks ?? []) {
        const text = c.text
        if (!text.trim()) continue
        const s = c.timestamp[0] ?? 0
        const end = c.timestamp[1] ?? s + 0.3
        words.push({ text, start: offset + s, end: offset + Math.max(s + 0.05, end) })
      }
      all.push(...words)
      post({ type: 'words', words })
      post({ type: 'progress', done: i + 1, total: msg.windows.length })
    }
    post({ type: 'done', words: all })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
