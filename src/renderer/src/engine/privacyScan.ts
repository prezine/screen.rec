import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import { createWorker, type Worker as OcrWorker } from 'tesseract.js'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { MaskSegment, NRect } from '@shared/types'
import { findInLine, type OcrWord, type PrivacyKind } from '@shared/privacy'
import { api, mediaUrl } from '@renderer/lib/api'
import { uid } from './math'
import { Faces, type FaceBox } from './faces'

// Automatic privacy: look through the recording for emails, phone numbers, card numbers, secret
// keys and faces, and cover them with masks. Text recognition and face detection run on-device.

const STEP = 1 // seconds between looks
const OCR_WIDTH = 1600

export interface ScanProgress {
  progress: number
  label: string
}

interface Hit {
  kind: PrivacyKind
  rect: NRect
}

let ocrPromise: Promise<OcrWorker> | null = null
let ocrIdle: ReturnType<typeof setTimeout> | null = null
let ocrUrls: string[] = []

/** The text engine holds ~100 MB; let it go a minute after the last scan. */
function releaseOcrSoon(): void {
  if (ocrIdle) clearTimeout(ocrIdle)
  ocrIdle = setTimeout(() => {
    const p = ocrPromise
    ocrPromise = null
    void p?.then((w) => w.terminate()).catch(() => undefined)
    ocrUrls.forEach((u) => URL.revokeObjectURL(u.split('#')[0]))
    ocrUrls = []
  }, 60_000)
}

/** One shared OCR worker per window (engine + English data are bundled with the app). */
export function ocrWorker(): Promise<OcrWorker> {
  if (ocrIdle) clearTimeout(ocrIdle)
  ocrIdle = null
  if (!ocrPromise) {
    ocrPromise = (async () => {
      const a = await api.ocr.assets()
      const workerPath = URL.createObjectURL(new Blob([a.worker], { type: 'text/javascript' }))
      // the engine treats a path that doesn't end in "js" as a folder; the fragment is ignored when loading
      const corePath = `${URL.createObjectURL(new Blob([a.core], { type: 'text/javascript' }))}#core.js`
      ocrUrls.push(workerPath, corePath)
      // Hand the bundled English data to the engine through its own cache, so it never downloads
      // anything (passing the data in directly is broken in the engine).
      const cachePath = 'toom-ocr/4.0.0_best_int'
      const key = `${cachePath}/eng.traineddata`
      if (!(await idbGet(key))) await idbSet(key, a.eng)
      const worker = createWorker('eng', 1, {
        workerPath,
        corePath,
        workerBlobURL: false,
        cachePath,
        cacheMethod: 'readOnly',
        gzip: true,
        errorHandler: (err: unknown) => console.warn('[ocr]', err)
      })
      // a worker that fails to load never settles; give up instead of hanging
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Text recognition didn’t start. Try again, or restart Toom.')), 60000)
      )
      return Promise.race([worker, timeout])
    })()
    ocrPromise.catch(() => (ocrPromise = null))
  }
  return ocrPromise
}

/** Small greyscale fingerprint of a frame, to skip frames that didn't change. */
function fingerprint(src: OffscreenCanvas): Uint8Array {
  const c = new OffscreenCanvas(48, 30)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, 48, 30)
  const d = ctx.getImageData(0, 0, 48, 30).data
  const out = new Uint8Array(48 * 30)
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10
  return out
}
const changed = (a: Uint8Array | null, b: Uint8Array): boolean => {
  if (!a) return true
  let diff = 0
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
  return diff / a.length > 1.5
}

const iou = (a: NRect, b: NRect): number => {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

/** Grow a box a little so the mask fully covers the text/face. */
function pad(r: NRect, px: number, py: number): NRect {
  const x = Math.max(0, r.x - px)
  const y = Math.max(0, r.y - py)
  return { x, y, w: Math.min(1 - x, r.w + px * 2), h: Math.min(1 - y, r.h + py * 2) }
}

async function textHits(ocr: OcrWorker, frame: OffscreenCanvas, kinds: Set<PrivacyKind>): Promise<Hit[]> {
  const blob = await frame.convertToBlob({ type: 'image/png' })
  const { data } = await ocr.recognize(blob, {}, { blocks: true })
  const out: Hit[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const words: OcrWord[] = line.words
          .filter((w) => w.confidence > 30)
          .map((w) => ({ text: w.text, bbox: w.bbox }))
        for (const f of findInLine(words)) {
          if (!kinds.has(f.kind)) continue
          const r = {
            x: f.bbox.x0 / frame.width,
            y: f.bbox.y0 / frame.height,
            w: (f.bbox.x1 - f.bbox.x0) / frame.width,
            h: (f.bbox.y1 - f.bbox.y0) / frame.height
          }
          out.push({ kind: f.kind, rect: pad(r, r.h * 0.35, r.h * 0.35) })
        }
      }
    }
  }
  return out
}

