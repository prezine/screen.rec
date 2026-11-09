import { useCallback, useEffect, useState } from 'react'
import type { EditState, ProjectMeta, SoundItem, SoundKind, SoundSource } from '@shared/types'
import type { LibrarySound } from '@shared/media'
import { api } from '@renderer/lib/api'
import { Music, Play, Plus, Square, Trash, Upload, Waveform, X } from '@renderer/lib/icons'
import { Button, Field, Pills, Section, Slider, ToggleRow, cx } from '@renderer/lib/ui'
import {
  MUSIC_PRESETS,
  SFX_PRESETS,
  audition,
  decodeUrl,
  loadSound,
  presetLabel,
  stopAudition
} from '@renderer/engine/sounds'
import { formatTime, uid } from '@renderer/engine/math'
import type { Update } from './SidePanel'
import { VoiceOver, type PlayerControl } from './VoiceOver'

const pct = (v: number): string => `${Math.round(v * 100)}%`
const secs = (v: number): string => (v < 0.05 ? 'Off' : `${v.toFixed(1)}s`)

/** Play/stop toggle for auditioning a sound in a picker. */
const sndUrl = (file: string): string =>
  (globalThis as { __MEDIA_BASE__?: string }).__MEDIA_BASE__
    ? `${(globalThis as { __MEDIA_BASE__?: string }).__MEDIA_BASE__}/snd/${encodeURIComponent(file)}`
    : `media://snd/${encodeURIComponent(file)}`

function useAudition(projectId: string): {
  playing: string | null
  toggle: (key: string, src: SoundSource | { url: string }) => void
} {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => stopAudition(), [])
  const toggle = useCallback(
    (key: string, src: SoundSource | { url: string }) => {
      if (playing === key) {
        stopAudition()
        setPlaying(null)
        return
      }
      setPlaying(key)
      void ('url' in src ? decodeUrl(src.url) : loadSound(projectId, src))
        .then(async (b) => {
          await audition(b, 10)
          setTimeout(() => setPlaying((cur) => (cur === key ? null : cur)), Math.min(b.duration, 10) * 1000)
        })
        .catch(() => setPlaying(null))
    },
    [playing, projectId]
  )
  return { playing, toggle }
}

