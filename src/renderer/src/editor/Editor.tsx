import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EyeOff,
  Music,
  Waveform,
  Gauge,
  MousePointer2,
  RectangleHorizontal,
  Sparkles,
  Video,
  VideoOff,
  X,
  ZoomIn
} from '@renderer/lib/icons'
import {
  contentSize,
  type AspectRatio,
  type CameraLayout,
  type LayoutSegment,
  type MaskSegment,
  type SoundItem,
  type CursorData,
  type EditState,
  type ProjectMeta,
  type StylePreset,
  type ZoomSegment
} from '@shared/types'
import { applyStyle, defaultEditState, extractStyle, normaliseEditState } from '@shared/defaults'
import { api, mediaUrl } from '@renderer/lib/api'
import { getDefaultPreset } from '@renderer/lib/presets'
import { useHistory } from '@renderer/lib/useHistory'
import { defaultAutoZoom, generateAutoZooms } from '@renderer/engine/autozoom'
import { probe, remuxToMp4 } from '@renderer/engine/convert'
import { SceneBuilder } from '@renderer/engine/scene'
import { computePeaks } from '@renderer/engine/waveform'
import { clamp, uid } from '@renderer/engine/math'
import { clearSpeed, deleteClip, firstStart, lastEnd, removeRange, setRangeSpeed, splitAt } from '@shared/clips'
import { typingRanges } from '@shared/keys'
import { LAYOUT_LABELS, newLayoutSegment } from '@renderer/engine/layout'
import { TranscriptPanel } from './TranscriptPanel'
import { UnsplashTab } from './ImageSources'
import { GRADIENTS, WALLPAPERS, gradientCss, wallpaperCss, type BackgroundImage } from '@renderer/engine/backgrounds'
import { MaskOverlay } from './MaskOverlay'
import { AudioPanel } from './AudioPanel'
import { CaptionsPanel } from './CaptionsPanel'
import type { PrivacyKind } from '@shared/privacy'
import { analyseCamera, loadFaceTrack, saveFaceTrack, type FaceTrack } from '@renderer/engine/faceTrack'
import { loadTranscript } from '@renderer/engine/transcribe'
import type { Word } from '@shared/transcript'
import { presetLabel } from '@renderer/engine/sounds'
import { Dropdown, IconButton, MenuItem, SelectButton } from '@renderer/lib/ui'
import { Preview, type PlayerHandle, type PreviewQuality } from './Preview'
import { Timeline } from './Timeline'
import { SidePanel, type PanelId } from './SidePanel'
import { TitleBar } from './TitleBar'
import { Transport } from './Transport'
import { ExportDialog } from './ExportDialog'

/** First open after recording: remux WebM → MP4, probe it, and seed the edit with auto zooms. */
async function prepareProject(
  meta: ProjectMeta,
  cursor: CursorData,
  onStep: (label: string, p: number) => void
): Promise<ProjectMeta> {
  const next: ProjectMeta = { ...meta, files: { ...meta.files } }
  const convert = async (key: 'screen' | 'camera', label: string): Promise<void> => {
    const src = next.files[key]
    if (!src || !src.endsWith('.webm')) return
    const dst = src.replace(/\.webm$/, '.mp4')
    try {
      await remuxToMp4(meta.id, src, dst, (p) => onStep(label, p))
      next.files[key] = dst
      await api.projects.removeFile(meta.id, src)
    } catch (err) {
      console.warn(`Remux of ${src} failed, using WebM directly`, err)
    }
  }
  await convert('screen', 'Preparing screen recording')
  await convert('camera', 'Preparing camera recording')
  onStep('Analysing', 1)
  const info = await probe(mediaUrl(meta.id, next.files.screen))
  next.duration = info.duration || meta.duration
  next.source = { ...next.source, width: info.width || next.source.width, height: info.height || next.source.height }
  const prefs = (await api.settings.get()).editing
  let edit = defaultEditState(next.duration, !!next.files.camera)
  edit.cursor = { ...edit.cursor, smoothing: prefs.cursorSmoothing, clickEffect: prefs.clickEffect }
  const preset = getDefaultPreset()
  if (preset) edit = applyStyle(edit, preset.style, !!next.files.camera)
  edit.zooms = prefs.autoZoom
    ? generateAutoZooms(cursor, next.duration, { ...defaultAutoZoom, scale: prefs.zoomLevel })
    : []
  if (prefs.speedUpTyping) {
    for (const [a, b] of typingRanges(cursor.typing ?? [])) edit.clips = setRangeSpeed(edit.clips, a, b, 3, true)
  }
  next.edit = edit
  next.status = 'ready'
  await api.projects.save(next)
  return next
}

