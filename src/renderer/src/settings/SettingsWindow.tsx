import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Brush,
  Clapperboard,
  FolderOpen,
  KeyboardKeys,
  Monitor,
  Scissors,
  Sliders,
  Upload,
  User,
  Wrench
} from '@renderer/lib/icons'
import { WALLPAPERS, wallpaperCss } from '@renderer/engine/backgrounds'
import { useGlassInfo } from '@renderer/lib/glass'
import { DEFAULT_SETTINGS, type AppSettings, type Countdown, type SettingsPatch } from '@shared/settings'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/lib/settings'
import { usePresets } from '@renderer/lib/presets'
import { Button, Segmented, Slider, Toggle, cx } from '@renderer/lib/ui'
import { ShortcutInput, formatAccelerator } from './ShortcutInput'
import { Group, Item } from './parts'
import { AccountSection, UpdatesGroup } from './AccountSection'

export type SectionId =
  'account' | 'general' | 'appearance' | 'recording' | 'editing' | 'export' | 'shortcuts' | 'advanced'

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <User size={22} /> },
  { id: 'general', label: 'General', icon: <Sliders size={22} /> },
  { id: 'appearance', label: 'Appearance', icon: <Brush size={22} /> },
  { id: 'recording', label: 'Recording', icon: <Clapperboard size={22} /> },
  { id: 'editing', label: 'Editing', icon: <Scissors size={22} /> },
  { id: 'export', label: 'Export', icon: <Upload size={22} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <KeyboardKeys size={22} /> },
  { id: 'advanced', label: 'Advanced', icon: <Wrench size={22} /> }
]

// ---------------------------------------------------------------------------

function FolderField({
  value,
  fallback,
  onChange,
  onReset
}: {
  value: string
  fallback: string
  onChange: () => void
  onReset: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-black/25 px-2.5 text-xs text-ink-200 ring-1 ring-white/10">
        <FolderOpen size={13} className="shrink-0 text-ink-400" />
        <span className="truncate" title={value || fallback}>
          {value || fallback}
        </span>
      </div>
      <Button size="sm" onClick={onChange}>
        Change…
      </Button>
      {value && (
        <Button size="sm" variant="ghost" onClick={onReset}>
          Default
        </Button>
      )}
    </div>
  )
}

/** "about" (Check for Updates…) lives in General */
function sectionOf(s: string): SectionId {
  if (s === 'about') return 'general'
  return SECTIONS.some((x) => x.id === s) ? (s as SectionId) : 'general'
}

// ---------------------------------------------------------------------------