function PlayBtn({
  on,
  onClick,
  className
}: {
  on: boolean
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <button
      title={on ? 'Stop' : 'Listen'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cx(
        'grid size-7 shrink-0 place-items-center rounded-full bg-white/90 text-black hover:bg-white',
        className
      )}
    >
      {on ? <Square size={10} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
    </button>
  )
}

export function AudioPanel({
  project,
  edit,
  update,
  time,
  selected,
  onSelect,
  onDelete,
  player,
  onPreviewMuted
}: {
  player: () => PlayerControl | null
  onPreviewMuted: (m: boolean) => void
  project: ProjectMeta
  edit: EditState
  update: Update
  time: () => number
  selected: SoundItem | null
  onSelect: (id: string | null) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const { playing, toggle } = useAudition(project.id)
  const [musicTab, setMusicTab] = useState<'builtin' | 'yours'>('builtin')
  const [library, setLibrary] = useState<LibrarySound[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshLibrary = useCallback(
    () =>
      void api.sounds
        .library()
        .then(setLibrary)
        .catch(() => undefined),
    []
  )
  useEffect(refreshLibrary, [refreshLibrary])

  const add = useCallback(
    async (kind: SoundKind, source: SoundSource) => {
      setError(null)
      setBusy(source.type === 'preset' ? source.id : source.file)
      // where the playhead is when you click, not after the sound has loaded
      const t = Math.min(time(), Math.max(0, project.duration - 0.2))
      try {
        const buf = await loadSound(project.id, source)
        const music = kind === 'music'
        // music: from the playhead (the whole video when you're at the start) · effects: one shot at the playhead
        const start = music && t < 0.5 ? 0 : t
        const item: SoundItem = {
          id: uid('s'),
          kind,
          source,
          start,
          end: music ? project.duration : Math.min(project.duration, start + buf.duration),
          offset: 0,
          volume: music ? 0.35 : 0.8,
          fadeIn: music ? 1.5 : 0,
          fadeOut: music ? 2.5 : 0,
          loop: music
        }
        update((e) => ({ ...e, sounds: [...e.sounds, item].sort((a, b) => a.start - b.start) }))
        onSelect(item.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [project.id, project.duration, time, update, onSelect]
  )

  const upload = async (kind: 'music' | 'sfx'): Promise<void> => {
    setError(null)
    const files = await api.sounds.import(project.id, kind)
    refreshLibrary()
    for (const f of files) await add(kind, { type: 'file', file: f.file, name: f.name })
  }

  const useFromLibrary = async (s: LibrarySound): Promise<void> => {
    try {
      const r = await api.sounds.use(project.id, s.id)
      await add(s.kind, { type: 'file', file: r.file, name: r.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const set = (patch: Partial<SoundItem>, key?: string): void => {
    if (!selected) return
    update((e) => ({ ...e, sounds: e.sounds.map((x) => (x.id === selected.id ? { ...x, ...patch } : x)) }), key)
  }

  const music = edit.sounds.filter((x) => x.kind === 'music')
  const sfx = edit.sounds.filter((x) => x.kind === 'sfx')
  const yours = (kind: SoundKind): LibrarySound[] => library.filter((l) => l.kind === kind)

  const LibraryList = ({ kind }: { kind: SoundKind }): React.JSX.Element => (
    <div className="space-y-1">
      {yours(kind).map((s) => {
        const key = `lib:${s.id}`
        return (
          <div
            key={s.id}
            className="group flex h-10 items-center gap-2.5 rounded-full bg-white/[0.04] pr-1.5 pl-1.5 ring-1 ring-white/[0.05]"
          >
            <PlayBtn on={playing === key} onClick={() => toggle(key, { url: sndUrl(s.file) })} />
            {kind === 'music' ? (
              <Music size={14} className="shrink-0 text-ink-400" />
            ) : (
              <Waveform size={14} className="shrink-0 text-ink-400" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{s.name}</span>
            <button
              title="Remove from your library"
              onClick={() => void api.sounds.remove(s.id).then(refreshLibrary)}
              className="hidden size-7 place-items-center rounded-full text-ink-400 group-hover:grid hover:bg-white/10 hover:text-white"
            >
              <X size={13} />
            </button>
            <Button size="sm" onClick={() => void useFromLibrary(s)}>
              <Plus size={12} /> Add
            </Button>
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      {error && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-xs text-red-200 ring-1 ring-red-500/20">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {selected && (
        <Section
          title={
            selected.kind === 'music'
              ? 'Selected music'
              : selected.kind === 'voice'
                ? 'Selected voice-over'
                : 'Selected sound'
          }
          action={
            <Button size="sm" variant="danger" onClick={() => onDelete(selected.id)}>
              <Trash size={13} /> Delete
            </Button>
          }
        >
          <div className="mb-4 flex items-center gap-2.5">
            <PlayBtn
              on={playing === `sel:${selected.id}`}
              onClick={() => toggle(`sel:${selected.id}`, selected.source)}
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{presetLabel(selected.source)}</div>
              <div className="text-[11px] text-ink-400 tabular-nums">
                {formatTime(selected.start, true)} → {formatTime(selected.end, true)}
              </div>
            </div>
          </div>
          <Slider
            label="Volume"
            value={selected.volume}
            min={0}
            max={1.5}
            defaultValue={selected.kind === 'music' ? 0.35 : 0.8}
            format={pct}
            onChange={(v) => set({ volume: v }, `snd-vol-${selected.id}`)}
          />
          <Slider
            label="Fade in"
            value={selected.fadeIn}
            min={0}
            max={5}
            step={0.1}
            defaultValue={selected.kind === 'music' ? 1.5 : 0}
            format={secs}
            onChange={(v) => set({ fadeIn: v }, `snd-fi-${selected.id}`)}
          />
          <Slider
            label="Fade out"
            value={selected.fadeOut}
            min={0}
            max={5}
            step={0.1}
            defaultValue={selected.kind === 'music' ? 2.5 : 0}
            format={secs}
            onChange={(v) => set({ fadeOut: v }, `snd-fo-${selected.id}`)}
          />
          {selected.kind === 'music' && (
            <>
              <ToggleRow
                label="Loop"
                on={selected.loop}
                onChange={(v) => set({ loop: v })}
                hint="Repeat the track when it’s shorter than its bar on the timeline."
              />
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => set({ start: 0, end: project.duration })}>
                  Fill the whole video
                </Button>
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="Voice-over">
        <VoiceOver
          project={project}
          edit={edit}
          update={update}
          player={player}
          onPreviewMuted={onPreviewMuted}
          onAdded={onSelect}
        />
      </Section>

      <Section title="Recording">
        <ToggleRow
          label="Mute recording"
          on={edit.audio.muted}
          onChange={(v) => update((e) => ({ ...e, audio: { ...e.audio, muted: v } }))}
        />
        <Slider
          label="Volume"
          value={edit.audio.volume}
          min={0}
          max={2}
          defaultValue={1}
          format={pct}
          onChange={(v) => update((e) => ({ ...e, audio: { ...e.audio, volume: v } }), 'vol')}
        />
      </Section>

      <Section title="Music">
        <Field>
          <Pills
            value={musicTab}
            onChange={setMusicTab}
            options={[
              { value: 'builtin', label: 'Built-in' },
              { value: 'yours', label: `Your music${yours('music').length ? ` (${yours('music').length})` : ''}` }
            ]}
          />
        </Field>
        {musicTab === 'builtin' ? (
          <div className="grid grid-cols-2 gap-2">
            {MUSIC_PRESETS.map((m) => {
              const key = `music:${m.id}`
              return (
                <div
                  key={m.id}
                  className="relative overflow-hidden rounded-2xl p-3 ring-1 ring-white/10"
                  style={{ background: `linear-gradient(135deg, ${m.colors[0]}cc, ${m.colors[1]}99)` }}
                >
                  <div className="text-[13px] font-semibold text-white">{m.label}</div>
                  <div className="text-[11px] text-white/75">
                    {m.mood} · {m.bpm} bpm
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <PlayBtn on={playing === key} onClick={() => toggle(key, { type: 'preset', id: m.id })} />
                    <button
                      disabled={busy === m.id}
                      onClick={() => void add('music', { type: 'preset', id: m.id })}
                      className="flex h-7 items-center gap-1 rounded-full bg-black/30 px-2.5 text-[11.5px] font-medium text-white hover:bg-black/45 disabled:opacity-50"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <>
            <LibraryList kind="music" />
            <Button className="mt-2 w-full" onClick={() => void upload('music')}>
              <Upload size={14} /> Upload music…
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
              MP3, M4A, WAV, OGG or FLAC. Make sure you have the rights to use it.
            </p>
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
          Built-in loops are generated on this computer — free to use anywhere. Music is added from the playhead to the
          end (the whole video when you’re at the start).
        </p>
        <div className="mt-4">
          <Slider
            label="Lower music while you talk"
            value={edit.audio.duck}
            min={0}
            max={0.9}
            defaultValue={0.6}
            format={(v) => (v < 0.02 ? 'Off' : pct(v))}
            onChange={(v) => update((e) => ({ ...e, audio: { ...e.audio, duck: v } }), 'duck')}
          />
        </div>
        {music.length > 0 && <SoundList items={music} selected={selected?.id ?? null} onSelect={onSelect} />}
      </Section>

      <Section title="Sound effects">
        {(['Interface', 'Transitions', 'Accents'] as const).map((g) => (
          <div key={g} className="mb-3">
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">{g}</div>
            <div className="flex flex-wrap gap-1.5">
              {SFX_PRESETS.filter((p) => p.group === g).map((p) => {
                const key = `sfx:${p.id}`
                return (
                  <div
                    key={p.id}
                    className="flex h-8 items-center gap-1 rounded-full bg-white/[0.05] pr-1 pl-1 ring-1 ring-white/[0.06]"
                  >
                    <button
                      title={`Listen to ${p.label}`}
                      onClick={() => toggle(key, { type: 'preset', id: p.id })}
                      className={cx(
                        'grid size-6 place-items-center rounded-full',
                        playing === key ? 'bg-white text-black' : 'text-ink-300 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {playing === key ? (
                        <Square size={9} fill="currentColor" />
                      ) : (
                        <Play size={10} fill="currentColor" />
                      )}
                    </button>
                    <span className="px-0.5 text-[12px]">{p.label}</span>
                    <button
                      title={`Add ${p.label} at the playhead`}
                      onClick={() => void add('sfx', { type: 'preset', id: p.id })}
                      className="grid size-6 place-items-center rounded-full text-ink-300 hover:bg-white/10 hover:text-white"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {yours('sfx').length > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">Yours</div>
            <LibraryList kind="sfx" />
          </div>
        )}
        <Button className="w-full" onClick={() => void upload('sfx')}>
          <Upload size={14} /> Upload a sound effect…
        </Button>
        {sfx.length > 0 && <SoundList items={sfx} selected={selected?.id ?? null} onSelect={onSelect} />}
      </Section>
    </>
  )
}

function SoundList({
  items,
  selected,
  onSelect
}: {
  items: SoundItem[]
  selected: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="-mx-2 mt-4 space-y-0.5">
      {items.map((x) => (
        <button
          key={x.id}
          onClick={() => onSelect(x.id)}
          className={cx(
            'flex h-8 w-full items-center gap-2 rounded-full px-3 text-left text-xs hover:bg-white/[0.05]',
            selected === x.id && 'bg-sky-500/15 text-sky-200'
          )}
        >
          {x.kind === 'music' ? (
            <Music size={12} className="shrink-0 text-ink-400" />
          ) : (
            <Waveform size={12} className="shrink-0 text-ink-400" />
          )}
          <span className="min-w-0 flex-1 truncate">{presetLabel(x.source)}</span>
          <span className="text-ink-400 tabular-nums">
            {formatTime(x.start, true)} – {formatTime(x.end, true)}
          </span>
        </button>
      ))}
    </div>
  )
}
