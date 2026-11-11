import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow,
  Check,
  ChevronDown,
  Folder,
  Library,
  Mic,
  MicOff,
  Monitor,
  MonitorSpeaker,
  MonitorX,
  Power,
  Search,
  Settings,
  Smartphone,
  SquareDashed,
  AlertTriangle,
  Video,
  VideoOff,
  X
} from '@renderer/lib/icons'
import type { CaptureSource, ProjectMeta, RecordingOptions } from '@shared/types'
import { RECORDING_BITRATE, type Countdown } from '@shared/settings'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/lib/settings'
import { CaptureSession } from '@renderer/recorder/capture'
import { formatTime } from '@renderer/engine/math'
import { Segmented, ToggleRow, cx } from '@renderer/lib/ui'
import { CameraPreview, MicLevel, deviceLabel, useMediaDevices } from './media'
import { refreshGlass, useGlassInfo, useGlassRegion } from '@renderer/lib/glass'

type Pop = 'display' | 'window' | 'device' | 'camera' | 'mic' | 'recents' | 'settings'
type Perms = { screen: string; camera: string; microphone: string; accessibility: boolean }
type StartOpts = Pick<RecordingOptions, 'kind' | 'sourceId' | 'sourceName' | 'displayId' | 'crop'>

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

function Divider(): React.JSX.Element {
  return <div className="mx-1 h-6 w-px shrink-0 bg-white/[0.1]" />
}

function ModeButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex h-10 items-center gap-2 rounded-full px-3.5 transition-colors',
        active ? 'glass-chip text-white' : 'text-ink-200 hover:bg-white/[0.08] hover:text-white'
      )}
    >
      {icon}
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  )
}