export function SettingsWindow({ initial }: { initial: SectionId }): React.JSX.Element {
  const { settings, set } = useSettings()
  const [section, setSection] = useState<SectionId>(sectionOf(initial))
  const [platform, setPlatform] = useState('darwin')
  const [folders, setFolders] = useState({ recordings: '', export: '' })
  const [perm, setPerm] = useState<{
    screen: string
    camera: string
    microphone: string
    accessibility: boolean
  } | null>(null)
  const [shortcutOk, setShortcutOk] = useState({ toggleRecording: true, showLauncher: true })
  const [version, setVersion] = useState('')
  const [hwAtStart, setHwAtStart] = useState<boolean | null>(null)
  const isMac = platform === 'darwin'
  const glass = useGlassInfo()
  const translucent = !!glass && glass.material !== 'none' && settings?.appearance.glass !== 'solid'

  const refreshPerm = useCallback(() => void api.permissions.status().then(setPerm), [])
  useEffect(() => setSection(sectionOf(initial)), [initial])

  useEffect(() => {
    document.title = 'Settings'
    void api.platform().then(setPlatform)
    void api.version().then(setVersion)
    void api.settings.defaultFolders().then(setFolders)
    void api.settings.get().then((s) => setHwAtStart(s.advanced.hardwareAcceleration))
    refreshPerm()
    const off = api.settings.onSection((s) => setSection(sectionOf(s)))
    window.addEventListener('focus', refreshPerm)
    return () => {
      off()
      window.removeEventListener('focus', refreshPerm)
    }
  }, [refreshPerm])

  useEffect(() => {
    if (!settings) return
    const t = setTimeout(() => void api.settings.shortcutStatus().then(setShortcutOk), 150)
    return () => clearTimeout(t)
  }, [settings])

  if (!settings) return <div className="h-full" />
  const S = settings
  const patch = (p: SettingsPatch): void => set(p)

  return (
    <div
      className={cx(
        'relative isolate flex h-full flex-col overflow-hidden',
        translucent ? 'bg-ink-950/60' : 'bg-ink-900'
      )}
    >
      {!translucent && (
        <div
          className="ambient -z-10"
          style={{
            background:
              'radial-gradient(40% 50% at 15% 10%, #5a45f5, transparent), radial-gradient(40% 50% at 90% 90%, #0e7490, transparent)'
          }}
        />
      )}
      {/* toolbar: icon tabs across the top */}
      <header className="drag shrink-0 border-b border-white/[0.08] bg-white/[0.02] pt-2.5">
        <div className="h-[18px] text-center text-[13px] font-semibold text-ink-100">
          {SECTIONS.find((s) => s.id === section)!.label}
        </div>
        <nav className="flex justify-center gap-1.5 px-4 pt-2.5 pb-3" role="tablist">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={cx(
                'no-drag flex h-[58px] w-[74px] flex-col items-center justify-center gap-1 rounded-[14px] text-[11.5px] font-medium transition-all',
                section === s.id ? 'glass-chip text-white' : 'text-ink-300 hover:bg-white/[0.06] hover:text-ink-100'
              )}
            >
              <span className={section === s.id ? 'text-brand-300' : 'text-ink-300'}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {/* content */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[620px] px-8 pt-7 pb-8">
          {section === 'account' && <AccountSection />}

          {section === 'appearance' && (
            <AppearanceSection S={S} patch={patch} isMac={isMac} material={glass?.material ?? 'none'} />
          )}

          {section === 'general' && (
            <>
              <Group title="Startup">
                <Item label="Show the recording bar when Toom opens">
                  <Toggle
                    on={S.general.showLauncherOnStart}
                    onChange={(v) => patch({ general: { showLauncherOnStart: v } })}
                  />
                </Item>
                <Item label="Open at login" desc="Takes effect in the installed app.">
                  <Toggle on={S.general.launchAtLogin} onChange={(v) => patch({ general: { launchAtLogin: v } })} />
                </Item>
                {isMac && (
                  <Item label="Show in Dock" desc="When off, Toom lives in the menu bar only.">
                    <Toggle on={S.general.showInDock} onChange={(v) => patch({ general: { showInDock: v } })} />
                  </Item>
                )}
              </Group>
              <UpdatesGroup
                auto={S.general.autoUpdate}
                onAuto={(v) => patch({ general: { autoUpdate: v } })}
                version={version}
              />
              <Group title="Storage" footer="Recordings already saved stay in their current folder.">
                <Item label="Recordings folder" stack>
                  <FolderField
                    value={S.general.recordingsFolder}
                    fallback={folders.recordings}
                    onChange={() => void api.settings.chooseFolder('recordings')}
                    onReset={() => patch({ general: { recordingsFolder: '' } })}
                  />
                </Item>
              </Group>
              {perm && (
                <Group title="Permissions">
                  {(
                    [
                      ['screen', 'Screen recording', perm.screen === 'granted'],
                      ['camera', 'Camera', perm.camera === 'granted'],
                      ['microphone', 'Microphone', perm.microphone === 'granted'],
                      ['accessibility', isMac ? 'Accessibility (click tracking)' : 'Click tracking', perm.accessibility]
                    ] as const
                  ).map(([k, label, ok]) => (
                    <Item key={k} label={label}>
                      {ok ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-400" /> Allowed
                        </span>
                      ) : (
                        <Button size="sm" onClick={() => void api.permissions.request(k).then(refreshPerm)}>
                          {k === 'screen' ? 'Open System Settings' : 'Allow…'}
                        </Button>
                      )}
                    </Item>
                  ))}
                </Group>
              )}
            </>
          )}

          {section === 'recording' && (
            <>
              <Group
                title="While recording"
                footer={
                  isMac
                    ? 'Dynamic Island wraps the notch on MacBooks (a floating pill at the top on other displays). Hover it for pause, stop and discard.'
                    : 'Dynamic Island shows as a floating pill at the top of the screen. Hover it for pause, stop and discard.'
                }
              >
                <Item label="Recording controls">
                  <div className="w-64">
                    <Segmented
                      size="sm"
                      value={S.recording.controls}
                      onChange={(v) => patch({ recording: { controls: v } })}
                      options={[
                        { value: 'island', label: 'Dynamic Island' },
                        { value: 'toolbar', label: 'Floating bar' }
                      ]}
                    />
                  </div>
                </Item>
              </Group>
              <Group title="Capture">
                <Item label="Countdown before recording">
                  <div className="w-56">
                    <Segmented<Countdown>
                      size="sm"
                      value={S.recording.countdown}
                      onChange={(v) => patch({ recording: { countdown: v } })}
                      options={[
                        { value: 0, label: 'Off' },
                        { value: 3, label: '3s' },
                        { value: 5, label: '5s' },
                        { value: 10, label: '10s' }
                      ]}
                    />
                  </div>
                </Item>
                <Item label="Frame rate">
                  <div className="w-40">
                    <Segmented
                      size="sm"
                      value={S.recording.fps}
                      onChange={(v) => patch({ recording: { fps: v } })}
                      options={[
                        { value: 30, label: '30 fps' },
                        { value: 60, label: '60 fps' }
                      ]}
                    />
                  </div>
                </Item>
                <Item label="Quality" desc="Higher quality makes larger raw recordings (≈8 / 16 / 30 Mbps).">
                  <div className="w-64">
                    <Segmented
                      size="sm"
                      value={S.recording.quality}
                      onChange={(v) => patch({ recording: { quality: v } })}
                      options={[
                        { value: 'standard', label: 'Standard' },
                        { value: 'high', label: 'High' },
                        { value: 'max', label: 'Max' }
                      ]}
                    />
                  </div>
                </Item>
                <Item label="Open the editor when recording stops" desc="Otherwise the Library opens.">
                  <Toggle
                    on={S.recording.openEditorAfterRecording}
                    onChange={(v) => patch({ recording: { openEditorAfterRecording: v } })}
                  />
                </Item>
              </Group>
              <Group title="Microphone">
                <Item label="Noise suppression">
                  <Toggle
                    on={S.recording.noiseSuppression}
                    onChange={(v) => patch({ recording: { noiseSuppression: v } })}
                  />
                </Item>
                <Item label="Echo cancellation" desc="Turn off when using headphones for the most natural sound.">
                  <Toggle
                    on={S.recording.echoCancellation}
                    onChange={(v) => patch({ recording: { echoCancellation: v } })}
                  />
                </Item>
              </Group>
            </>
          )}

          {section === 'editing' && <EditingSection S={S} patch={patch} />}

          {section === 'export' && (
            <>
              <Group title="Defaults">
                <Item label="Resolution">
                  <div className="w-72">
                    <Segmented
                      size="sm"
                      value={S.export.resolution}
                      onChange={(v) => patch({ export: { resolution: v } })}
                      options={[
                        { value: 720, label: '720p' },
                        { value: 1080, label: '1080p' },
                        { value: 1440, label: '1440p' },
                        { value: 2160, label: '4K' }
                      ]}
                    />
                  </div>
                </Item>
                <Item label="Frame rate">
                  <div className="w-40">
                    <Segmented
                      size="sm"
                      value={S.export.fps}
                      onChange={(v) => patch({ export: { fps: v } })}
                      options={[
                        { value: 30, label: '30 fps' },
                        { value: 60, label: '60 fps' }
                      ]}
                    />
                  </div>
                </Item>
                <Item label="Quality">
                  <div className="w-56">
                    <Segmented
                      size="sm"
                      value={S.export.quality}
                      onChange={(v) => patch({ export: { quality: v } })}
                      options={[
                        { value: 'medium', label: 'Smaller' },
                        { value: 'high', label: 'High' },
                        { value: 'very-high', label: 'Best' }
                      ]}
                    />
                  </div>
                </Item>
              </Group>
              <Group title="Files">
                <Item label="Save exports to" stack>
                  <FolderField
                    value={S.export.folder}
                    fallback={folders.export}
                    onChange={() => void api.settings.chooseFolder('export')}
                    onReset={() => patch({ export: { folder: '' } })}
                  />
                </Item>
                <Item label="Show the file when export finishes">
                  <Toggle
                    on={S.export.revealAfterExport}
                    onChange={(v) => patch({ export: { revealAfterExport: v } })}
                  />
                </Item>
              </Group>
            </>
          )}

          {section === 'shortcuts' && (
            <>
              <Group
                title="Global"
                footer="Global shortcuts work from any app. Click a shortcut, then press the new keys."
              >
                <Item
                  label="Start / stop recording"
                  desc={
                    !shortcutOk.toggleRecording ? (
                      <span className="text-red-400">Couldn’t register — another app may be using it.</span>
                    ) : (
                      'Opens the recording bar when idle.'
                    )
                  }
                >
                  <div className="flex items-center gap-2">
                    <ShortcutInput
                      isMac={isMac}
                      invalid={!shortcutOk.toggleRecording}
                      value={S.shortcuts.toggleRecording}
                      onChange={(v) => patch({ shortcuts: { toggleRecording: v } })}
                    />
                    {S.shortcuts.toggleRecording !== DEFAULT_SETTINGS.shortcuts.toggleRecording && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch({ shortcuts: { toggleRecording: DEFAULT_SETTINGS.shortcuts.toggleRecording } })
                        }
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </Item>
                <Item
                  label="Show / hide recording bar"
                  desc={
                    !shortcutOk.showLauncher ? (
                      <span className="text-red-400">Couldn’t register — another app may be using it.</span>
                    ) : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <ShortcutInput
                      isMac={isMac}
                      invalid={!shortcutOk.showLauncher}
                      value={S.shortcuts.showLauncher}
                      onChange={(v) => patch({ shortcuts: { showLauncher: v } })}
                    />
                    {S.shortcuts.showLauncher !== DEFAULT_SETTINGS.shortcuts.showLauncher && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch({ shortcuts: { showLauncher: DEFAULT_SETTINGS.shortcuts.showLauncher } })}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </Item>
              </Group>
              <Group title="Editor">
                {(
                  [
                    ['Play / pause', 'Space'],
                    ['Add zoom at playhead', 'Z'],
                    ['Delete selected zoom', 'Backspace'],
                    ['Set trim start / end', 'I / O'],
                    ['Step one frame / one second', '← → / Shift+← →'],
                    ['Undo / redo', 'CommandOrControl+Z / CommandOrControl+Shift+Z'],
                    ['Export', 'CommandOrControl+E']
                  ] as const
                ).map(([label, keys]) => (
                  <Item key={label} label={label}>
                    <span className="flex items-center gap-1 text-[11px] text-ink-300">
                      {keys.split(' / ').map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-ink-500">/</span>}
                          {formatAccelerator(k, isMac).map((p, j) => (
                            <kbd
                              key={j}
                              className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-ink-700 px-1.5 font-sans font-medium ring-1 ring-white/10"
                            >
                              {p}
                            </kbd>
                          ))}
                        </span>
                      ))}
                    </span>
                  </Item>
                ))}
              </Group>
            </>
          )}

          {section === 'advanced' && (
            <>
              <Group title="Capture">
                <Item
                  label="Track mouse clicks"
                  desc="Used for auto zoom and click effects. Needs Accessibility permission on macOS."
                >
                  <Toggle on={S.advanced.clickTracking} onChange={(v) => patch({ advanced: { clickTracking: v } })} />
                </Item>
                <Item
                  label="Track shortcuts and typing"
                  desc="Shows keyboard shortcuts as keycaps and finds typing to speed up. Records shortcuts like ⌘C and when you type — never what you type."
                >
                  <Toggle on={S.advanced.keyTracking} onChange={(v) => patch({ advanced: { keyTracking: v } })} />
                </Item>
                <Item
                  label="Hardware acceleration"
                  desc={
                    hwAtStart !== null && hwAtStart !== S.advanced.hardwareAcceleration ? (
                      <span className="text-amber-300">
                        Restart to apply.{' '}
                        <button className="underline" onClick={() => void api.app.relaunch()}>
                          Restart now
                        </button>
                      </span>
                    ) : (
                      'Turn off only if you see rendering glitches.'
                    )
                  }
                >
                  <Toggle
                    on={S.advanced.hardwareAcceleration}
                    onChange={(v) => patch({ advanced: { hardwareAcceleration: v } })}
                  />
                </Item>
              </Group>
              <StorageGroup />
              <Group title="Troubleshooting">
                <Item label="App data folder" desc="Settings and logs.">
                  <Button size="sm" onClick={() => void api.app.openPath('userData')}>
                    <FolderOpen size={13} /> Open
                  </Button>
                </Item>
                <Item label="Developer tools">
                  <Button size="sm" onClick={() => void api.app.devtools()}>
                    <Monitor size={13} /> Open
                  </Button>
                </Item>
                <Item label="Reset all settings" desc="Restores defaults. Recordings and presets are kept.">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void api.app
                        .confirm({
                          message: 'Reset all settings?',
                          detail: 'Settings return to their defaults. Recordings and presets are kept.',
                          ok: 'Reset',
                          destructive: true
                        })
                        .then((ok) => {
                          if (ok) void api.settings.reset()
                        })
                    }}
                  >
                    Reset…
                  </Button>
                </Item>
              </Group>
            </>
          )}
          <p className="pt-2 text-center text-[11px] text-ink-500">Toom {version}</p>
        </div>
      </main>
    </div>
  )
}

