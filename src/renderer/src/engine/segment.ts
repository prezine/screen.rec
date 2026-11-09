import { ImageSegmenter } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { api } from '@renderer/lib/api'

const INPUT_W = 320

export interface Mask {
  source: OffscreenCanvas
  w: number
  h: number
}

/**
 * Person segmentation for the camera cutout (MediaPipe selfie segmenter).
 * Runs on-device; wasm is bundled with the app and the model is cached after first use.
 */
export class PersonSegmenter {
  private input = new OffscreenCanvas(INPUT_W, 180)
  private maskCanvas = new OffscreenCanvas(INPUT_W, 180)
  private lastTs = -1

  private constructor(private seg: ImageSegmenter) {}

  static async create(): Promise<PersonSegmenter> {
    const model = await api.models.get('selfie-segmenter')
    const fileset = { wasmLoaderPath, wasmBinaryPath }
    const make = (delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false
      })
    let seg: ImageSegmenter
    try {
      seg = await make('GPU')
    } catch {
      seg = await make('CPU')
    }
    return new PersonSegmenter(seg)
  }

  /** Alpha mask (person = opaque) for a camera frame. */
  mask(src: CanvasImageSource, sw: number, sh: number, timestampMs: number): Mask | null {
    if (!sw || !sh) return null
    const w = INPUT_W
    const h = Math.max(2, Math.round((INPUT_W * sh) / sw))
    if (this.input.height !== h) {
      this.input.height = h
      this.maskCanvas.height = h
    }
    const ictx = this.input.getContext('2d')!
    ictx.drawImage(src, 0, 0, w, h)
    const ts = Math.max(this.lastTs + 1, Math.round(timestampMs))
    this.lastTs = ts
    const result = this.seg.segmentForVideo(this.input, ts)
    try {
      const m = result.confidenceMasks?.[0]
      if (!m) return null
      const data = m.getAsFloat32Array()
      const img = new ImageData(m.width, m.height)
      for (let i = 0; i < data.length; i++) {
        // soft threshold → clean edge without a hard halo
        const v = Math.min(1, Math.max(0, (data[i] - 0.35) / 0.3))
        img.data[i * 4 + 3] = v * v * (3 - 2 * v) * 255
      }
      if (this.maskCanvas.width !== m.width || this.maskCanvas.height !== m.height) {
        this.maskCanvas.width = m.width
        this.maskCanvas.height = m.height
      }
      this.maskCanvas.getContext('2d')!.putImageData(img, 0, 0)
      return { source: this.maskCanvas, w: m.width, h: m.height }
    } finally {
      result.close()
    }
  }

  close(): void {
    this.seg.close()
  }
}