function InputButton({
  on,
  iconOn,
  iconOff,
  label,
  open,
  onClick,
  title
}: {
  on: boolean
  iconOn: ReactNode
  iconOff: ReactNode
  label: string
  open?: boolean
  onClick: () => void
  title?: string
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cx(
        'flex h-10 max-w-[170px] items-center gap-2 rounded-full px-3.5 text-[13px] transition-colors',
        open ? 'glass-chip' : 'hover:bg-white/[0.08]',
        on ? 'text-white' : 'text-ink-300'
      )}
    >
      <span className={cx('shrink-0', on ? 'text-brand-300' : 'text-ink-400')}>{on ? iconOn : iconOff}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function Popover({
  children,
  align = 'center',
  width,
  title,
  action
}: {
  children: ReactNode
  align?: 'center' | 'left' | 'right'
  width: number
  title?: string
  action?: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useGlassRegion(ref, 'popover', 22)
  return (
    <div
      ref={ref}
      data-interactive
      data-no-drag
      style={{ width }}
      className={cx(
        'glass-strong absolute bottom-full mb-4 cursor-default overflow-hidden rounded-[22px] text-ink-100',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'left' && 'left-0',
        align === 'right' && 'right-0'
      )}
    >
      {title && (
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <span className="text-[13px] font-semibold">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Row({
  selected,
  onClick,
  icon,
  children,
  right
}: {
  selected?: boolean
  onClick: () => void
  icon?: ReactNode
  children: ReactNode
  right?: ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] hover:bg-white/[0.07]"
    >
      <span className="grid w-4 shrink-0 place-items-center text-brand-300">
        {selected ? <Check size={15} /> : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
  )
}

function SourceTile({
  src,
  onClick,
  big
}: {
  src: CaptureSource
  onClick: () => void
  big?: boolean
}): React.JSX.Element {
  return (
    <button onClick={onClick} className="group rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.07]">
      <div
        className={cx(
          'relative overflow-hidden rounded-lg bg-black ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-brand-400',
          big ? 'aspect-video' : 'aspect-[16/10]'
        )}
      >
        {src.thumbnail && <img src={src.thumbnail} alt="" className="size-full object-contain" />}
        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-[#fff] shadow-lg">
            <span className="size-2 rounded-full bg-[#fff]" /> Record
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 px-0.5 pt-1.5 text-xs text-ink-200">
        {src.appIcon && <img src={src.appIcon} alt="" className="size-3.5" />}
        <span className="truncate">{src.name}</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

/**
 * What went wrong starting a recording, in words people can act on. Screen access is the usual
 * cause on a Mac: macOS refuses quietly until Toom is allowed (and reopened).
 */
function recordingError(err: unknown, isMac: boolean): string {
  const raw = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (/NotAllowed|Permission|denied|not permitted|NotReadable|Could not start video source|AbortError/i.test(raw))
    return isMac
      ? 'Toom can’t see your screen. Allow Toom in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Toom.'
      : 'Toom can’t capture your screen. Check that no other app is blocking screen capture, then try again.'
  if (/NotFound|Requested device not found/i.test(raw)) return 'The camera or microphone you picked isn’t available. Choose another in the recording bar.'
  return `Recording couldn’t start: ${raw}`
}

export function Launcher(): React.JSX.Element {
  const { settings, set } = useSettings()
  const { cameras, mics, unlock } = useMediaDevices()
  const [platform, setPlatform] = useState('darwin')
  const [open, setOpen] = useState<Pop | null>(null)
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [perm, setPerm] = useState<Perms | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const session = useRef<CaptureSession | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const glass = useGlassInfo()
  useGlassRegion(barRef, 'bar', 28)
  const ignoring = useRef(true)
  const isMac = platform === 'darwin'

  // click-through: only the bar and popovers catch the mouse
  const onMouseMove = (e: React.MouseEvent): void => {
    const interactive = !!(e.target as HTMLElement).closest('[data-interactive]')
    if (interactive === !ignoring.current) return
    ignoring.current = !interactive
    void api.launcher.setIgnoreMouse(!interactive)
  }

  const refreshPerm = useCallback(() => void api.permissions.status().then(setPerm), [])

  useEffect(() => {
    void api.platform().then(setPlatform)
    refreshPerm()
    void api.projects.list().then(setProjects)
    const offs = [
      api.projects.onChanged(() => void api.projects.list().then(setProjects)),
      api.launcher.onShown(() => {
        setOpen(null)
        refreshPerm()
        refreshGlass()
      }),
      api.launcher.onHidden(() => setOpen(null)),
      api.rec.onError((m) => {
        console.error('[rec] recording failed', m)
        session.current = null
        setBusy(null)
        setError(recordingError(m, isMac))
      })
    ]
    const onBlur = (): void => setOpen(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT' && query) return
      setOpen((cur) => {
        if (!cur) void api.launcher.hide()
        return null
      })
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [refreshPerm, query])

  // load sources when a picker opens
  useEffect(() => {
    if (open !== 'display' && open !== 'window') return
    setSources(null)
    setQuery('')
    let alive = true
    void api.listSources([open === 'display' ? 'screen' : 'window']).then((s) => alive && setSources(s))
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (open === 'camera' || open === 'device') void unlock('video')
    if (open === 'mic') void unlock('audio')
  }, [open, unlock])

  const toggle = (p: Pop): void => setOpen((cur) => (cur === p ? null : p))

  const start = useCallback(
    async (opts: StartOpts) => {
      if (!settings || busy) return
      setOpen(null)
      setError(null)
      setBusy('Starting…')
      const d = settings.devices
      const camera = !!d.cameraId && !(opts.kind === 'device' && opts.sourceId === d.cameraId)
      const microphone = !!d.microphoneId
      if (isMac && camera && perm?.camera !== 'granted') await api.permissions.request('camera')
      if (isMac && microphone && perm?.microphone !== 'granted') await api.permissions.request('microphone')
      const s = new CaptureSession(
        { ...opts, camera, microphone, systemAudio: d.systemAudio && opts.kind !== 'device' },
        {
          cameraId: d.cameraId ?? undefined,
          microphoneId: d.microphoneId && d.microphoneId !== 'default' ? d.microphoneId : undefined,
          fps: settings.recording.fps,
          bitrate: RECORDING_BITRATE[settings.recording.quality],
          noiseSuppression: settings.recording.noiseSuppression,
          echoCancellation: settings.recording.echoCancellation
        }
      )
      try {
        await s.acquire()
        session.current = s
        await s.run() // main hides the launcher and drives the session from here
        setBusy(null)
      } catch (err) {
        console.error('[rec] could not start', opts.kind, err)
        s.cleanup()
        session.current = null
        setBusy(null)
        setError(recordingError(err, isMac))
        void api.app.showLauncher()
      }
    },
    [settings, busy, isMac, perm]
  )

  const pickArea = async (): Promise<void> => {
    setOpen(null)
    const r = await api.area.pick()
    if (!r) return
    const screens = await api.listSources(['screen'])
    const src = screens.find((s) => s.displayId === r.displayId) ?? screens[0]
    if (!src) {
      setError('Could not find the display to record.')
      void api.app.showLauncher()
      return
    }
    await start({ kind: 'area', sourceId: src.id, sourceName: src.name, displayId: r.displayId, crop: r.rect })
  }

  const filteredWindows = useMemo(
    () => (sources ?? []).filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
    [sources, query]
  )

  if (!settings) return <div className="h-full" />
  const d = settings.devices
  const cam = cameras.find((c) => c.deviceId === d.cameraId)
  const mic = d.microphoneId === 'default' ? undefined : mics.find((m) => m.deviceId === d.microphoneId)
  const camOn = !!d.cameraId
  const micOn = !!d.microphoneId
  const screenDenied = isMac && perm && perm.screen !== 'granted'
  const setDevices = (patch: Partial<typeof d>): void => set({ devices: patch })

  return (
    <div
      className="flex h-full flex-col items-center justify-end pb-3"
      onMouseMove={onMouseMove}
      // without native glass nothing behind the window can be blurred, so the material is tinted more
      style={glass && !glass.regions ? ({ '--glass-min-a': 0.88 } as React.CSSProperties) : undefined}
    >
      {/* toast */}
      {error && (
        <div
          data-interactive
          className="mb-3 flex max-w-[640px] items-center gap-2.5 rounded-xl bg-red-500/95 px-3.5 py-2.5 text-[13px] text-[#fff] shadow-xl"
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="grid size-6 place-items-center rounded-md hover:bg-white/15"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div
        ref={barRef}
        data-interactive
        // drag the bar by any empty spot (or the grip); buttons keep working as usual
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.screenX, y: e.screenY }
          setDragging(true)
          api.launcher.dragStart()
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          api.launcher.drag(e.screenX - drag.current.x, e.screenY - drag.current.y)
          refreshGlass()
        }}
        onPointerUp={(e) => {
          if (!drag.current) return
          drag.current = null
          setDragging(false)
          e.currentTarget.releasePointerCapture(e.pointerId)
          api.launcher.dragEnd()
          refreshGlass()
        }}
        onPointerCancel={() => {
          if (!drag.current) return
          drag.current = null
          setDragging(false)
          api.launcher.dragEnd()
        }}
        className={cx(
          'glass glass-flat relative flex h-14 items-center gap-0.5 rounded-full pr-2 pl-2 text-ink-100',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          busy && 'pointer-events-none'
        )}
      >
        <span title="Drag to move" className="grid h-10 w-5 shrink-0 place-items-center text-ink-400" aria-hidden>
          <svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor">
            {[0, 5, 10].map((y) => (
              <g key={y}>
                <circle cx="1" cy={y + 2} r="1" />
                <circle cx="5" cy={y + 2} r="1" />
              </g>
            ))}
          </svg>
        </span>
        {busy && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-full bg-black/50 text-sm font-medium backdrop-blur-md">
            <span className="flex items-center gap-2.5">
              <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> {busy}
            </span>
          </div>
        )}

        <button
          title="Close"
          onClick={() => void api.launcher.hide()}
          className="mr-1 ml-0.5 grid size-9 place-items-center rounded-full bg-ink-100 text-ink-900 transition-transform hover:scale-105"
        >
          <X size={15} strokeWidth={2.75} />
        </button>
        <Divider />

        {/* capture modes */}
        <div className="relative">
          <ModeButton
            icon={<Monitor size={19} strokeWidth={1.7} />}
            label="Display"
            active={open === 'display'}
            onClick={() => toggle('display')}
          />
          {open === 'display' && (
            <Popover title="Choose a display" width={sources && sources.length > 1 ? 560 : 400} align="left">
              {screenDenied && (
                <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/20">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span className="flex-1">Screen Recording permission is off.</span>
                  <button className="font-medium underline" onClick={() => void api.permissions.request('screen')}>
                    Open Settings
                  </button>
                </div>
              )}
              <div
                className={cx('grid gap-1 px-2 pb-2', sources && sources.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}
              >
                {sources === null && (
                  <div className="col-span-full py-10 text-center text-xs text-ink-400">Loading displays…</div>
                )}
                {sources?.map((s) => (
                  <SourceTile
                    key={s.id}
                    src={s}
                    big
                    onClick={() =>
                      void start({ kind: 'screen', sourceId: s.id, sourceName: s.name, displayId: s.displayId })
                    }
                  />
                ))}
              </div>
            </Popover>
          )}
        </div>

        <div className="relative">
          <ModeButton
            icon={<AppWindow size={19} strokeWidth={1.7} />}
            label="Window"
            active={open === 'window'}
            onClick={() => toggle('window')}
          />
          {open === 'window' && (
            <Popover
              title="Choose a window"
              width={600}
              align="left"
              action={
                <label className="flex h-7 w-52 items-center gap-1.5 rounded-lg bg-black/30 px-2 ring-1 ring-white/10 focus-within:ring-brand-500">
                  <Search size={13} className="text-ink-400" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search windows"
                    className="w-full bg-transparent text-xs outline-none placeholder:text-ink-500"
                  />
                </label>
              }
            >
              <div className="grid max-h-[400px] grid-cols-3 gap-1 overflow-y-auto px-2 pb-2">
                {sources === null && (
                  <div className="col-span-full py-10 text-center text-xs text-ink-400">Loading windows…</div>
                )}
                {sources && filteredWindows.length === 0 && (
                  <div className="col-span-full py-10 text-center text-xs text-ink-400">No windows found.</div>
                )}
                {filteredWindows.map((s) => (
                  <SourceTile
                    key={s.id}
                    src={s}
                    onClick={() => void start({ kind: 'window', sourceId: s.id, sourceName: s.name })}
                  />
                ))}
              </div>
              <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-ink-400">
                Auto zoom follows the window. Keep it on one display while recording.
              </p>
            </Popover>
          )}
        </div>

        <ModeButton icon={<SquareDashed size={19} strokeWidth={1.7} />} label="Area" onClick={() => void pickArea()} />

        <div className="relative">
          <ModeButton
            icon={<Smartphone size={19} strokeWidth={1.7} />}
            label="Device"
            active={open === 'device'}
            onClick={() => toggle('device')}
          />
          {open === 'device' && (
            <Popover title="Record a device" width={340}>
              <div className="px-1.5 pb-1.5">
                {cameras.length === 0 && <p className="px-2.5 py-3 text-xs text-ink-400">No video devices found.</p>}
                {cameras.map((c) => (
                  <Row
                    key={c.deviceId}
                    icon={<Smartphone size={14} className="text-ink-400" />}
                    onClick={() =>
                      void start({ kind: 'device', sourceId: c.deviceId, sourceName: deviceLabel(c, 'Video device') })
                    }
                  >
                    {deviceLabel(c, 'Video device')}
                  </Row>
                ))}
              </div>
              <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11px] leading-relaxed text-ink-400">
                Records capture cards, cameras and Continuity Camera. Direct iPhone/iPad screen capture over USB arrives
                with the native capture helper.
              </p>
            </Popover>
          )}
        </div>

        <Divider />

        {/* inputs */}
        <div className="relative">
          <InputButton
            on={camOn}
            open={open === 'camera'}
            iconOn={<Video size={18} />}
            iconOff={<VideoOff size={18} />}
            label={camOn ? deviceLabel(cam, 'Camera') : 'No camera'}
            onClick={() => toggle('camera')}
          />
          {open === 'camera' && (
            <Popover width={300} title="Camera">
              {camOn && d.cameraId && (
                <CameraPreview
                  deviceId={d.cameraId}
                  className="mx-3 mb-2 aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
                />
              )}
              <div className="px-1.5 pb-1.5">
                <Row selected={!camOn} onClick={() => setDevices({ cameraId: null })}>
                  No camera
                </Row>
                {cameras.map((c) => (
                  <Row
                    key={c.deviceId}
                    selected={d.cameraId === c.deviceId}
                    onClick={() => setDevices({ cameraId: c.deviceId })}
                  >
                    {deviceLabel(c, 'Camera')}
                  </Row>
                ))}
              </div>
            </Popover>
          )}
        </div>

        <div className="relative">
          <InputButton
            on={micOn}
            open={open === 'mic'}
            iconOn={<Mic size={18} />}
            iconOff={<MicOff size={18} />}
            label={
              micOn ? (d.microphoneId === 'default' ? 'Default mic' : deviceLabel(mic, 'Microphone')) : 'No microphone'
            }
            onClick={() => toggle('mic')}
          />
          {open === 'mic' && (
            <Popover width={300} title="Microphone">
              {micOn && d.microphoneId && (
                <div className="px-4 pb-3">
                  <MicLevel deviceId={d.microphoneId} />
                </div>
              )}
              <div className="px-1.5 pb-1.5">
                <Row selected={!micOn} onClick={() => setDevices({ microphoneId: null })}>
                  No microphone
                </Row>
                <Row selected={d.microphoneId === 'default'} onClick={() => setDevices({ microphoneId: 'default' })}>
                  System default
                </Row>
                {mics
                  .filter((m) => m.deviceId !== 'default')
                  .map((m) => (
                    <Row
                      key={m.deviceId}
                      selected={d.microphoneId === m.deviceId}
                      onClick={() => setDevices({ microphoneId: m.deviceId })}
                    >
                      {deviceLabel(m, 'Microphone')}
                    </Row>
                  ))}
              </div>
            </Popover>
          )}
        </div>

        <InputButton
          on={d.systemAudio}
          iconOn={<MonitorSpeaker size={18} />}
          iconOff={<MonitorX size={18} />}
          label={d.systemAudio ? 'System audio' : 'No system audio'}
          title={isMac ? 'System audio (macOS 13+, experimental)' : 'Record what you hear'}
          onClick={() => setDevices({ systemAudio: !d.systemAudio })}
        />

        <Divider />

        {/* recents */}
        <div className="relative">
          <button
            title="Recent recordings"
            onClick={() => toggle('recents')}
            className={cx(
              'grid size-10 place-items-center rounded-full text-ink-200 hover:bg-white/[0.08] hover:text-white',
              open === 'recents' && 'glass-chip text-white'
            )}
          >
            <Folder size={19} strokeWidth={1.7} />
          </button>
          {open === 'recents' && (
            <Popover
              width={360}
              align="right"
              title="Recent recordings"
              action={
                <button
                  className="flex items-center gap-1 text-xs text-brand-300 hover:text-brand-400"
                  onClick={() => void api.app.showLibrary()}
                >
                  <Library size={13} /> Library
                </button>
              }
            >
              <div className="max-h-[380px] overflow-y-auto px-1.5 pb-1.5">
                {projects.length === 0 && (
                  <p className="px-2.5 py-6 text-center text-xs text-ink-400">No recordings yet.</p>
                )}
                {projects.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setOpen(null)
                      void api.projects.open(p.id)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-white/[0.07]"
                  >
                    <span className="h-11 w-[70px] shrink-0 overflow-hidden rounded-md bg-ink-700 ring-1 ring-white/10">
                      {p.thumbnail && <img src={p.thumbnail} alt="" className="size-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{p.name}</span>
                      <span className="block text-[11px] text-ink-400">
                        {formatTime(p.duration)} ·{' '}
                        {new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {/* quick settings */}
        <div className="relative">
          <button
            title="Settings"
            onClick={() => toggle('settings')}
            className={cx(
              'flex h-10 items-center gap-1 rounded-full pr-2.5 pl-3 text-ink-200 hover:bg-white/[0.08] hover:text-white',
              open === 'settings' && 'glass-chip text-white'
            )}
          >
            <Settings size={19} strokeWidth={1.7} />
            <ChevronDown size={15} className={cx('transition-transform', open === 'settings' && 'rotate-180')} />
          </button>
          {open === 'settings' && (
            <Popover width={320} align="right" title="Recording">
              <div className="px-4 pb-1">
                <div className="mb-1.5 text-xs text-ink-300">Countdown</div>
                <div className="mb-4">
                  <Segmented<Countdown>
                    size="sm"
                    value={settings.recording.countdown}
                    onChange={(v) => set({ recording: { countdown: v } })}
                    options={[
                      { value: 0, label: 'Off' },
                      { value: 3, label: '3s' },
                      { value: 5, label: '5s' },
                      { value: 10, label: '10s' }
                    ]}
                  />
                </div>
                <div className="mb-1.5 text-xs text-ink-300">Quality</div>
                <div className="mb-4">
                  <Segmented
                    size="sm"
                    value={settings.recording.quality}
                    onChange={(v) => set({ recording: { quality: v } })}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'high', label: 'High' },
                      { value: 'max', label: 'Max' }
                    ]}
                  />
                </div>
                <ToggleRow
                  label="Open editor when done"
                  on={settings.recording.openEditorAfterRecording}
                  onChange={(v) => set({ recording: { openEditorAfterRecording: v } })}
                />
                <ToggleRow
                  label="Track clicks for auto zoom"
                  on={settings.advanced.clickTracking}
                  onChange={(v) => set({ advanced: { clickTracking: v } })}
                  hint={
                    settings.advanced.clickTracking && perm && !perm.accessibility ? (
                      <span>
                        Needs {isMac ? 'Accessibility' : 'input'} permission.{' '}
                        {isMac && (
                          <button
                            className="text-brand-300 underline"
                            onClick={() => void api.permissions.request('accessibility').then(refreshPerm)}
                          >
                            Grant access
                          </button>
                        )}
                      </span>
                    ) : undefined
                  }
                />
              </div>
              <div className="mt-1 border-t border-white/[0.06] p-1.5">
                <Row
                  icon={<Settings size={14} className="text-ink-400" />}
                  onClick={() => {
                    setOpen(null)
                    void api.app.showSettings('general')
                  }}
                  right={<span className="text-[11px] text-ink-500">{isMac ? '⌘,' : 'Ctrl+,'}</span>}
                >
                  Advanced settings…
                </Row>
                {settings.general.launcherOffset && (
                  <Row
                    icon={<span className="size-3.5 rounded-full border border-ink-400" />}
                    onClick={() => void api.launcher.resetPosition()}
                  >
                    Move bar back to the bottom
                  </Row>
                )}
                <Row
                  icon={<Library size={14} className="text-ink-400" />}
                  onClick={() => {
                    setOpen(null)
                    void api.app.showLibrary()
                  }}
                >
                  Open library
                </Row>
                <Row icon={<Power size={14} className="text-ink-400" />} onClick={() => void api.app.quit()}>
                  Quit Toom
                </Row>
              </div>
            </Popover>
          )}
        </div>
      </div>
    </div>
  )
}
