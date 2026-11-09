import type { CursorData, EditState, NRect } from '@shared/types'
import type { Scene } from './compositor'
import type { BackgroundImage } from './backgrounds'
import { CursorPath, cursorOmega, followOmega } from './cursor'
import { buildCues, keyEventsFor, type Cue } from './overlays'
import type { FaceTrack } from './faceMath'
import type { Word } from '@shared/transcript'

/** Builds (and caches) the precomputed cursor paths for a scene. */
export class SceneBuilder {
  private cursorKey = ''
  private followKey = ''
  private cursorPath: CursorPath | null = null
  private followPath: CursorPath | null = null
  private words: Word[] = []
  private cueKey = ''
  private cues: Cue[] = []
  private faceTrack: FaceTrack | null = null
  private cameraOffset = 0

  constructor(
    private cursor: CursorData,
    private duration: number,
    private hasCamera = false
  ) {}

  /** face track for the camera crop */
  setFaceTrack(track: FaceTrack | null, cameraOffset: number): this {
    this.faceTrack = track
    this.cameraOffset = cameraOffset
    return this
  }

  /** transcript words for captions */
  setWords(words: Word[]): this {
    if (words !== this.words) {
      this.words = words
      this.cueKey = ''
    }
    return this
  }

  build(
    edit: EditState,
    srcW: number,
    srcH: number,
    backgroundImage: BackgroundImage | null = null,
    crop?: NRect
  ): Scene {
    const tracked = this.cursor.tracked && this.cursor.samples.length > 0
    if (tracked) {
      const ck = `${edit.cursor.smoothing}`
      if (ck !== this.cursorKey) {
        this.cursorPath = new CursorPath(this.cursor.samples, this.duration, cursorOmega(edit.cursor.smoothing))
        this.cursorKey = ck
      }
      const fk = `${edit.zoomFollow}`
      if (fk !== this.followKey) {
        this.followPath = new CursorPath(this.cursor.samples, this.duration, followOmega(edit.zoomFollow))
        this.followKey = fk
      }
    }
    if (edit.captions.enabled && this.words.length) {
      const key = `${edit.captions.style}|${JSON.stringify(edit.clips)}`
      if (key !== this.cueKey) {
        this.cues = buildCues(this.words, edit.clips, edit.captions.style)
        this.cueKey = key
      }
    }
    const keys = keyEventsFor(this.cursor.keys, edit.keystrokes)
    const cues = edit.captions.enabled ? this.cues : []
    return {
      overlays:
        cues.length || keys.length ? { cues, keys, mac: (this.cursor.platform ?? 'darwin') === 'darwin' } : undefined,
      faceTrack: this.faceTrack,
      cameraOffset: this.cameraOffset,
      edit,
      srcW,
      srcH,
      cursorPath: tracked ? this.cursorPath : null,
      followPath: tracked ? this.followPath : null,
      clicks: this.cursor.clicks,
      backgroundImage,
      crop,
      hasCamera: this.hasCamera
    }
  }
}
