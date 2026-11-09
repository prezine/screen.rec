import type { CaptionAnimation, CaptionStyle, EditState, KeystrokeSettings } from '@shared/types'
import { keycaps, type KeyEvent } from '@shared/keys'
import { Field, Section, Segmented, Slider, Swatch, ToggleRow, cx } from '@renderer/lib/ui'
import type { Update } from './SidePanel'
import { Pencil } from '@renderer/lib/icons'

const STYLES: { value: CaptionStyle; label: string; preview: React.ReactNode }[] = [
  {
    value: 'karaoke',
    label: 'Karaoke',
    preview: (
      <span className="font-semibold">
        <span className="text-white">Show the </span>
        <span className="text-brand-300">invoice</span>
        <span className="text-white/45"> page</span>
      </span>
    )
  },
  {
    value: 'bold',
    label: 'Bold',
    preview: (
      <span
        className="font-extrabold tracking-tight text-white uppercase"
        style={{ WebkitTextStroke: '0.6px #000', paintOrder: 'stroke' }}
      >
        Show the <span className="text-amber-300">invoice</span>
      </span>
    )
  },
  {
    value: 'box',
    label: 'Box',
    preview: <span className="rounded-md bg-black/80 px-1.5 py-0.5 font-semibold text-white">Show the invoice</span>
  },
  {
    value: 'glass',
    label: 'Glass',
    preview: <span className="glass-chip rounded-full px-2 py-0.5 font-semibold text-white">Show the invoice</span>
  },
  {
    value: 'clean',
    label: 'Clean',
    preview: <span className="font-semibold text-white [text-shadow:0_1px_6px_rgba(0,0,0,.8)]">Show the invoice</span>
  }
]

const HIGHLIGHTS = ['#8f80ff', '#facc15', '#34d399', '#38bdf8', '#fb7185', '#ffffff']