// One preparation per project per window — guards against StrictMode double effects and re-mounts.
const preparing = new Map<string, Promise<ProjectMeta>>()
function prepareOnce(
  meta: ProjectMeta,
  cursor: CursorData,
  onStep: (label: string, p: number) => void
): Promise<ProjectMeta> {
  let p = preparing.get(meta.id)
  if (!p) {
    p = prepareProject(meta, cursor, onStep).finally(() => preparing.delete(meta.id))
    preparing.set(meta.id, p)
  }
  return p
}

const ASPECTS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Match recording' },
  { value: '16:9', label: 'Wide', hint: '16:9' },
  { value: '4:3', label: 'Standard', hint: '4:3' },
  { value: '1:1', label: 'Square', hint: '1:1' },
  { value: '9:16', label: 'Vertical', hint: '9:16' }
]
/** CSS for the editor's ambient glow: the chosen background, blurred way out behind the UI. */
function ambientCss(bg: EditState['background'], projectId: string): string {
  if (bg.kind === 'wallpaper') {
    const w = WALLPAPERS.find((x) => x.id === bg.value)
    if (w) return wallpaperCss(w)
  }
  if (bg.kind === 'gradient') {
    const g = GRADIENTS.find((x) => x.id === bg.value)
    if (g) return gradientCss(g)
  }
  if (bg.kind === 'solid') return bg.value
  if (bg.kind === 'image' && bg.value) return `center / cover no-repeat url("${mediaUrl(projectId, bg.value)}")`
  return 'radial-gradient(circle at 30% 20%, #4733d6, transparent 60%), radial-gradient(circle at 80% 80%, #0e7490, transparent 55%)'
}

const QUALITIES: { value: PreviewQuality; label: string }[] = [
  { value: 1, label: 'Full' },
  { value: 0.5, label: 'Half' },
  { value: 0.25, label: 'Quarter' }
]

