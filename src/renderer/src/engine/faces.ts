import { FaceDetector } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { api } from '@renderer/lib/api'

export interface FaceBox {
  /** normalised to the image */
  x: number
  y: number
  w: number
  h: number
  score: number
}

/**
 * On-device face detection (MediaPipe BlazeFace). The model downloads once (~230 KB) and is cached.
 * Used to blur faces on screen and to keep your face centred in the camera.
 */
export class Faces {
  private constructor(
    private det: FaceDetector,
    private mode: 'IMAGE' | 'VIDEO'
  ) {}

  static async create(mode: 'IMAGE' | 'VIDEO' = 'IMAGE', minScore = 0.55): Promise<Faces> {
    const model = await api.models.get('face-detector')
    const fileset = { wasmLoaderPath, wasmBinaryPath }
    const make = (delegate: 'GPU' | 'CPU'): Promise<FaceDetector> =>
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: mode,
        minDetectionConfidence: minScore
      })
    let det: FaceDetector
    try {
      det = await make('GPU')
    } catch {
      det = await make('CPU')
    }
    return new Faces(det, mode)
  }

  private detectRaw(img: OffscreenCanvas | HTMLCanvasElement | ImageBitmap, ts?: number): FaceBox[] {
    const w = img.width
    const h = img.height
    const res = this.mode === 'VIDEO' ? this.det.detectForVideo(img, ts ?? performance.now()) : this.det.detect(img)
    return res.detections
      .filter((d) => d.boundingBox)
      .map((d) => ({
        x: d.boundingBox!.originX / w,
        y: d.boundingBox!.originY / h,
        w: d.boundingBox!.width / w,
        h: d.boundingBox!.height / h,
        score: d.categories[0]?.score ?? 0
      }))
  }

  /** Faces in a single image (camera frame). */
  detect(img: OffscreenCanvas | ImageBitmap, ts?: number): FaceBox[] {
    return this.detectRaw(img, ts)
  }

  /**
   * Faces anywhere on a screen frame, including small ones (avatars, video-call tiles): the frame is
   * also searched in overlapping tiles, since the detector looks for faces that fill much of its input.
   */
  detectOnScreen(frame: OffscreenCanvas): FaceBox[] {
    const out: FaceBox[] = [...this.detectRaw(frame)]
    const tile = new OffscreenCanvas(1, 1)
    const tctx = tile.getContext('2d')!
    for (const n of [2, 3]) {
      const tw = frame.width / n
      const th = frame.height / n
      tile.width = Math.round(tw * 1.4)
      tile.height = Math.round(th * 1.4)
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const sx = Math.max(0, gx * tw - tw * 0.2)
          const sy = Math.max(0, gy * th - th * 0.2)
          const sw = Math.min(frame.width - sx, tile.width)
          const sh = Math.min(frame.height - sy, tile.height)
          tctx.clearRect(0, 0, tile.width, tile.height)
          tctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh)
          for (const f of this.detectRaw(tile)) {
            out.push({
              x: (sx + f.x * tile.width) / frame.width,
              y: (sy + f.y * tile.height) / frame.height,
              w: (f.w * tile.width) / frame.width,
              h: (f.h * tile.height) / frame.height,
              score: f.score
            })
          }
        }
      }
    }
    return mergeBoxes(out)
  }

  close(): void {
    this.det.close()
  }
}

const iou = (a: FaceBox, b: FaceBox): number => {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

/** Drop duplicates found by several tiles (keep the most confident). */
export function mergeBoxes(boxes: FaceBox[]): FaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const out: FaceBox[] = []
  for (const b of sorted) if (!out.some((o) => iou(o, b) > 0.3)) out.push(b)
  return out
}
