import type { Clip } from './clips'

// Types shared between the main process, preload and renderer.

export type SourceKind = 'screen' | 'window' | 'area' | 'device'

/** Normalised rectangle (0..1) */
export interface NRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string // data URL
  appIcon?: string
  displayId?: string
}

export interface DisplayInfo {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

export interface RecordingOptions {
  /** desktopCapturer id (screen/window/area) or media device id (device) */
  sourceId: string
  sourceName: string
  kind: SourceKind
  displayId?: string
  /** area recordings: region of the display to keep */
  crop?: NRect
  camera: boolean
  microphone: boolean
  systemAudio: boolean
}

/** Cursor sample: time (s, relative to recording start), x/y normalised 0..1 within the captured frame. */
export type CursorSample = [t: number, x: number, y: number]

export interface ClickEvent {
  t: number
  x: number
  y: number
  button: 'left' | 'right' | 'middle'
}

export interface CursorData {
  samples: CursorSample[]
  clicks: ClickEvent[]
  /** false when we could not map the cursor to the capture (e.g. window capture) */
  tracked: boolean
  /** shortcuts and non-text keys (see shared/keys.ts) */
  keys?: import('./keys').KeyEvent[]
  /** when you typed — timestamps only, never what */
  typing?: number[]
  /** platform the recording was made on (keycap labels) */
  platform?: string
}

export type BackgroundKind = 'wallpaper' | 'gradient' | 'solid' | 'image' | 'none'

export interface BackgroundSettings {
  kind: BackgroundKind
  /** wallpaper/gradient preset id, hex colour, or project file name */
  value: string
  /** 0..1 */
  blur: number
  /** attribution for downloaded photos (Unsplash) */
  credit?: { name: string; url: string; source: string }
}

export interface ZoomSegment {
  id: string
  start: number
  end: number
  scale: number
  auto: boolean
}

/** How the camera and screen share the frame. */
export type CameraLayout = 'overlay' | 'screen' | 'camera' | 'split' | 'cutout'

export type SoundKind = 'music' | 'sfx' | 'voice'
export type SoundSource = { type: 'preset'; id: string } | { type: 'file'; file: string; name: string }

/** Music or a sound effect laid on the timeline (times are recording time, like zooms). */
export interface SoundItem {
  id: string
  kind: SoundKind
  source: SoundSource
  start: number
  end: number
  /** seconds into the sound where playback begins */
  offset: number
  /** 0..2 */
  volume: number
  fadeIn: number
  fadeOut: number
  /** music: repeat when the track is shorter than the item */
  loop: boolean
}

export type CaptionStyle = 'clean' | 'box' | 'karaoke' | 'bold' | 'glass'
export type CaptionAnimation = 'none' | 'fade' | 'rise' | 'pop'

export interface CaptionSettings {
  enabled: boolean
  style: CaptionStyle
  animation: CaptionAnimation
  position: 'bottom' | 'top'
  /** 0.6..1.6 */
  size: number
  /** current-word colour */
  highlight: string
}

export interface KeystrokeSettings {
  /** shortcuts: keys pressed with ⌘/Ctrl/⌥ · all: also Enter, Esc, arrows… */
  mode: 'off' | 'shortcuts' | 'all'
  style: 'dark' | 'light'
  position: 'bottom' | 'top'
  size: number
}

export type MaskStyle = 'blur' | 'pixelate' | 'solid'

/** Hides part of the recording (passwords, emails, keys…) for a stretch of time. */
export interface MaskSegment {
  id: string
  start: number
  end: number
  /** normalised to the recording (after any area crop) */
  rect: NRect
  style: MaskStyle
  /** 0..1 blur radius / pixel size */
  strength: number
  /** solid masks */
  color?: string
  /** added by the automatic privacy scan (what it found) */
  auto?: 'email' | 'phone' | 'card' | 'key' | 'face'
}

export interface LayoutSegment {
  id: string
  start: number
  end: number
  layout: CameraLayout
}

export type CursorStyle = 'arrow' | 'arrow-light' | 'dot' | 'ring'
export type ClickEffect = 'none' | 'ripple' | 'circle' | 'glass'

export type AspectRatio = 'auto' | '16:9' | '9:16' | '1:1' | '4:3'
export type CameraCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface EditState {
  /** kept parts of the recording, source time, ordered */
  clips: Clip[]
  zooms: ZoomSegment[]
  background: BackgroundSettings
  padding: number // fraction of output size, 0..0.25
  radius: number // corner radius as fraction of min(content w,h), 0..0.1
  shadow: number // 0..1
  aspect: AspectRatio
  cursor: {
    overlay: boolean // draw our own cursor (useful when the OS cursor is not baked in)
    size: number // 0.5..3
    smoothing: number // 0..1
    clickEffect: ClickEffect
    highlight: boolean
    style: CursorStyle
  }
  /** 0..1 strength; 0 = off */
  motionBlur: { cursor: number; camera: number }
  zoomFollow: number // 0..1 how lazily the zoom camera follows the cursor
  /** duck: how much music drops while you're talking (0 = off) */
  audio: { volume: number; muted: boolean; duck: number }
  sounds: SoundItem[]
  /** when the automatic privacy scan last ran (ms epoch) */
  privacyScan?: { at: number; kinds: string[] }
  captions: CaptionSettings
  keystrokes: KeystrokeSettings
  /** timed layout changes; outside these the camera uses camera.layout */
  layouts: LayoutSegment[]
  masks: MaskSegment[]
  camera: {
    /** legacy flag; layout 'screen' now hides the camera */
    visible: boolean
    layout: CameraLayout
    corner: CameraCorner
    size: number // fraction of min(output w,h), 0.1..0.5
    shape: 'circle' | 'rounded' | 'square'
    mirror: boolean
    /** keep your face centred in the camera frame as you move */
    faceTracking?: boolean
    /** how tightly to frame your face when tracking (1 = whole camera view) */
    faceZoom?: number
  }
}

export type ProjectStatus = 'recording' | 'raw' | 'ready' | 'failed'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  status: ProjectStatus
  source: {
    kind: SourceKind
    name: string
    displayId?: string
    /** full captured frame size */
    width: number
    height: number
    /** area recordings: normalised region of the frame to use */
    crop?: NRect
  }
  files: {
    screen: string // file name inside project dir
    camera?: string
  }
  /** camera start time minus screen start time, seconds */
  cameraOffset: number
  duration: number
  edit?: EditState
  thumbnail?: string
}