function EditingSection({ S, patch }: { S: AppSettings; patch: (p: SettingsPatch) => void }): React.JSX.Element {
  const { presets, defaultId, setDefault } = usePresets()
  return (
    <>
      <Group title="New recordings">
        <Item label="Add auto zooms" desc="Generated from your clicks when a recording is first opened.">
          <Toggle on={S.editing.autoZoom} onChange={(v) => patch({ editing: { autoZoom: v } })} />
        </Item>
        <div className="px-4 py-3.5">
          <Slider
            label="Default zoom level"
            value={S.editing.zoomLevel}
            min={1.2}
            max={3.5}
            step={0.1}
            defaultValue={DEFAULT_SETTINGS.editing.zoomLevel}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => patch({ editing: { zoomLevel: v } })}
          />
        </div>
        <div className="px-4 py-3.5">
          <Slider
            label="Cursor smoothing"
            value={S.editing.cursorSmoothing}
            min={0}
            max={1}
            defaultValue={DEFAULT_SETTINGS.editing.cursorSmoothing}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => patch({ editing: { cursorSmoothing: v } })}
          />
        </div>
        <Item label="Click effect">
          <div className="w-72">
            <Segmented
              size="sm"
              value={S.editing.clickEffect}
              onChange={(v) => patch({ editing: { clickEffect: v } })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'ripple', label: 'Ripple' },
                { value: 'circle', label: 'Circle' },
                { value: 'glass', label: 'Glass' }
              ]}
            />
          </div>
        </Item>
        <Item
          label="Hide sensitive data automatically"
          desc="Scans new recordings for emails, phone numbers, card numbers, keys and faces, and covers them. Runs on this computer."
        >
          <Toggle on={S.editing.autoPrivacy} onChange={(v) => patch({ editing: { autoPrivacy: v } })} />
        </Item>
        <Item
          label="Speed up typing"
          desc="Plays stretches of typing at 3× (muted) in new recordings. Needs shortcut & typing tracking."
        >
          <Toggle on={S.editing.speedUpTyping} onChange={(v) => patch({ editing: { speedUpTyping: v } })} />
        </Item>
        <Item
          label="Style preset"
          desc="Background, frame and camera look applied to new recordings. Create presets from the editor."
        >
          <select
            value={defaultId ?? ''}
            onChange={(e) => setDefault(e.target.value || null)}
            className="h-8 w-48 rounded-lg bg-black/25 px-2 text-[13px] ring-1 ring-white/10 outline-none"
          >
            <option value="">Default look</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Item>
      </Group>
    </>
  )
}