function faceHits(faces: Faces, frame: OffscreenCanvas): Hit[] {
  return faces.detectOnScreen(frame).map((f: FaceBox) => ({
    kind: 'face' as const,
    rect: pad({ x: f.x, y: f.y, w: f.w, h: f.h }, f.w * 0.25, f.h * 0.3)
  }))
}

/**
 * Scan the recording and return masks for everything found. Masks cover from the look before
 * something appeared until the look after it disappeared, so nothing flashes uncovered.
 */
export async function scanRecording(opts: {
  projectId: string
  screenFile: string
  duration: number
  crop?: NRect
  kinds: PrivacyKind[]
  signal: AbortSignal
  onProgress: (p: ScanProgress) => void
}): Promise<{ masks: MaskSegment[]; warnings: string[] }> {
  const kinds = new Set(opts.kinds)
  const textKinds = opts.kinds.some((k) => k !== 'face')
  const warnings: string[] = []
  opts.onProgress({ progress: 0, label: 'Starting text recognition' })
  const ocr = textKinds ? await ocrWorker() : null
  let faces: Faces | null = null
  if (kinds.has('face')) {
    try {
      opts.onProgress({ progress: 0, label: 'Loading face detection' })
      faces = await Faces.create('IMAGE', 0.6)
    } catch (err) {
      warnings.push(`Faces were skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const input = new Input({ source: new UrlSource(mediaUrl(opts.projectId, opts.screenFile)), formats: ALL_FORMATS })
  const open: { kind: PrivacyKind; rect: NRect; start: number; last: number }[] = []
  const done: MaskSegment[] = []
  const close = (o: (typeof open)[number]): void => {
    done.push({
      id: uid('m'),
      start: Math.max(0, o.start - STEP / 2 - 0.15),
      end: Math.min(opts.duration, o.last + STEP / 2 + 0.15),
      rect: o.rect,
      style: o.kind === 'face' ? 'blur' : 'pixelate',
      strength: o.kind === 'face' ? 0.85 : 0.75,
      auto: o.kind
    })
  }
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('This recording has no video.')
    const fw = track.displayWidth
    const fh = track.displayHeight
    const c = opts.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const sw = fw * c.w
    const sh = fh * c.h
    const scale = Math.min(1, OCR_WIDTH / sw)
    const frame = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale))
    const ctx = frame.getContext('2d')!
    const times: number[] = []
    for (let t = 0; t < opts.duration; t += STEP) times.push(t)
    let prevPrint: Uint8Array | null = null
    let prevHits: Hit[] = []
    let i = 0
    for await (const sample of new VideoSampleSink(track).samplesAtTimestamps(times)) {
      if (opts.signal.aborted) {
        sample?.close()
        throw new DOMException('Cancelled', 'AbortError')
      }
      const t = times[i++]
      if (!sample) continue
      ctx.drawImage(sample.toCanvasImageSource(), c.x * fw, c.y * fh, sw, sh, 0, 0, frame.width, frame.height)
      sample.close()
      const print = fingerprint(frame)
      let hits = prevHits
      if (changed(prevPrint, print)) {
        opts.onProgress({
          progress: t / opts.duration,
          label: `Reading ${formatClock(t)} of ${formatClock(opts.duration)}`
        })
        hits = [...(ocr ? await textHits(ocr, frame, kinds) : []), ...(faces ? faceHits(faces, frame) : [])]
        prevPrint = print
        prevHits = hits
      }
      // continue masks that are still there; close the rest
      const matched = new Set<number>()
      for (const h of hits) {
        const j = open.findIndex((o, k) => !matched.has(k) && o.kind === h.kind && iou(o.rect, h.rect) > 0.4)
        if (j >= 0) {
          matched.add(j)
          open[j].last = t
          continue
        }
        open.push({ kind: h.kind, rect: h.rect, start: t, last: t })
        matched.add(open.length - 1)
      }
      for (let k = open.length - 1; k >= 0; k--) {
        if (!matched.has(k)) {
          close(open[k])
          open.splice(k, 1)
        }
      }
    }
    open.forEach(close)
  } finally {
    input.dispose()
    faces?.close()
    if (ocr) releaseOcrSoon()
  }
  opts.onProgress({ progress: 1, label: 'Done' })
  return { masks: done.sort((a, b) => a.start - b.start), warnings }
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