export interface ExportSettings {
  resolution: 720 | 1080 | 1440 | 2160
  fps: 30 | 60
  quality: 'medium' | 'high' | 'very-high'
}

export interface ChunkPayload {
  track: 'screen' | 'camera'
  data: ArrayBuffer
}

export interface RecordingStarted {
  screenStartedAt: number // Date.now() when screen recorder started
  cameraStartedAt?: number
  width: number
  height: number
  screenMime: string
  cameraMime?: string
}

export type RecorderCommand = 'begin' | 'stop' | 'pause' | 'resume' | 'cancel'

export interface RecState {
  phase: 'idle' | 'countdown' | 'recording' | 'paused' | 'finishing'
  elapsed: number
  countdown?: number
  /** the plan's recording length limit in seconds, if any (recording stops by itself there) */
  limit?: number
}

export type ToolbarCommand = 'stop' | 'pause' | 'resume' | 'cancel'

/** The "look" of a project that can be saved and re-applied. */
export interface StylePreset {
  id: string
  name: string
  style: Pick<
    EditState,
    'background' | 'padding' | 'radius' | 'shadow' | 'aspect' | 'cursor' | 'zoomFollow' | 'camera'
  > &
    Partial<Pick<EditState, 'motionBlur'>>
}

/** Size of the usable picture (after an area crop). */
export function contentSize(source: ProjectMeta['source']): { w: number; h: number } {
  const c = source.crop
  return c ? { w: source.width * c.w, h: source.height * c.h } : { w: source.width, h: source.height }
}
