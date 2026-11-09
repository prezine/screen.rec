import { useMemo, useState } from 'react'
import { ImageTab } from './ImageSources'
import {
  Image as ImageIcon,
  Subtitle,
  Plus,
  Keyboard,
  MousePointer2,
  Shuffle,
  SquareRoundCorner,
  Sparkles,
  Trash,
  Video,
  Volume2,
  ZoomIn,
  EyeOff,
  Blur,
  Pixelate,
  Captions
} from '@renderer/lib/icons'
import type {
  AspectRatio,
  BackgroundKind,
  CameraCorner,
  CameraLayout,
  ClickEffect,
  CursorStyle,
  EditState,
  LayoutSegment,
  MaskSegment,
  MaskStyle,
  ProjectMeta,
  ZoomSegment
} from '@shared/types'
import { LAYOUT_LABELS } from '@renderer/engine/layout'
import { PRIVACY_LABELS, type PrivacyKind } from '@shared/privacy'
import { defaultEditState } from '@shared/defaults'
import { GRADIENTS, SOLIDS, WALLPAPERS, gradientCss, wallpaperCss } from '@renderer/engine/backgrounds'
import { formatTime } from '@renderer/engine/math'
import {
  Button,
  Field,
  IconButton,
  Kbd,
  Pills,
  Section,
  Segmented,
  Slider,
  Swatch,
  ToggleRow,
  cx
} from '@renderer/lib/ui'

export type PanelId =
  'background' | 'frame' | 'cursor' | 'zoom' | 'camera' | 'privacy' | 'transcript' | 'captions' | 'audio' | 'shortcuts'

export type Update = (fn: (e: EditState) => EditState, key?: string) => void

interface Props {
  panel: PanelId
  onPanel: (p: PanelId) => void
  project: ProjectMeta
  edit: EditState
  update: Update
  cursorTracked: boolean
  clickCount: number
  selectedZoom: ZoomSegment | null
  onSelectZoom: (id: string | null) => void
  onSeek: (t: number) => void
  onRegenerateZooms: () => void
  onAddZoom: () => void
  onDeleteZoom: (id: string) => void
  selectedLayout: LayoutSegment | null
  onAddLayout: (layout: CameraLayout) => void
  onDeleteLayout: (id: string) => void
  cutoutStatus: { state: 'idle' | 'loading' | 'ready' | 'error'; message?: string }
  selectedMask: MaskSegment | null
  onSelectMask: (id: string | null) => void
  onAddMask: () => void
  onDeleteMask: (id: string) => void
  scan: { progress: number; label: string } | null
  onScan: (kinds: PrivacyKind[]) => void
  onCancelScan: () => void
  onClearAuto: () => void
  faceStatus: { state: 'idle' | 'analysing' | 'error'; progress?: number; message?: string }
  onFaceTracking: (on: boolean) => void
  transcript: React.ReactNode
  captions: React.ReactNode
  audio: React.ReactNode
  unsplash: React.ReactNode
  isMac: boolean
}

const RAIL: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'background', label: 'Background', icon: <ImageIcon size={19} /> },
  { id: 'frame', label: 'Frame & layout', icon: <SquareRoundCorner size={19} /> },
  { id: 'cursor', label: 'Cursor', icon: <MousePointer2 size={19} /> },
  { id: 'zoom', label: 'Zoom', icon: <ZoomIn size={19} /> },
  { id: 'camera', label: 'Camera & layout', icon: <Video size={19} /> },
  { id: 'privacy', label: 'Privacy masks', icon: <EyeOff size={19} /> },
  { id: 'transcript', label: 'Transcript', icon: <Subtitle size={19} /> },
  { id: 'captions', label: 'Captions & keys', icon: <Captions size={19} /> },
  { id: 'audio', label: 'Audio & music', icon: <Volume2 size={19} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={19} /> }
]

const pct = (v: number): string => `${Math.round(v * 100)}%`