// ---------------------------------------------------------------------------

function GlassPreview(): React.JSX.Element {
  const wp = WALLPAPERS.find((w) => w.group === 'Vivid') ?? WALLPAPERS[0]
  return (
    <div
      className="relative h-52 overflow-hidden rounded-[18px] ring-1 ring-white/10"
      style={{ background: wallpaperCss(wp) }}
    >
      {/* something with edges and text behind the glass, so you can see it bend */}
      <div className="absolute inset-0 grid grid-cols-6 gap-3 p-4 opacity-90">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="rounded-md bg-white/85 p-1.5 text-[9px] leading-tight font-semibold text-ink-900">
            <div className="mb-1 h-1.5 w-2/3 rounded bg-brand-500" />
            Aa {i + 1}
          </div>
        ))}
      </div>
      <div className="glass glass-flat absolute top-5 left-1/2 flex h-12 -translate-x-1/2 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-white">
        <span className="glass-chip rounded-full px-3 py-1.5">Display</span>
        <span className="px-3 py-1.5 text-ink-200">Window</span>
        <span className="px-3 py-1.5 text-ink-200">Area</span>
        <span className="grid size-8 place-items-center rounded-full bg-red-500">
          <span className="size-2.5 rounded-[3px] bg-white" />
        </span>
      </div>
      <div className="glass absolute right-5 bottom-5 w-48 rounded-[20px] p-3.5 text-white">
        <div className="text-[12px] font-semibold">Liquid Glass</div>
        <div className="mt-0.5 text-[11px] text-ink-200">Bends and frosts what’s behind it.</div>
      </div>
    </div>
  )
}

