import { app, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * Small ML models used on-device. Each downloads once into the app data folder and
 * is read from disk afterwards, so the features keep working offline.
 */
const MODELS: Record<string, { url: string; file: string }> = {
  'selfie-segmenter': {
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    file: 'selfie_segmenter.tflite'
  },
  'face-detector': {
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
    file: 'blaze_face_short_range.tflite'
  }
}

// Text recognition (OCR) ships with the app — nothing to download.
const OCR_FILES: Record<'worker' | 'core' | 'eng', [packaged: string, dev: string]> = {
  worker: ['worker.min.js', 'node_modules/tesseract.js/dist/worker.min.js'],
  core: ['tesseract-core-simd-lstm.wasm.js', 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'],
  eng: ['eng.traineddata.gz', 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz']
}
const ocrPath = (k: keyof typeof OCR_FILES): string =>
  app.isPackaged ? join(process.resourcesPath, 'ocr', OCR_FILES[k][0]) : join(app.getAppPath(), OCR_FILES[k][1])

const dir = (): string => join(app.getPath('userData'), 'models')
const inflight = new Map<string, Promise<Uint8Array>>()

async function getModel(name: string): Promise<Uint8Array> {
  const spec = MODELS[name]
  if (!spec) throw new Error(`Unknown model: ${name}`)
  const path = join(dir(), spec.file)
  try {
    return new Uint8Array(await fs.readFile(path))
  } catch {
    /* not cached yet */
  }
  let p = inflight.get(name)
  if (!p) {
    p = (async () => {
      let res: Response
      try {
        res = await fetch(spec.url)
      } catch {
        throw new Error('This feature needs an internet connection the first time, to download its model.')
      }
      if (!res.ok) throw new Error(`Model download failed (${res.status})`)
      const buf = new Uint8Array(await res.arrayBuffer())
      await fs.mkdir(dir(), { recursive: true })
      await fs.writeFile(path + '.tmp', buf)
      await fs.rename(path + '.tmp', path)
      return buf
    })().finally(() => inflight.delete(name))
    inflight.set(name, p)
  }
  return p
}

export function registerModelIpc(): void {
  ipcMain.handle('ocr:assets', async () => {
    const [worker, core, eng] = await Promise.all([
      fs.readFile(ocrPath('worker'), 'utf8'),
      fs.readFile(ocrPath('core'), 'utf8'),
      fs.readFile(ocrPath('eng'))
    ])
    return { worker, core, eng: new Uint8Array(eng) }
  })
  ipcMain.handle('models:get', (_e, name: string) => getModel(name))
  ipcMain.handle('models:status', async (_e, name: string) => {
    const spec = MODELS[name]
    if (!spec) return false
    try {
      await fs.access(join(dir(), spec.file))
      return true
    } catch {
      return false
    }
  })
}