export function CaptionsPanel({
  edit,
  update,
  hasTranscript,
  keys,
  mac,
  onOpenTranscript
}: {
  edit: EditState
  update: Update
  hasTranscript: boolean
  keys: KeyEvent[]
  mac: boolean
  onOpenTranscript: () => void
}): React.JSX.Element {
  const c = edit.captions
  const k = edit.keystrokes
  const setC = (p: Partial<EditState['captions']>, key?: string): void =>
    update((e) => ({ ...e, captions: { ...e.captions, ...p } }), key)
  const setK = (p: Partial<KeystrokeSettings>, key?: string): void =>
    update((e) => ({ ...e, keystrokes: { ...e.keystrokes, ...p } }), key)
  const shortcuts = keys.filter((e) => e.mods.some((m) => m !== 'shift'))
  const sample = shortcuts[0] ?? { t: 0, key: 'K', mods: ['meta'] }
  return (
    <>
      <Section title="Captions">
        <ToggleRow label="Show captions" on={c.enabled} onChange={(v) => setC({ enabled: v })} />
        {!hasTranscript && (
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-400">
            Captions come from the transcript.{' '}
            <button className="text-brand-300 underline" onClick={onOpenTranscript}>
              Transcribe this recording
            </button>{' '}
            first — it runs on your computer.
          </p>
        )}
        {hasTranscript && (
          <p className="mb-4 flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-300 ring-1 ring-white/[0.06]">
            <Pencil size={13} className="mt-0.5 shrink-0 text-brand-300" />
            <span>
              A word wrong?{' '}
              <button className="text-brand-300 underline" onClick={onOpenTranscript}>
                Edit it in the transcript
              </button>{' '}
              — double-click any word. Captions update right away.
            </span>
          </p>
        )}
        <div className={cx(!c.enabled && 'pointer-events-none opacity-45')}>
          <Field label="Style">
            <div className="grid grid-cols-1 gap-1.5">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setC({ style: s.value })}
                  className={cx(
                    'flex h-12 items-center justify-between gap-3 overflow-hidden rounded-2xl px-3 text-left text-[13px] transition-colors',
                    c.style === s.value
                      ? 'glass-chip ring-2 ring-brand-400/70'
                      : 'bg-white/[0.03] ring-1 ring-white/[0.05] hover:bg-white/[0.07]'
                  )}
                  style={{
                    background:
                      c.style === s.value
                        ? undefined
                        : 'linear-gradient(90deg, rgba(90,69,245,0.18), rgba(14,116,144,0.14))'
                  }}
                >
                  <span className="w-16 shrink-0 text-[12px] text-ink-300">{s.label}</span>
                  <span className="truncate text-[13px]">{s.preview}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Animation">
            <Segmented<CaptionAnimation>
              size="sm"
              value={c.animation}
              onChange={(v) => setC({ animation: v })}
              options={[
                { value: 'pop', label: 'Word pop' },
                { value: 'rise', label: 'Rise' },
                { value: 'fade', label: 'Fade' },
                { value: 'none', label: 'None' }
              ]}
            />
          </Field>
          {c.style !== 'clean' && (
            <Field label="Highlight">
              <div className="grid grid-cols-6 gap-2">
                {HIGHLIGHTS.map((h) => (
                  <Swatch key={h} background={h} selected={c.highlight === h} onClick={() => setC({ highlight: h })} />
                ))}
              </div>
            </Field>
          )}
          <Field label="Position">
            <Segmented
              size="sm"
              value={c.position}
              onChange={(v) => setC({ position: v })}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' }
              ]}
            />
          </Field>
          <Slider
            label="Size"
            value={c.size}
            min={0.6}
            max={1.6}
            defaultValue={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setC({ size: v }, 'cap-size')}
          />
        </div>
      </Section>

      <Section title="Keyboard shortcuts">
        <div className="mb-4 flex justify-center gap-1.5 rounded-2xl bg-black/25 py-4 ring-1 ring-white/[0.05]">
          {keycaps(sample, mac).map((l, i) => (
            <span
              key={i}
              className={cx(
                'grid h-9 min-w-9 place-items-center rounded-lg px-2 text-[14px] font-semibold',
                k.style === 'dark'
                  ? 'bg-gradient-to-b from-[#3c3c48] to-[#24242c] text-[#fff] shadow-[0_3px_0_#0d0d12,0_6px_14px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]'
                  : 'bg-gradient-to-b from-white to-[#e6e6ec] text-[#26262e] shadow-[0_3px_0_#a9a9b6,0_6px_14px_rgba(0,0,0,0.4),inset_0_1px_0_#fff]'
              )}
            >
              {l}
            </span>
          ))}
        </div>
        <Field
          label="Show"
          hint={
            keys.length
              ? `${shortcuts.length} shortcut${shortcuts.length === 1 ? '' : 's'} recorded${keys.length > shortcuts.length ? `, plus ${keys.length - shortcuts.length} other keys` : ''}.`
              : 'No keys were recorded. Turn on “Track shortcuts and typing” in Settings → Advanced before recording.'
          }
        >
          <Segmented
            size="sm"
            value={k.mode}
            onChange={(v) => setK({ mode: v })}
            options={[
              { value: 'shortcuts', label: 'Shortcuts' },
              { value: 'all', label: '+ Enter, Esc…' },
              { value: 'off', label: 'Off' }
            ]}
          />
        </Field>
        <div className={cx(k.mode === 'off' && 'pointer-events-none opacity-45')}>
          <Field label="Keycaps">
            <Segmented
              size="sm"
              value={k.style}
              onChange={(v) => setK({ style: v })}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]}
            />
          </Field>
          <Field label="Position">
            <Segmented
              size="sm"
              value={k.position}
              onChange={(v) => setK({ position: v })}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' }
              ]}
            />
          </Field>
          <Slider
            label="Size"
            value={k.size}
            min={0.6}
            max={1.6}
            defaultValue={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setK({ size: v }, 'key-size')}
          />
        </div>
      </Section>
    </>
  )
}
