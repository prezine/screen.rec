import type { EditState, ExportSettings, StylePreset } from './types'
import type { Clip } from './clips'

export function defaultEditState(duration: number, hasCamera: boolean): EditState {
  return {
    clips: [{ id: 'c1', start: 0, end: duration }],
    zooms: [],
    background: { kind: 'wallpaper', value: 'dusk', blur: 0 },
    padding: 0.08,
    radius: 0.025,
    shadow: 0.6,
    aspect: 'auto',
    cursor: {
      overlay: false,
      size: 1.4,
      smoothing: 0.6,
      clickEffect: 'ripple',
      highlight: false,
      style: 'arrow'
    },
    motionBlur: { cursor: 0.5, camera: 0.5 },
    layouts: [],
    masks: [],
    zoomFollow: 0.6,
    audio: { volume: 1, muted: false, duck: 0.6 },
    sounds: [],
    captions: { enabled: false, style: 'karaoke', animation: 'pop', position: 'bottom', size: 1, highlight: '#8f80ff' },
    keystrokes: { mode: 'shortcuts', style: 'dark', position: 'bottom', size: 1 },
    camera: {
      visible: hasCamera,
      layout: hasCamera ? 'overlay' : 'screen',
      corner: 'bottom-right',
      size: 0.22,
      shape: 'circle',
      mirror: true,
      faceTracking: false,
      faceZoom: 1.35
    }
  }
}

export const defaultExportSettings: ExportSettings = {
  resolution: 1080,
  fps: 60,
  quality: 'high'
}

/** Fill in fields added in later versions so old project files keep loading. */
export function normaliseEditState(e: Partial<EditState> | undefined, duration: number, hasCamera: boolean): EditState {
  const d = defaultEditState(duration, hasCamera)
  if (!e) return d
  return {
    ...d,
    ...e,
    background: { ...d.background, ...e.background },
    cursor: { ...d.cursor, ...e.cursor },
    camera: {
      ...d.camera,
      ...e.camera,
      layout: e.camera?.layout ?? (e.camera && !e.camera.visible ? 'screen' : d.camera.layout)
    },
    motionBlur: { ...d.motionBlur, ...e.motionBlur },
    layouts: e.layouts ?? [],
    masks: (e.masks ?? []).filter((m) => m.end > m.start && m.rect.w > 0 && m.rect.h > 0),
    audio: { ...d.audio, ...e.audio },
    sounds: (e.sounds ?? []).filter((x) => x.end > x.start),
    captions: { ...d.captions, ...e.captions },
    keystrokes: { ...d.keystrokes, ...e.keystrokes },
    zooms: e.zooms ?? [],
    clips: normaliseClips(e, duration)
  }
}

export function extractStyle(e: EditState): StylePreset['style'] {
  return {
    background: { ...e.background },
    padding: e.padding,
    radius: e.radius,
    shadow: e.shadow,
    aspect: e.aspect,
    cursor: { ...e.cursor },
    zoomFollow: e.zoomFollow,
    camera: { ...e.camera },
    motionBlur: { ...e.motionBlur }
  }
}

export function applyStyle(e: EditState, style: StylePreset['style'], hasCamera: boolean): EditState {
  return {
    ...e,
    ...style,
    background: { ...e.background, ...style.background },
    cursor: { ...e.cursor, ...style.cursor },
    camera: {
      ...e.camera,
      ...style.camera,
      visible: hasCamera && style.camera.visible,
      layout: hasCamera ? (style.camera.layout ?? e.camera.layout) : 'screen'
    },
    motionBlur: { ...e.motionBlur, ...style.motionBlur }
  }
}

/** Older projects stored a single trim range; newer ones a clip list. */
function normaliseClips(e: Partial<EditState> & { trim?: { start: number; end: number } }, duration: number): Clip[] {
  if (Array.isArray(e.clips) && e.clips.length) return e.clips
  const start = e.trim?.start ?? 0
  const end = e.trim?.end ?? duration
  return [{ id: 'c1', start, end: end > start ? end : duration }]
}