export function Editor({ projectId }: { projectId: string }): React.JSX.Element {
  const [isMac, setIsMac] = useState(true)
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [cursor, setCursor] = useState<CursorData | null>(null)
  const history = useHistory<EditState>()
  const edit = history.value
  const [prep, setPrep] = useState<{ label: string; p: number } | null>({ label: 'Loading', p: 0 })
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedZoom, setSelectedZoom] = useState<string | null>(null)
  const [selectedClip, setSelectedClip] = useState<string | null>(null)
  const [selectedLayout, setSelectedLayout] = useState<string | null>(null)
  const [selectedMask, setSelectedMask] = useState<string | null>(null)
  const [selectedSound, setSelectedSound] = useState<string | null>(null)
  const [words, setWords] = useState<Word[]>([])
  const [previewMuted, setPreviewMuted] = useState(false)
  const [scan, setScan] = useState<{ progress: number; label: string } | null>(null)
  const [faceTrack, setFaceTrack] = useState<FaceTrack | null>(null)
  const [faceStatus, setFaceStatus] = useState<{
    state: 'idle' | 'analysing' | 'error'
    progress?: number
    message?: string
  }>({ state: 'idle' })
  const faceAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    void loadFaceTrack(projectId).then(setFaceTrack)
    return () => faceAbort.current?.abort()
  }, [projectId])
  const scanAbort = useRef<AbortController | null>(null)
  const onTranscript = useCallback((t: { words: Word[] } | null) => setWords(t?.words ?? []), [])
  useEffect(() => {
    void loadTranscript(projectId).then((t) => setWords(t?.words ?? []))
  }, [projectId])
  const [notice, setNotice] = useState<string | null>(null)
  const [cutoutStatus, setCutoutStatus] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; message?: string }>(
    { state: 'idle' }
  )
  const [exporting, setExporting] = useState(false)
  const [bgImage, setBgImage] = useState<BackgroundImage | null>(null)
  const [panel, setPanel] = useState<PanelId>('background')
  const [quality, setQuality] = useState<PreviewQuality>(1)
  const [rate, setRate] = useState(1)
  const [tlZoom, setTlZoom] = useState(1)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const player = useRef<PlayerHandle>(null)
  const zoomLevelPref = useRef(defaultAutoZoom.scale)
  useEffect(() => {
    void api.settings.get().then((s) => (zoomLevelPref.current = s.editing.zoomLevel))
  }, [])

  useEffect(() => {
    void api.platform().then((p) => setIsMac(p === 'darwin'))
  }, [])

  // load
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const inflight = preparing.get(projectId)
        const meta = inflight ? await inflight : await api.projects.get(projectId)
        if (!meta) throw new Error('Project not found')
        const cur = await api.projects.cursor(projectId)
        const ready =
          meta.status === 'raw' ? await prepareOnce(meta, cur, (label, p) => alive && setPrep({ label, p })) : meta
        if (!alive) return
        document.title = `${ready.name} — Toom`
        setCursor(cur)
        setProject(ready)
        history.reset(normaliseEditState(ready.edit, ready.duration, !!ready.files.camera))
        setPrep(null)
        computePeaks(mediaUrl(ready.id, ready.files.screen), ready.duration)
          .then((p) => alive && setPeaks(p))
          .catch((err) => console.warn('waveform failed', err))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // autosave (debounced) + thumbnail for the library
  useEffect(() => {
    if (!project || !edit) return
    const id = setTimeout(() => {
      let thumbnail = project.thumbnail
      const c = player.current?.canvas()
      if (c && c.width > 0) {
        const t = document.createElement('canvas')
        t.width = 384
        t.height = Math.round((384 * c.height) / c.width)
        t.getContext('2d')?.drawImage(c, 0, 0, t.width, t.height)
        thumbnail = t.toDataURL('image/jpeg', 0.75)
      }
      void api.projects.save({ ...project, edit, thumbnail })
    }, 700)
    return () => clearTimeout(id)
  }, [project, edit])

  // background image
  const bgKind = edit?.background.kind
  const bgValue = edit?.background.value
  useEffect(() => {
    if (!project || bgKind !== 'image' || !bgValue) {
      setBgImage(null)
      return
    }
    const img = new Image()
    img.onload = () => setBgImage({ source: img, w: img.naturalWidth, h: img.naturalHeight, key: bgValue })
    img.src = mediaUrl(project.id, bgValue)
  }, [project, bgKind, bgValue])

  const builder = useMemo(
    () => (project && cursor ? new SceneBuilder(cursor, project.duration, !!project.files.camera) : null),
    [project?.id, project?.duration, cursor] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const scene = useMemo(() => {
    if (!builder || !edit || !project) return null
    const cs = contentSize(project.source)
    return builder
      .setWords(words)
      .setFaceTrack(faceTrack, project.cameraOffset)
      .build(edit, cs.w, cs.h, bgImage, project.source.crop)
  }, [builder, edit, project, bgImage, words, faceTrack])

  const update = history.set
  const setZooms = useCallback((zooms: ZoomSegment[]) => update((e) => ({ ...e, zooms }), 'zoom-drag'), [update])

  const addZoomAt = useCallback(
    (t: number) => {
      if (!project) return
      const start = clamp(t, 0, Math.max(0, project.duration - 1))
      const z: ZoomSegment = {
        id: uid(),
        start,
        end: Math.min(project.duration, start + 2.5),
        scale: zoomLevelPref.current,
        auto: false
      }
      update((e) => ({ ...e, zooms: [...e.zooms, z].sort((a, b) => a.start - b.start) }))
      setSelectedZoom(z.id)
      setPanel('zoom')
    },
    [project, update]
  )
  const addZoom = useCallback(() => addZoomAt(player.current?.time ?? 0), [addZoomAt])

  const deleteZoom = useCallback(
    (id: string) => {
      update((e) => ({ ...e, zooms: e.zooms.filter((z) => z.id !== id) }))
      setSelectedZoom(null)
    },
    [update]
  )

  const regenerate = useCallback(() => {
    if (!project || !cursor || !edit) return
    const manual = edit.zooms.filter((z) => !z.auto)
    const autos = generateAutoZooms(cursor, project.duration, {
      ...defaultAutoZoom,
      scale: zoomLevelPref.current
    }).filter((a) => !manual.some((m) => a.start < m.end && a.end > m.start))
    update((e) => ({ ...e, zooms: [...e.zooms.filter((z) => !z.auto), ...autos].sort((a, b) => a.start - b.start) }))
    const clicks = cursor.clicks.filter((c) => c.button === 'left').length
    if (autos.length)
      setNotice(
        `Added ${autos.length} auto zoom${autos.length === 1 ? '' : 's'} from ${clicks ? `${clicks} click${clicks === 1 ? '' : 's'}` : 'cursor pauses'}.`
      )
    else if (!clicks)
      setNotice(
        'No clicks were recorded, and the cursor never settled long enough to zoom. Turn on click tracking (and Accessibility permission on macOS) in the recording bar settings, or add zooms with Z.'
      )
    else setNotice('Your clicks all fall inside zooms you added by hand, so nothing new was added.')
  }, [project, cursor, edit, update])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  // ---- music & sound effects
  const selectSound = useCallback((id: string | null) => {
    setSelectedSound(id)
    if (id) {
      setPanel('audio')
      setSelectedZoom(null)
      setSelectedLayout(null)
      setSelectedMask(null)
    }
  }, [])
  const deleteSound = useCallback(
    (id: string) => {
      update((e) => ({ ...e, sounds: e.sounds.filter((x) => x.id !== id) }))
      setSelectedSound(null)
    },
    [update]
  )

  // ---- face tracking (analyse the camera once, then the crop follows your face)
  const setFaceTracking = useCallback(
    async (on: boolean) => {
      update((e) => ({ ...e, camera: { ...e.camera, faceTracking: on } }))
      if (!on || faceTrack || !project?.files.camera || faceAbort.current) return
      const ac = new AbortController()
      faceAbort.current = ac
      setFaceStatus({ state: 'analysing', progress: 0 })
      try {
        const t = await analyseCamera({
          projectId: project.id,
          cameraFile: project.files.camera,
          signal: ac.signal,
          onProgress: (p) => setFaceStatus({ state: 'analysing', progress: p })
        })
        await saveFaceTrack(project.id, t)
        setFaceTrack(t)
        setFaceStatus({ state: 'idle' })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') setFaceStatus({ state: 'idle' })
        else {
          setFaceStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
          update((e) => ({ ...e, camera: { ...e.camera, faceTracking: false } }))
        }
      } finally {
        faceAbort.current = null
      }
    },
    [project, faceTrack, update]
  )

  // ---- automatic privacy scan (emails, numbers, keys, faces)
  const runScan = useCallback(
    async (kinds: PrivacyKind[], quiet = false) => {
      if (!project || scanAbort.current) return
      const ac = new AbortController()
      scanAbort.current = ac
      setScan({ progress: 0, label: 'Starting' })
      try {
        const { scanRecording } = await import('@renderer/engine/privacyScan')
        const r = await scanRecording({
          projectId: project.id,
          screenFile: project.files.screen,
          duration: project.duration,
          crop: project.source.crop,
          kinds,
          signal: ac.signal,
          onProgress: (p) => setScan(p)
        })
        update((e) => ({
          ...e,
          masks: [...e.masks.filter((m) => !m.auto), ...r.masks].sort((a, b) => a.start - b.start),
          privacyScan: { at: Date.now(), kinds }
        }))
        const msg = r.masks.length
          ? `Covered ${r.masks.length} sensitive item${r.masks.length === 1 ? '' : 's'} automatically. Review them in Privacy.`
          : quiet
            ? ''
            : 'Nothing sensitive found.'
        if (msg || r.warnings.length) setNotice([msg, ...r.warnings].filter(Boolean).join(' '))
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError'))
          setNotice(`Privacy scan failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        scanAbort.current = null
        setScan(null)
      }
    },
    [project, update]
  )
  // new recordings: scan automatically when the setting is on
  const autoScanned = useRef(false)
  useEffect(() => {
    if (!project || !edit || autoScanned.current || edit.privacyScan) return
    autoScanned.current = true
    void api.settings.get().then((s) => {
      if (s.editing.autoPrivacy) void runScan(['email', 'phone', 'card', 'key', 'face'], true)
    })
  }, [project, edit, runScan])
  useEffect(() => () => scanAbort.current?.abort(), [])

  // ---- privacy masks
  const selectMask = useCallback((id: string | null) => {
    setSelectedMask(id)
    if (id) {
      setPanel('privacy')
      setSelectedZoom(null)
      setSelectedLayout(null)
    }
  }, [])
  const addMaskAt = useCallback(
    (t: number) => {
      if (!project) return
      // start a beat early so the mask is already fully in at the playhead
      const start = clamp(t - 0.15, 0, Math.max(0, project.duration - 0.5))
      const m: MaskSegment = {
        id: uid('m'),
        start,
        end: Math.min(project.duration, start + 3),
        rect: { x: 0.36, y: 0.4, w: 0.28, h: 0.12 },
        style: 'blur',
        strength: 0.6
      }
      update((e) => ({ ...e, masks: [...e.masks, m].sort((a, b) => a.start - b.start) }))
      selectMask(m.id)
    },
    [project, update, selectMask]
  )
  const addMask = useCallback(() => addMaskAt(player.current?.time ?? 0), [addMaskAt])
  const deleteMask = useCallback(
    (id: string) => {
      update((e) => ({ ...e, masks: e.masks.filter((m) => m.id !== id) }))
      setSelectedMask(null)
    },
    [update]
  )

  const trimTo = useCallback(
    (side: 'start' | 'end') => {
      if (!project) return
      const t = player.current?.time ?? 0
      update((e) => {
        const next = side === 'start' ? removeRange(e.clips, 0, t) : removeRange(e.clips, t, project.duration)
        return next.length ? { ...e, clips: next } : e
      })
    },
    [update, project]
  )

  const splitClip = useCallback(() => {
    const t = player.current?.time ?? 0
    update((e) => ({ ...e, clips: splitAt(e.clips, t) }))
  }, [update])

  const removeClip = useCallback(
    (id: string) => {
      update((e) => ({ ...e, clips: deleteClip(e.clips, id) }))
      setSelectedClip(null)
    },
    [update]
  )

  const selectLayout = useCallback((id: string | null) => {
    setSelectedLayout(id)
    if (id) setPanel('camera')
  }, [])

  const addLayoutAt = useCallback(
    (t: number, layout?: CameraLayout) => {
      if (!project || !edit) return
      const kind = layout ?? (edit.camera.layout === 'camera' ? 'overlay' : 'camera')
      const seg = newLayoutSegment(t, project.duration, kind, uid('l'))
      update((e) => ({ ...e, layouts: [...e.layouts, seg].sort((a, b) => a.start - b.start) }))
      setSelectedLayout(seg.id)
      setPanel('camera')
    },
    [project, edit, update]
  )

  const deleteLayout = useCallback(
    (id: string) => {
      update((e) => ({ ...e, layouts: e.layouts.filter((l) => l.id !== id) }))
      setSelectedLayout(null)
    },
    [update]
  )

  const selectZoom = useCallback((id: string | null) => {
    setSelectedZoom(id)
    if (id) setPanel('zoom')
  }, [])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || exporting) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setExporting(true)
        return
      }
      if (mod) return
      const p = player.current
      if (e.code === 'Space') {
        e.preventDefault()
        p?.toggle()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSound) deleteSound(selectedSound)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMask) deleteMask(selectedMask)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoom) deleteZoom(selectedZoom)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayout) deleteLayout(selectedLayout)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClip) removeClip(selectedClip)
      else if (e.key === 's') splitClip()
      else if (e.key === 'z') addZoom()
      else if (e.key === 'm') addMask()
      else if (e.key === 'i') trimTo('start')
      else if (e.key === 'o') trimTo('end')
      else if (e.key === 'Home' && edit) p?.seek(firstStart(edit.clips))
      else if (e.key === 'End' && edit) p?.seek(lastEnd(edit.clips))
      else if (e.key === 'ArrowLeft') p?.seek((p?.time ?? 0) - (e.shiftKey ? 1 : 1 / 30))
      else if (e.key === 'ArrowRight') p?.seek((p?.time ?? 0) + (e.shiftKey ? 1 : 1 / 30))
      else if (e.key === 'Escape') {
        setSelectedZoom(null)
        setSelectedClip(null)
        setSelectedLayout(null)
        setSelectedMask(null)
        setSelectedSound(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedZoom,
    selectedClip,
    selectedLayout,
    selectedMask,
    selectedSound,
    deleteSound,
    deleteMask,
    addMask,
    deleteLayout,
    deleteZoom,
    removeClip,
    splitClip,
    addZoom,
    exporting,
    history,
    trimTo,
    edit
  ])

  // application menu (macOS menu bar / Windows menu)
  const menuRef = useRef<(cmd: string) => void>(() => undefined)
  menuRef.current = (cmd: string) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement as HTMLElement | null)?.tagName ?? ''
    )
    const p = player.current
    if (cmd === 'undo') return typing ? void document.execCommand('undo') : history.undo()
    if (cmd === 'redo') return typing ? void document.execCommand('redo') : history.redo()
    if (!project || !edit) return
    if (cmd === 'export') setExporting(true)
    else if (cmd === 'reveal') void api.projects.reveal(project.id)
    else if (cmd === 'delete-project') void api.projects.confirmRemove(project.id)
    else if (cmd === 'split') splitClip()
    else if (cmd === 'add-zoom') addZoom()
    else if (cmd === 'auto-zoom') regenerate()
    else if (cmd === 'add-mask') addMask()
    else if (cmd === 'add-layout' && project.files.camera) addLayoutAt(p?.time ?? 0)
    else if (cmd === 'play') p?.toggle()
    else if (cmd === 'go-start') p?.seek(firstStart(edit.clips))
    else if (cmd === 'go-end') p?.seek(lastEnd(edit.clips))
    else if (cmd === 'timeline-in') setTlZoom((z) => Math.min(12, z * 1.5))
    else if (cmd === 'timeline-out') setTlZoom((z) => Math.max(1, z / 1.5))
    else if (cmd === 'delete-selection') {
      if (typing) return
      if (selectedSound) deleteSound(selectedSound)
      else if (selectedMask) deleteMask(selectedMask)
      else if (selectedZoom) deleteZoom(selectedZoom)
      else if (selectedLayout) deleteLayout(selectedLayout)
      else if (selectedClip) removeClip(selectedClip)
    } else if (cmd.startsWith('panel:')) setPanel(cmd.slice(6) as PanelId)
  }
  useEffect(() => {
    void api.menu.setContext('editor')
    return api.menu.onCommand((c) => menuRef.current(c))
  }, [])

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="w-[420px] glass-strong rounded-[24px] p-6">
          <h2 className="mb-3 text-base font-semibold">Couldn’t open this recording</h2>
          <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300 ring-1 ring-red-500/20">{error}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="h-8 rounded-lg px-3 text-ink-200 hover:bg-white/5"
              onClick={() => void api.projects.reveal(projectId)}
            >
              Show files
            </button>
            <button className="h-8 rounded-lg bg-brand-600 px-3 text-[#fff]" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (prep || !project || !edit || !scene || !cursor) {
    return (
      <div className="drag grid h-full place-items-center">
        <div className="flex w-72 flex-col items-center gap-4">
          <div className="size-7 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
          <div className="text-sm text-ink-200">{prep?.label ?? 'Loading'}…</div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width]"
              style={{ width: `${Math.round((prep?.p ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  const sel = edit.zooms.find((z) => z.id === selectedZoom) ?? null
  const tracked = cursor.tracked && cursor.samples.length > 0
  const hasCam = !!project.files.camera
  const typing = typingRanges(cursor.typing ?? [])
  const showSoundLanes = edit.sounds.length > 0 || panel === 'audio'
  const aspect = ASPECTS.find((a) => a.value === edit.aspect)!

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-ink-950">
      <div className="ambient -z-10" style={{ background: ambientCss(edit.background, project.id) }} />
      <TitleBar
        isMac={isMac}
        name={project.name}
        onRename={(name) => {
          setProject({ ...project, name })
          document.title = `${name} — Toom`
        }}
        onReveal={() => void api.projects.reveal(project.id)}
        onDelete={() => void api.projects.confirmRemove(project.id)}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        currentStyle={() => extractStyle(edit)}
        onApplyPreset={(p: StylePreset) => update((e) => applyStyle(e, p.style, hasCam))}
        onExport={() => setExporting(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* stage */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between px-6 pt-1">
            <Dropdown
              width={220}
              trigger={(open) => (
                <SelectButton
                  icon={<RectangleHorizontal size={15} className="text-ink-300" />}
                  value={aspect.label}
                  open={open}
                />
              )}
            >
              {(close) =>
                ASPECTS.map((a) => (
                  <MenuItem
                    key={a.value}
                    active={edit.aspect === a.value}
                    right={<span className="text-xs text-ink-400">{a.hint}</span>}
                    onClick={() => {
                      update((e) => ({ ...e, aspect: a.value }))
                      close()
                    }}
                  >
                    {a.label}
                  </MenuItem>
                ))
              }
            </Dropdown>
            <Dropdown
              align="right"
              width={180}
              trigger={(open) => (
                <SelectButton
                  icon={<Gauge size={15} className="text-ink-300" />}
                  label="Preview quality"
                  value={QUALITIES.find((q) => q.value === quality)!.label}
                  open={open}
                />
              )}
            >
              {(close) =>
                QUALITIES.map((q) => (
                  <MenuItem
                    key={q.value}
                    active={quality === q.value}
                    onClick={() => {
                      setQuality(q.value)
                      close()
                    }}
                  >
                    {q.label}
                  </MenuItem>
                ))
              }
            </Dropdown>
          </div>

          <div className="relative min-h-0 flex-1 px-24 py-4">
            {/* floating tools */}
            <div className="glass absolute top-1/2 left-5 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-[20px] p-1.5">
              <IconButton label="Add zoom (Z)" tooltipSide="right" onClick={addZoom} className="size-10 rounded-xl">
                <ZoomIn size={19} />
              </IconButton>
              <IconButton
                label="Auto zoom"
                tooltipSide="right"
                onClick={regenerate}
                disabled={!tracked}
                className="size-10 rounded-xl"
              >
                <Sparkles size={19} />
              </IconButton>
              <div className="mx-2 my-0.5 h-px bg-white/[0.07]" />
              <IconButton
                label={edit.cursor.overlay ? 'Hide smooth cursor' : 'Show smooth cursor'}
                tooltipSide="right"
                active={edit.cursor.overlay}
                disabled={!tracked}
                onClick={() => update((e) => ({ ...e, cursor: { ...e.cursor, overlay: !e.cursor.overlay } }))}
                className="size-10 rounded-xl"
              >
                <MousePointer2 size={19} />
              </IconButton>
              <IconButton
                label={edit.camera.layout !== 'screen' ? 'Hide camera' : 'Show camera'}
                tooltipSide="right"
                active={hasCam && edit.camera.layout !== 'screen'}
                disabled={!hasCam}
                onClick={() =>
                  update((e) => ({
                    ...e,
                    camera: { ...e.camera, layout: e.camera.layout === 'screen' ? 'overlay' : 'screen' }
                  }))
                }
                className="size-10 rounded-xl"
              >
                {hasCam && edit.camera.layout !== 'screen' ? <Video size={19} /> : <VideoOff size={19} />}
              </IconButton>
              <IconButton
                label="Add privacy mask (M)"
                tooltipSide="right"
                onClick={addMask}
                className="size-10 rounded-xl"
              >
                <EyeOff size={19} />
              </IconButton>
            </div>

            <Preview
              ref={player}
              project={project}
              edit={edit}
              scene={scene}
              quality={quality}
              rate={rate}
              onTime={setTime}
              onPlaying={setPlaying}
              onCutoutStatus={(state, message) => setCutoutStatus({ state, message })}
              peaks={peaks}
              muted={previewMuted}
              overlay={(w, h) => {
                const m = edit.masks.find((x) => x.id === selectedMask)
                if (!m || playing) return null
                return (
                  <MaskOverlay
                    scene={scene}
                    time={time}
                    width={w}
                    height={h}
                    mask={m}
                    onChange={(rect) =>
                      update(
                        (e) => ({ ...e, masks: e.masks.map((x) => (x.id === m.id ? { ...x, rect } : x)) }),
                        `mask-rect-${m.id}`
                      )
                    }
                  />
                )
              }}
            />
            {notice && (
              <div className="glass-strong absolute top-3 left-1/2 z-20 flex max-w-[560px] -translate-x-1/2 items-start gap-3 rounded-2xl py-2.5 pr-2 pl-4 text-[12.5px] leading-relaxed text-ink-100">
                <Sparkles size={15} className="mt-0.5 shrink-0 text-brand-300" />
                <span className="flex-1">{notice}</span>
                <button
                  onClick={() => setNotice(null)}
                  className="grid size-6 shrink-0 place-items-center rounded-lg hover:bg-white/10"
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>

          <Transport
            time={time}
            clips={edit.clips}
            canDeleteClip={!!selectedClip && edit.clips.length > 1}
            selectedClip={edit.clips.find((c) => c.id === selectedClip) ?? null}
            onClipSpeed={(speed, mute) =>
              update((e) => ({
                ...e,
                clips: e.clips.map((c) =>
                  c.id === selectedClip
                    ? { ...c, speed: speed === 1 ? undefined : speed, mute: speed === 1 ? undefined : mute }
                    : c
                )
              }))
            }
            typingCount={typing.length}
            onSpeedUpTyping={(speed) => {
              update((e) => ({
                ...e,
                clips: typing.reduce((cl, [a, b]) => setRangeSpeed(cl, a, b, speed, true), e.clips)
              }))
              setNotice(
                `Sped up ${typing.length} typing section${typing.length === 1 ? '' : 's'} to ${speed}× (muted). Undo with ⌘Z.`
              )
            }}
            onClearSpeed={() => update((e) => ({ ...e, clips: clearSpeed(e.clips) }))}
            onSplit={splitClip}
            onDeleteClip={() => selectedClip && removeClip(selectedClip)}
            playing={playing}
            rate={rate}
            onRate={setRate}
            onToggle={() => player.current?.toggle()}
            onSeek={(t) => player.current?.seek(t)}
            onTrimStart={() => trimTo('start')}
            onTrimEnd={() => trimTo('end')}
            zoomLevel={tlZoom}
            onZoomLevel={setTlZoom}
          />
        </div>

        <SidePanel
          panel={panel}
          onPanel={setPanel}
          project={project}
          edit={edit}
          update={update}
          cursorTracked={tracked}
          clickCount={cursor.clicks.length}
          selectedZoom={sel}
          onSelectZoom={selectZoom}
          onSeek={(t) => player.current?.seek(t)}
          onRegenerateZooms={regenerate}
          onAddZoom={addZoom}
          onDeleteZoom={deleteZoom}
          selectedLayout={edit.layouts.find((l) => l.id === selectedLayout) ?? null}
          onAddLayout={(l) => addLayoutAt(player.current?.time ?? 0, l)}
          onDeleteLayout={deleteLayout}
          cutoutStatus={cutoutStatus}
          selectedMask={edit.masks.find((m) => m.id === selectedMask) ?? null}
          onSelectMask={selectMask}
          onAddMask={addMask}
          onDeleteMask={deleteMask}
          scan={scan}
          faceStatus={faceStatus}
          onFaceTracking={(on) => void setFaceTracking(on)}
          onScan={(k) => void runScan(k)}
          onCancelScan={() => scanAbort.current?.abort()}
          onClearAuto={() => update((e) => ({ ...e, masks: e.masks.filter((m) => !m.auto) }))}
          transcript={
            <TranscriptPanel
              project={project}
              edit={edit}
              update={update}
              time={time}
              onSeek={(t) => player.current?.seek(t)}
              onTranscript={onTranscript}
            />
          }
          unsplash={<UnsplashTab project={project} edit={edit} update={update} />}
          captions={
            <CaptionsPanel
              edit={edit}
              update={update}
              hasTranscript={words.length > 0}
              keys={cursor.keys ?? []}
              mac={(cursor.platform ?? (isMac ? 'darwin' : 'win32')) === 'darwin'}
              onOpenTranscript={() => setPanel('transcript')}
            />
          }
          audio={
            <AudioPanel
              project={project}
              edit={edit}
              update={update}
              time={() => player.current?.time ?? 0}
              selected={edit.sounds.find((x) => x.id === selectedSound) ?? null}
              onSelect={selectSound}
              onDelete={deleteSound}
              player={() => player.current}
              onPreviewMuted={setPreviewMuted}
            />
          }
          isMac={isMac}
        />
      </div>

      <div
        className="shrink-0 border-t border-white/[0.07] bg-black/30 backdrop-blur-2xl"
        style={{
          height:
            132 +
            (2 + (hasCam ? 1 : 0) + (showSoundLanes ? (edit.sounds.some((x) => x.kind === 'voice') ? 3 : 2) : 0)) * 46
        }}
      >
        <Timeline
          duration={project.duration}
          time={time}
          playing={playing}
          zoomLevel={tlZoom}
          onZoomLevel={setTlZoom}
          clips={edit.clips}
          selectedClip={selectedClip}
          onClips={(clips) => update((e) => ({ ...e, clips }), 'clip-drag')}
          onSelectClip={setSelectedClip}
          clicks={cursor.clicks}
          peaks={peaks}
          onSeek={(t) => player.current?.seek(t)}
          lanes={[
            {
              id: 'zoom',
              label: 'Zoom',
              items: edit.zooms,
              selected: selectedZoom,
              tone: 'bg-gradient-to-r from-brand-600 to-brand-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
              render: (z: ZoomSegment, w: number) =>
                w > 56 ? (
                  <>
                    {z.auto && <Sparkles size={11} className="shrink-0 opacity-80" />}
                    {z.scale.toFixed(1)}×
                  </>
                ) : null,
              onChange: setZooms,
              onSelect: selectZoom,
              onAddAt: addZoomAt,
              addLabel: 'Zoom',
              emptyHint: 'Zooms — click here to add one'
            },
            ...(hasCam
              ? [
                  {
                    id: 'layout',
                    label: 'Layout',
                    items: edit.layouts,
                    selected: selectedLayout,
                    tone: 'bg-gradient-to-r from-teal-600 to-emerald-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
                    render: (l: LayoutSegment, w: number) =>
                      w > 70 ? <span className="truncate">{LAYOUT_LABELS[l.layout]}</span> : null,
                    onChange: (items: LayoutSegment[]) => update((e) => ({ ...e, layouts: items }), 'layout-drag'),
                    onSelect: selectLayout,
                    onAddAt: (t: number) => addLayoutAt(t),
                    addLabel: 'Layout',
                    emptyHint: 'Camera layout changes — click to add (e.g. fullscreen camera for an intro)'
                  }
                ]
              : []),
            {
              id: 'privacy',
              label: 'Privacy',
              items: edit.masks,
              selected: selectedMask,
              tone: 'bg-gradient-to-r from-rose-600 to-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
              render: (m: MaskSegment, w: number) =>
                w > 60 ? (
                  <>
                    <EyeOff size={11} className="shrink-0 opacity-80" />
                    <span className="truncate capitalize">{m.style}</span>
                  </>
                ) : null,
              onChange: (items: MaskSegment[]) => update((e) => ({ ...e, masks: items }), 'mask-drag'),
              onSelect: selectMask,
              onAddAt: addMaskAt,
              addLabel: 'Mask',
              emptyHint: 'Privacy masks — click to blur a password, email or key'
            },
            ...(showSoundLanes
              ? (['voice', 'music', 'sfx'] as const)
                  .filter((kind) => kind !== 'voice' || edit.sounds.some((x) => x.kind === 'voice'))
                  .map((kind) => ({
                    id: kind,
                    label: kind === 'music' ? 'Music' : kind === 'voice' ? 'Voice' : 'Sound',
                    items: edit.sounds.filter((x) => x.kind === kind),
                    selected: selectedSound,
                    tone:
                      kind === 'music'
                        ? 'bg-gradient-to-r from-sky-600 to-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                        : kind === 'voice'
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                          : 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]',
                    render: (x: SoundItem, w: number) =>
                      w > 44 ? (
                        <>
                          {kind === 'music' ? (
                            <Music size={11} className="shrink-0 opacity-85" />
                          ) : (
                            <Waveform size={11} className="shrink-0 opacity-85" />
                          )}
                          <span className="truncate">{presetLabel(x.source)}</span>
                        </>
                      ) : null,
                    onChange: (items: SoundItem[]) =>
                      update(
                        (e) => ({
                          ...e,
                          sounds: [...e.sounds.filter((x) => x.kind !== kind), ...items].sort(
                            (a, b) => a.start - b.start
                          )
                        }),
                        `${kind}-drag`
                      ),
                    onSelect: selectSound,
                    onAddAt: (t: number) => {
                      player.current?.seek(t)
                      setSelectedSound(null)
                      setPanel('audio')
                    },
                    addLabel: kind === 'music' ? 'Music' : 'Sound',
                    emptyHint:
                      kind === 'music'
                        ? 'Music — pick a track in the Audio panel'
                        : 'Sound effects — pick one in the Audio panel to drop it at the playhead'
                  }))
              : [])
          ]}
        />
      </div>

      {exporting && (
        <ExportDialog
          project={project}
          edit={edit}
          cursor={cursor}
          words={words}
          faceTrack={faceTrack}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}