export function SidePanel(p: Props): React.JSX.Element {
  const D = useMemo(() => defaultEditState(1, true), [])
  return (
    <div className="flex min-h-0 shrink-0">
      <nav className="glass mt-3 mr-2 flex w-[52px] flex-col items-center gap-1 self-start rounded-[22px] p-1.5">
        {RAIL.map((r) => (
          <IconButton
            key={r.id}
            label={r.label}
            tooltipSide="left"
            active={p.panel === r.id}
            onClick={() => p.onPanel(r.id)}
            className="size-10 rounded-xl"
          >
            {r.icon}
          </IconButton>
        ))}
      </nav>
      <aside className="glass my-3 mr-3 flex w-[340px] min-h-0 flex-col overflow-hidden rounded-[22px]">
        {p.panel === 'transcript' ? (
          <div className="min-h-0 flex-1">{p.transcript}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {p.panel === 'background' && <BackgroundPanel {...p} />}
            {p.panel === 'frame' && <FramePanel {...p} D={D} />}
            {p.panel === 'cursor' && <CursorPanel {...p} D={D} />}
            {p.panel === 'zoom' && <ZoomPanel {...p} D={D} />}
            {p.panel === 'camera' && <CameraPanel {...p} D={D} />}
            {p.panel === 'privacy' && <PrivacyPanel {...p} />}
            {p.panel === 'audio' && p.audio}
            {p.panel === 'captions' && p.captions}
            {p.panel === 'shortcuts' && <ShortcutsPanel isMac={p.isMac} />}
          </div>
        )}
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------

type BgTab = 'wallpaper' | 'gradient' | 'solid' | 'image' | 'unsplash'

function BackgroundPanel({ edit, update, project, unsplash }: Props): React.JSX.Element {
  const bg = edit.background
  const setBg = (kind: BackgroundKind, value: string): void =>
    update((e) => ({ ...e, background: { ...e.background, kind, value, credit: undefined } }))
  const initial: BgTab =
    bg.kind === 'none'
      ? 'wallpaper'
      : bg.kind === 'image'
        ? bg.credit?.source === 'Unsplash'
          ? 'unsplash'
          : 'image'
        : bg.kind
  const [tab, setTab] = useState<BgTab>(initial)

  const switchTab = (k: BgTab): void => {
    setTab(k)
    if (k === 'wallpaper' && bg.kind !== 'wallpaper') setBg('wallpaper', WALLPAPERS[0].id)
    else if (k === 'gradient' && bg.kind !== 'gradient') setBg('gradient', GRADIENTS[0].id)
    else if (k === 'solid' && bg.kind !== 'solid') setBg('solid', SOLIDS[0])
  }

  return (
    <>
      <Section title="Background">
        <Pills<BgTab>
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'wallpaper', label: 'Wallpaper' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'solid', label: 'Color' },
            { value: 'image', label: 'Image' },
            { value: 'unsplash', label: 'Unsplash' }
          ]}
        />
      </Section>

      {tab === 'wallpaper' && (
        <Section
          title="Wallpaper"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const pool = WALLPAPERS.filter((w) => w.id !== bg.value)
                setBg('wallpaper', pool[Math.floor(Math.random() * pool.length)].id)
              }}
            >
              <Shuffle size={13} /> Random
            </Button>
          }
        >
          {(['Vivid', 'Soft', 'Dark'] as const).map((g) => (
            <div key={g} className="mb-4 last:mb-0">
              <div className="mb-2 text-[11px] font-medium tracking-wide text-ink-400 uppercase">{g}</div>
              <div className="grid grid-cols-6 gap-2">
                {WALLPAPERS.filter((w) => w.group === g).map((w) => (
                  <Swatch
                    key={w.id}
                    title={w.name}
                    background={wallpaperCss(w)}
                    selected={bg.kind === 'wallpaper' && bg.value === w.id}
                    onClick={() => setBg('wallpaper', w.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {tab === 'gradient' && (
        <Section title="Gradient">
          <div className="grid grid-cols-6 gap-2">
            {GRADIENTS.map((g) => (
              <Swatch
                key={g.id}
                title={g.name}
                background={gradientCss(g)}
                selected={bg.kind === 'gradient' && bg.value === g.id}
                onClick={() => setBg('gradient', g.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {tab === 'solid' && (
        <Section title="Color">
          <div className="grid grid-cols-6 gap-2">
            {SOLIDS.map((c) => (
              <Swatch
                key={c}
                background={c}
                selected={bg.kind === 'solid' && bg.value === c}
                onClick={() => setBg('solid', c)}
              />
            ))}
            <label
              title="Custom colour"
              className="relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-[10px] ring-1 ring-white/10"
              style={{
                background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)'
              }}
            >
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={bg.kind === 'solid' ? bg.value : '#222222'}
                onChange={(e) => setBg('solid', e.target.value)}
              />
            </label>
          </div>
        </Section>
      )}

      {tab === 'image' && (
        <Section title="Image">
          <ImageTab project={project} edit={edit} update={update} />
        </Section>
      )}

      {tab === 'unsplash' && <Section title="Unsplash">{unsplash}</Section>}

      <Section title="Background blur">
        <Slider
          value={bg.blur}
          min={0}
          max={1}
          defaultValue={0}
          format={pct}
          onChange={(v) => update((e) => ({ ...e, background: { ...e.background, blur: v } }), 'bg-blur')}
        />
      </Section>
    </>
  )
}

function FramePanel({ edit, update, D }: Props & { D: EditState }): React.JSX.Element {
  const set = <K extends 'padding' | 'radius' | 'shadow'>(k: K, v: number): void => update((e) => ({ ...e, [k]: v }), k)
  return (
    <>
      <Section title="Aspect ratio">
        <Segmented<AspectRatio>
          value={edit.aspect}
          onChange={(v) => update((e) => ({ ...e, aspect: v }))}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: '16:9', label: '16:9' },
            { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1' },
            { value: '9:16', label: '9:16' }
          ]}
        />
      </Section>
      <Section title="Shape">
        <Slider
          label="Padding"
          value={edit.padding}
          min={0}
          max={0.25}
          defaultValue={D.padding}
          format={(v) => pct(v / 0.25)}
          onChange={(v) => set('padding', v)}
        />
        <Slider
          label="Roundness"
          value={edit.radius}
          min={0}
          max={0.08}
          step={0.001}
          defaultValue={D.radius}
          format={(v) => pct(v / 0.08)}
          onChange={(v) => set('radius', v)}
        />
        <Slider
          label="Shadow"
          value={edit.shadow}
          min={0}
          max={1}
          defaultValue={D.shadow}
          format={pct}
          onChange={(v) => set('shadow', v)}
        />
      </Section>
    </>
  )
}

const CURSOR_STYLES: { value: CursorStyle; label: string; icon: React.ReactNode }[] = [
  {
    value: 'arrow',
    label: 'Arrow',
    icon: (
      <svg viewBox="0 0 24 24" className="size-6">
        <path
          d="M6 3v15.5l4.2-3.9 2.9 6.4 2.6-1.2-2.9-6.2h5.8z"
          fill="#111"
          stroke="#fff"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    value: 'arrow-light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 24 24" className="size-6">
        <path
          d="M6 3v15.5l4.2-3.9 2.9 6.4 2.6-1.2-2.9-6.2h5.8z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    value: 'dot',
    label: 'Dot',
    icon: (
      <svg viewBox="0 0 24 24" className="size-6">
        <circle cx="12" cy="12" r="5" fill="#111" stroke="#fff" strokeWidth="1.6" />
      </svg>
    )
  },
  {
    value: 'ring',
    label: 'Ring',
    icon: (
      <svg viewBox="0 0 24 24" className="size-6">
        <circle cx="12" cy="12" r="7" fill="rgba(255,255,255,0.18)" stroke="#fff" strokeWidth="1.8" />
      </svg>
    )
  }
]

const CLICK_EFFECTS: { value: ClickEffect; label: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'None', icon: <span className="size-5 rounded-full border border-dashed border-ink-500" /> },
  { value: 'ripple', label: 'Ripple', icon: <span className="size-5 rounded-full border-2 border-white/80" /> },
  { value: 'circle', label: 'Circle', icon: <span className="size-5 rounded-full bg-[rgba(80,140,255,0.6)]" /> },
  {
    value: 'glass',
    label: 'Glass',
    icon: (
      <span
        className="relative size-6 rounded-full ring-1 ring-white/70"
        style={{
          background:
            'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.75) 0 12%, rgba(255,255,255,0.15) 40%, rgba(255,255,255,0.05) 70%, rgba(255,255,255,0.3) 100%)'
        }}
      />
    )
  }
]

function OptionTiles<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: { value: T; label: string; icon: React.ReactNode }[]
  onChange: (v: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium transition-colors disabled:opacity-40',
            value === o.value
              ? 'glass-chip text-white'
              : 'bg-white/[0.03] text-ink-300 ring-1 ring-white/[0.05] hover:bg-white/[0.07]'
          )}
        >
          <span className="grid h-6 place-items-center">{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CursorPanel({ edit, update, cursorTracked, D }: Props & { D: EditState }): React.JSX.Element {
  const setC = <K extends keyof EditState['cursor']>(k: K, v: EditState['cursor'][K], key?: string): void =>
    update((e) => ({ ...e, cursor: { ...e.cursor, [k]: v } }), key)
  const setBlur = (k: 'cursor' | 'camera', v: number): void =>
    update((e) => ({ ...e, motionBlur: { ...e.motionBlur, [k]: v } }), `blur-${k}`)
  return (
    <>
      {!cursorTracked && (
        <div className="mx-5 mt-5 rounded-xl bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          This recording has no cursor data (window capture), so cursor effects are unavailable.
        </div>
      )}
      <Section title="Cursor">
        <ToggleRow
          label="Show custom cursor"
          on={edit.cursor.overlay}
          onChange={(v) => setC('overlay', v)}
          disabled={!cursorTracked}
          hint="Draws a smooth, restyled cursor. The system cursor is still in the raw capture for now — hiding it needs the native capture helper."
        />
        <Field label="Style">
          <OptionTiles
            value={edit.cursor.style}
            options={CURSOR_STYLES}
            onChange={(v) => update((e) => ({ ...e, cursor: { ...e.cursor, style: v, overlay: true } }))}
            disabled={!cursorTracked}
          />
        </Field>
        <Slider
          label="Size"
          value={edit.cursor.size}
          min={0.6}
          max={3}
          defaultValue={D.cursor.size}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => setC('size', v, 'c-size')}
        />
        <Slider
          label="Movement smoothing"
          value={edit.cursor.smoothing}
          min={0}
          max={1}
          defaultValue={D.cursor.smoothing}
          format={pct}
          onChange={(v) => setC('smoothing', v, 'c-smooth')}
        />
        <ToggleRow label="Highlight cursor" on={edit.cursor.highlight} onChange={(v) => setC('highlight', v)} />
      </Section>
      <Section title="Click effect">
        <OptionTiles value={edit.cursor.clickEffect} options={CLICK_EFFECTS} onChange={(v) => setC('clickEffect', v)} />
      </Section>
      <Section title="Motion blur">
        <Slider
          label="Cursor"
          value={edit.motionBlur.cursor}
          min={0}
          max={1}
          defaultValue={D.motionBlur.cursor}
          format={(v) => (v === 0 ? 'Off' : pct(v))}
          onChange={(v) => setBlur('cursor', v)}
        />
        <Slider
          label="Camera movement"
          value={edit.motionBlur.camera}
          min={0}
          max={1}
          defaultValue={D.motionBlur.camera}
          format={(v) => (v === 0 ? 'Off' : pct(v))}
          onChange={(v) => setBlur('camera', v)}
        />
        <p className="text-[11px] leading-relaxed text-ink-400">
          Blurs fast cursor moves and zoom/pan transitions, like a real camera shutter.
        </p>
      </Section>
    </>
  )
}

function ZoomPanel(p: Props & { D: EditState }): React.JSX.Element {
  const { edit, update, selectedZoom: sel } = p
  return (
    <>
      <Section title="Zoom">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button onClick={p.onAddZoom}>
            <ZoomIn size={14} /> Add zoom
          </Button>
          <Button onClick={p.onRegenerateZooms} disabled={!p.cursorTracked}>
            <Sparkles size={14} /> Auto zoom
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-400">
          {p.cursorTracked
            ? `Auto zoom follows ${p.clickCount > 0 ? `your ${p.clickCount} clicks` : 'where your cursor settles (no clicks were recorded)'}. Re-running it keeps zooms you edited.`
            : 'No cursor data — zooms will focus on the centre.'}
        </p>
      </Section>
      <Section title="Camera movement">
        <Slider
          label="Follow"
          value={edit.zoomFollow}
          min={0}
          max={1}
          defaultValue={p.D.zoomFollow}
          format={(v) => (v < 0.33 ? 'Tight' : v < 0.66 ? 'Smooth' : 'Lazy')}
          onChange={(v) => update((e) => ({ ...e, zoomFollow: v }), 'follow')}
        />
      </Section>
      {sel && (
        <Section
          title="Selected zoom"
          action={
            <Button size="sm" variant="danger" onClick={() => p.onDeleteZoom(sel.id)}>
              <Trash size={13} /> Delete
            </Button>
          }
        >
          <Slider
            label="Zoom level"
            value={sel.scale}
            min={1.1}
            max={4}
            defaultValue={2}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) =>
              update(
                (e) => ({ ...e, zooms: e.zooms.map((z) => (z.id === sel.id ? { ...z, scale: v, auto: false } : z)) }),
                `zl-${sel.id}`
              )
            }
          />
          <div className="text-[11px] text-ink-400 tabular-nums">
            {formatTime(sel.start, true)} → {formatTime(sel.end, true)} · {(sel.end - sel.start).toFixed(1)}s
          </div>
        </Section>
      )}
      <Section title={`All zooms (${edit.zooms.length})`}>
        {edit.zooms.length === 0 ? (
          <p className="text-xs text-ink-400">No zooms yet. Click the zoom lane on the timeline or press Z.</p>
        ) : (
          <div className="-mx-2 space-y-0.5">
            {edit.zooms.map((z, i) => (
              <button
                key={z.id}
                onClick={() => {
                  p.onSelectZoom(z.id)
                  p.onSeek(z.start)
                }}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-white/[0.05]',
                  sel?.id === z.id && 'bg-brand-500/15 text-brand-300'
                )}
              >
                <span className="w-5 text-ink-500 tabular-nums">{i + 1}</span>
                <span className="flex-1 tabular-nums">
                  {formatTime(z.start, true)} – {formatTime(z.end, true)}
                </span>
                {z.auto && <Sparkles size={12} className="text-ink-400" />}
                <span className="w-9 text-right font-medium tabular-nums">{z.scale.toFixed(1)}×</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

const LAYOUTS: CameraLayout[] = ['overlay', 'split', 'camera', 'cutout', 'screen']

export function LayoutThumb({ kind, className }: { kind: CameraLayout; className?: string }): React.JSX.Element {
  const screen = <span className="absolute inset-[14%] rounded-[3px] bg-ink-300/70" />
  const person = (cls: string): React.JSX.Element => (
    <span className={cx('absolute flex flex-col items-center', cls)}>
      <span className="aspect-square w-[38%] rounded-full bg-brand-300" />
      <span className="mt-[6%] h-[40%] w-[78%] rounded-t-full bg-brand-300" />
    </span>
  )
  return (
    <span
      className={cx(
        'relative block aspect-video overflow-hidden rounded-md bg-ink-950 ring-1 ring-white/10',
        className
      )}
    >
      {kind === 'overlay' && (
        <>
          {screen}
          <span className="absolute right-[6%] bottom-[8%] grid aspect-square w-[22%] place-items-end overflow-hidden rounded-full bg-ink-700 ring-1 ring-white/30">
            {person('inset-x-0 bottom-0 top-[18%]')}
          </span>
        </>
      )}
      {kind === 'split' && (
        <>
          <span className="absolute inset-y-[14%] left-[6%] w-[42%] rounded-[3px] bg-ink-300/70" />
          <span className="absolute inset-y-[14%] right-[6%] w-[42%] overflow-hidden rounded-[3px] bg-ink-700">
            {person('inset-x-0 bottom-0 top-[20%]')}
          </span>
        </>
      )}
      {kind === 'camera' && (
        <span className="absolute inset-[10%] overflow-hidden rounded-[3px] bg-ink-700">
          {person('inset-x-[25%] bottom-0 top-[12%]')}
        </span>
      )}
      {kind === 'screen' && screen}
      {kind === 'cutout' && (
        <>
          {screen}
          {person('right-[4%] bottom-0 h-[52%] w-[28%]')}
        </>
      )}
    </span>
  )
}

function CameraPanel(p: Props & { D: EditState }): React.JSX.Element {
  const { edit, update, project, D } = p
  const setCam = <K extends keyof EditState['camera']>(k: K, v: EditState['camera'][K], key?: string): void =>
    update((e) => ({ ...e, camera: { ...e.camera, [k]: v } }), key)
  if (!project.files.camera) {
    return (
      <Section title="Camera">
        <p className="text-xs leading-relaxed text-ink-400">
          This recording has no camera track. Turn on Camera in the recording bar to use camera layouts.
        </p>
      </Section>
    )
  }
  const seg = p.selectedLayout
  const current = seg ? seg.layout : edit.camera.layout
  const pick = (l: CameraLayout): void => {
    if (seg) update((e) => ({ ...e, layouts: e.layouts.map((x) => (x.id === seg.id ? { ...x, layout: l } : x)) }))
    else setCam('layout', l)
  }
  const usesCut = current === 'cutout' || edit.layouts.some((l) => l.layout === 'cutout')
  return (
    <>
      <Section
        title={seg ? 'Layout change' : 'Layout'}
        action={
          seg ? (
            <Button size="sm" variant="danger" onClick={() => p.onDeleteLayout(seg.id)}>
              <Trash size={13} /> Remove
            </Button>
          ) : undefined
        }
      >
        <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
          {seg
            ? `From ${formatTime(seg.start, true)} to ${formatTime(seg.end, true)}. Transitions animate in and out.`
            : 'The default for the whole video. Add layout changes on the timeline to switch layouts for a section.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {LAYOUTS.map((l) => (
            <button
              key={l}
              onClick={() => pick(l)}
              className={cx(
                'rounded-xl p-2 text-left transition-colors',
                current === l
                  ? 'glass-chip ring-2 ring-brand-400/80'
                  : 'bg-white/[0.03] ring-1 ring-white/[0.05] hover:bg-white/[0.07]'
              )}
            >
              <LayoutThumb kind={l} />
              <span className="mt-1.5 block text-[12px] font-medium">{LAYOUT_LABELS[l]}</span>
            </button>
          ))}
        </div>
        {!seg && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => p.onAddLayout(edit.camera.layout === 'camera' ? 'overlay' : 'camera')}>
              <Plus size={13} /> Layout change
            </Button>
          </div>
        )}
        {usesCut && (
          <p
            className={cx(
              'mt-3 text-[11px] leading-relaxed',
              p.cutoutStatus.state === 'error' ? 'text-red-300' : 'text-ink-400'
            )}
          >
            {p.cutoutStatus.state === 'loading' && 'Loading background removal…'}
            {p.cutoutStatus.state === 'ready' && 'Background removal runs on this Mac — nothing is uploaded.'}
            {p.cutoutStatus.state === 'error' &&
              `Background removal unavailable: ${p.cutoutStatus.message ?? 'unknown error'}`}
            {p.cutoutStatus.state === 'idle' && 'Background removal runs on this Mac.'}
          </p>
        )}
      </Section>
      <Section title="Face tracking">
        <ToggleRow
          label="Keep my face centred"
          on={!!edit.camera.faceTracking}
          onChange={p.onFaceTracking}
          hint={
            p.faceStatus.state === 'analysing'
              ? `Finding your face in the camera… ${Math.round((p.faceStatus.progress ?? 0) * 100)}%`
              : p.faceStatus.state === 'error'
                ? `Couldn’t track: ${p.faceStatus.message}`
                : 'The camera follows you as you move. Analysed once on this computer.'
          }
        />
        {edit.camera.faceTracking && (
          <Slider
            label="Framing"
            value={edit.camera.faceZoom ?? 1.35}
            min={1}
            max={2.2}
            defaultValue={1.35}
            format={(v) => (v < 1.15 ? 'Wide' : v < 1.6 ? 'Medium' : 'Close')}
            onChange={(v) => setCam('faceZoom', v, 'face-zoom')}
          />
        )}
      </Section>
      <Section title="Camera style">
        <ToggleRow label="Mirror" on={edit.camera.mirror} onChange={(v) => setCam('mirror', v)} />
        <Field label="Corner">
          <Segmented<CameraCorner>
            value={edit.camera.corner}
            onChange={(v) => setCam('corner', v)}
            options={[
              { value: 'top-left', label: '↖', title: 'Top left' },
              { value: 'top-right', label: '↗', title: 'Top right' },
              { value: 'bottom-left', label: '↙', title: 'Bottom left' },
              { value: 'bottom-right', label: '↘', title: 'Bottom right' }
            ]}
          />
        </Field>
        <Field label="Bubble shape">
          <Segmented
            value={edit.camera.shape}
            onChange={(v) => setCam('shape', v)}
            options={[
              { value: 'circle', label: 'Circle' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'square', label: 'Square' }
            ]}
          />
        </Field>
        <Slider
          label="Bubble size"
          value={edit.camera.size}
          min={0.1}
          max={0.5}
          defaultValue={D.camera.size}
          format={pct}
          onChange={(v) => setCam('size', v, 'cam-size')}
        />
      </Section>
    </>
  )
}

const MASK_STYLES: { value: MaskStyle; label: string; icon: React.ReactNode }[] = [
  { value: 'blur', label: 'Blur', icon: <Blur size={20} /> },
  { value: 'pixelate', label: 'Pixelate', icon: <Pixelate size={20} /> },
  { value: 'solid', label: 'Solid', icon: <span className="size-5 rounded-md bg-ink-950 ring-1 ring-white/40" /> }
]

const AUTO_LABEL: Record<PrivacyKind, string> = {
  email: 'Email',
  phone: 'Phone',
  card: 'Card',
  key: 'Key',
  face: 'Face'
}
const ALL_KINDS: PrivacyKind[] = ['email', 'phone', 'card', 'key', 'face']

function AutoPrivacy(p: Props): React.JSX.Element {
  const [kinds, setKinds] = useState<PrivacyKind[]>(
    p.edit.privacyScan?.kinds?.length ? (p.edit.privacyScan.kinds as PrivacyKind[]) : ALL_KINDS
  )
  const auto = p.edit.masks.filter((m) => m.auto)
  const counts = ALL_KINDS.map((k) => [k, auto.filter((m) => m.auto === k).length] as const).filter(([, n]) => n > 0)
  return (
    <Section title="Hide sensitive data">
      <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
        Finds emails, phone numbers, card numbers and secret keys on screen, and faces in photos, avatars and video
        calls, then covers them. No masks to draw, and it all runs on this computer.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ALL_KINDS.map((k) => {
          const on = kinds.includes(k)
          return (
            <button
              key={k}
              disabled={!!p.scan}
              onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
              className={cx(
                'h-8 rounded-full px-3 text-[12px] font-medium transition-colors disabled:opacity-50',
                on
                  ? 'glass-chip text-white'
                  : 'bg-white/[0.04] text-ink-400 ring-1 ring-white/[0.06] hover:text-ink-200'
              )}
            >
              {PRIVACY_LABELS[k]}
            </button>
          )
        })}
      </div>
      {p.scan ? (
        <div className="rounded-2xl bg-black/25 p-3 ring-1 ring-white/[0.06]">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-ink-200">{p.scan.label}…</span>
            <button className="text-ink-400 hover:text-white" onClick={p.onCancelScan}>
              Cancel
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-brand-400 transition-[width]"
              style={{ width: `${Math.round(p.scan.progress * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" disabled={!kinds.length} onClick={() => p.onScan(kinds)}>
            <EyeOff size={14} /> {p.edit.privacyScan ? 'Scan again' : 'Scan recording'}
          </Button>
          {auto.length > 0 && (
            <Button onClick={p.onClearAuto} title="Remove the masks the scan added">
              Clear
            </Button>
          )}
        </div>
      )}
      {!p.scan && p.edit.privacyScan && (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-300">
          {auto.length
            ? `Covering ${counts.map(([k, n]) => `${n} ${AUTO_LABEL[k].toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}. Check them below and delete any you want to show.`
            : 'Nothing sensitive found.'}
        </p>
      )}
    </Section>
  )
}

function PrivacyPanel(p: Props): React.JSX.Element {
  const { edit, update, selectedMask: sel } = p
  const setMask = (patch: Partial<MaskSegment>, key?: string): void => {
    if (!sel) return
    update((e) => ({ ...e, masks: e.masks.map((m) => (m.id === sel.id ? { ...m, ...patch } : m)) }), key)
  }
  return (
    <>
      <AutoPrivacy {...p} />
      <Section title="Privacy masks">
        <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
          Draw your own masks for anything the scan missed. Masks follow zooms and are burned into the export.
        </p>
        <Button onClick={p.onAddMask}>
          <Plus size={14} /> Add mask at playhead
        </Button>
      </Section>
      {sel && (
        <Section
          title="Selected mask"
          action={
            <Button size="sm" variant="danger" onClick={() => p.onDeleteMask(sel.id)}>
              <Trash size={13} /> Delete
            </Button>
          }
        >
          <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
            Drag the box on the preview to move it; drag its handles to resize. Drag the bar on the timeline to change
            when it shows.
          </p>
          <Field label="Style">
            <div className="grid grid-cols-3 gap-2">
              {MASK_STYLES.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setMask({ style: o.value })}
                  className={cx(
                    'flex h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium transition-colors',
                    sel.style === o.value
                      ? 'bg-white/[0.12] text-white ring-1 ring-white/25'
                      : 'bg-white/[0.03] text-ink-300 ring-1 ring-white/[0.05] hover:bg-white/[0.07]'
                  )}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          {sel.style !== 'solid' ? (
            <Slider
              label="Strength"
              value={sel.strength}
              min={0}
              max={1}
              defaultValue={0.6}
              format={pct}
              onChange={(v) => setMask({ strength: v }, `mask-s-${sel.id}`)}
            />
          ) : (
            <Field label="Colour">
              <div className="grid grid-cols-6 gap-2">
                {['#101014', '#ffffff', '#6366f1', '#f43f5e', '#f59e0b'].map((c) => (
                  <Swatch
                    key={c}
                    background={c}
                    selected={(sel.color ?? '#101014') === c}
                    onClick={() => setMask({ color: c })}
                  />
                ))}
              </div>
            </Field>
          )}
          <div className="text-[11px] text-ink-400 tabular-nums">
            {formatTime(sel.start, true)} → {formatTime(sel.end, true)} · {(sel.end - sel.start).toFixed(1)}s
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              update((e) => ({
                ...e,
                masks: e.masks.map((m) => (m.id === sel.id ? { ...m, start: 0, end: p.project.duration } : m))
              }))
            }
          >
            Show for the whole video
          </Button>
        </Section>
      )}
      <Section title={`All masks (${edit.masks.length})`}>
        {edit.masks.length === 0 ? (
          <p className="text-xs text-ink-400">No masks yet. Press M or click the Privacy lane on the timeline.</p>
        ) : (
          <div className="-mx-2 space-y-0.5">
            {edit.masks.map((m, i) => (
              <button
                key={m.id}
                onClick={() => {
                  p.onSelectMask(m.id)
                  p.onSeek(m.start + Math.min(0.2, (m.end - m.start) / 2))
                }}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-white/[0.05]',
                  sel?.id === m.id && 'bg-rose-500/15 text-rose-200'
                )}
              >
                <span className="w-5 text-ink-500 tabular-nums">{i + 1}</span>
                <span className="flex-1 tabular-nums">
                  {formatTime(m.start, true)} – {formatTime(m.end, true)}
                </span>
                <span className="text-ink-400 capitalize">{m.auto ? AUTO_LABEL[m.auto] : m.style}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

function ShortcutsPanel({ isMac }: { isMac: boolean }): React.JSX.Element {
  const mod = isMac ? '⌘' : 'Ctrl'
  const rows: [string, string[]][] = [
    ['Play / pause', ['Space']],
    ['Add zoom at playhead', ['Z']],
    ['Step one frame', ['←', '→']],
    ['Jump one second', ['⇧', '← →']],
    ['Split clip at playhead', ['S']],
    ['Delete selected clip', ['⌫']],
    ['Add privacy mask', ['M']],
    ['Delete selected sound', ['⌫']],
    ['Set trim start / end', ['I', 'O']],
    ['Go to start / end', ['Home', 'End']],
    ['Undo', [mod, 'Z']],
    ['Redo', [mod, '⇧', 'Z']],
    ['Zoom timeline', [mod, 'Scroll']],
    ['Export', [mod, 'E']],
    ['Stop recording (global)', [mod, '⇧', '2']]
  ]
  return (
    <Section title="Keyboard shortcuts">
      <div className="space-y-2.5">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-ink-200">{label}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