function AppearanceSection({
  S,
  patch,
  isMac,
  material
}: {
  S: AppSettings
  patch: (p: SettingsPatch) => void
  isMac: boolean
  material: string
}): React.JSX.Element {
  const A = S.appearance
  const D = DEFAULT_SETTINGS.appearance
  const solid = A.glass === 'solid'
  const set = (p: Partial<AppSettings['appearance']>): void => patch({ appearance: p })
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  return (
    <>
      <Group
        title="Theme"
        footer="System follows your Mac or PC’s light and dark mode. The recording controls stay dark so they sit well next to the notch."
      >
        <div className="grid grid-cols-3 gap-3 p-4">
          {(
            [
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark']
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={A.theme === v}
              onClick={() => set({ theme: v })}
              className="group no-drag flex flex-col items-center gap-2"
            >
              <ThemeTile mode={v} selected={A.theme === v} />
              <span className={cx('text-xs', A.theme === v ? 'font-semibold text-ink-100' : 'text-ink-300')}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </Group>
      <Group
        title="Liquid Glass"
        footer={
          material === 'liquid'
            ? 'The recording bar and this window use Apple’s Liquid Glass. The editor uses Toom’s own glass, which refracts the video behind it.'
            : isMac
              ? 'Apple’s native Liquid Glass needs macOS 26; until then Toom draws its own.'
              : 'Toom draws its own glass on Windows.'
        }
      >
        <div className="p-3">
          <GlassPreview />
        </div>
        <Item
          label="Style"
          desc="Clear shows more of what’s behind. Tinted is calmer and easier to read. Solid turns transparency off."
        >
          <div className="w-64">
            <Segmented
              size="sm"
              value={A.glass}
              onChange={(v) => set({ glass: v })}
              options={[
                { value: 'clear', label: 'Clear' },
                { value: 'tinted', label: 'Tinted' },
                { value: 'solid', label: 'Solid' }
              ]}
            />
          </div>
        </Item>
        <div className={cx('px-4 pt-4 pb-2', solid && 'pointer-events-none opacity-40')}>
          <Slider
            label="Transparency"
            value={A.transparency}
            min={0}
            max={1}
            defaultValue={D.transparency}
            format={pct}
            onChange={(v) => set({ transparency: v })}
          />
          <Slider
            label="Frost"
            value={A.blur}
            min={0}
            max={1}
            defaultValue={D.blur}
            format={pct}
            onChange={(v) => set({ blur: v })}
          />
          <Slider
            label="Refraction"
            value={A.refraction}
            min={0}
            max={1}
            defaultValue={D.refraction}
            format={(v) => (v < 0.01 ? 'Off' : pct(v))}
            onChange={(v) => set({ refraction: v })}
          />
          <Slider
            label="Highlights"
            value={A.highlights}
            min={0}
            max={1}
            defaultValue={D.highlights}
            format={pct}
            onChange={(v) => set({ highlights: v })}
          />
        </div>
        <div className="flex justify-end px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => patch({ appearance: D })}>
            Reset to default
          </Button>
        </div>
      </Group>
    </>
  )
}

const fmtBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`

function StorageGroup(): React.JSX.Element {
  const [u, setU] = useState<{ recordings: number; downloads: number; libraries: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.storage.usage().then(setU)
  }, [])
  return (
    <Group title="Disk usage" footer="Downloaded models come back by themselves the next time a feature needs them.">
      <Item label="Recordings" desc="Everything in your recordings folder.">
        <span className="text-xs text-ink-300 tabular-nums">{u ? fmtBytes(u.recordings) : '…'}</span>
      </Item>
      <Item label="Backgrounds & sounds" desc="Images and audio you added to your libraries.">
        <span className="text-xs text-ink-300 tabular-nums">{u ? fmtBytes(u.libraries) : '…'}</span>
      </Item>
      <Item label="Downloaded models & caches" desc="Speech recognition, face detection and camera cutout models.">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-300 tabular-nums">{u ? fmtBytes(u.downloads) : '…'}</span>
          <Button
            size="sm"
            disabled={busy || !u || u.downloads < 1e5}
            onClick={() => {
              setBusy(true)
              void api.storage
                .clearDownloads()
                .then(setU)
                .finally(() => setBusy(false))
            }}
          >
            Clear
          </Button>
        </div>
      </Item>
    </Group>
  )
}

/** A tiny window in light or dark colours (System: half of each). */
function ThemeTile({ mode, selected }: { mode: 'system' | 'light' | 'dark'; selected: boolean }): React.JSX.Element {
  const pane = (dark: boolean): React.JSX.Element => (
    <div className="absolute inset-0" style={{ background: dark ? '#14141a' : '#f3f3f6' }}>
      <div className="absolute top-2 left-2 flex gap-1" aria-hidden>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />
        ))}
      </div>
      <div
        className="absolute top-6 left-2 h-[46px] w-[30%] rounded-md"
        style={{ background: dark ? '#22222a' : '#ffffff', boxShadow: dark ? 'none' : '0 0 0 1px rgba(0,0,0,0.06)' }}
      />
      <div
        className="absolute top-6 right-2 left-[40%] h-[46px] rounded-md"
        style={{ background: dark ? '#1c1c24' : '#ffffff', boxShadow: dark ? 'none' : '0 0 0 1px rgba(0,0,0,0.06)' }}
      >
        <div className="m-1.5 h-1.5 w-1/2 rounded-full bg-[#6d5cff]" />
        <div className="mx-1.5 h-1 w-3/4 rounded-full" style={{ background: dark ? '#3a3a44' : '#d3d3db' }} />
      </div>
    </div>
  )
  return (
    <div
      className={cx(
        'relative h-[84px] w-full overflow-hidden rounded-xl transition-shadow',
        selected
          ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-transparent'
          : 'ring-1 ring-white/10 group-hover:ring-white/25'
      )}
    >
      {mode === 'system' ? (
        <>
          {pane(false)}
          <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
            {pane(true)}
          </div>
        </>
      ) : (
        pane(mode === 'dark')
      )}
    </div>
  )
}
