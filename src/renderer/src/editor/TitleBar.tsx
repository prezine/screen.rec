import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@renderer/lib/brand'
import { Check, ChevronDown, FolderOpen, Redo2, Sparkles, Star, Trash, Undo2, Upload, X } from '@renderer/lib/icons'
import type { StylePreset } from '@shared/types'
import { usePresets } from '@renderer/lib/presets'
import { Button, Dropdown, IconButton, cx } from '@renderer/lib/ui'

interface Props {
  isMac: boolean
  name: string
  onRename: (name: string) => void
  onReveal: () => void
  onDelete: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  currentStyle: () => StylePreset['style']
  onApplyPreset: (p: StylePreset) => void
  onExport: () => void
}

function EditableName({ name, onRename }: { name: string; onRename: (n: string) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])
  if (editing) {
    const commit = (): void => {
      setEditing(false)
      if (draft.trim() && draft.trim() !== name) onRename(draft.trim())
    }
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="no-drag h-8 w-[420px] max-w-full rounded-lg bg-ink-800 px-3 text-center text-sm text-white ring-1 ring-brand-500 outline-none"
      />
    )
  }
  return (
    <button
      onDoubleClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      title="Double-click to rename"
      className="no-drag max-w-[420px] truncate rounded-lg px-3 py-1 text-sm font-medium text-ink-100 hover:bg-white/[0.04]"
    >
      {name}
    </button>
  )
}

function PresetsMenu({
  currentStyle,
  onApplyPreset
}: Pick<Props, 'currentStyle' | 'onApplyPreset'>): React.JSX.Element {
  const { presets, defaultId, save, remove, setDefault, update } = usePresets()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <Dropdown
      align="right"
      width={280}
      trigger={(open) => (
        <Button variant="ghost" className={cx(open && 'bg-white/[0.06]')}>
          <Sparkles size={15} /> Presets <ChevronDown size={14} className="text-ink-400" />
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
            Style presets
          </div>
          {presets.length === 0 && (
            <p className="px-2.5 pb-2 text-xs text-ink-400">Save the current look to reuse it on other recordings.</p>
          )}
          {presets.map((p) => (
            <div key={p.id} className="group flex h-8 items-center gap-1 rounded-lg pr-1 hover:bg-white/[0.06]">
              <button
                className="h-full flex-1 truncate px-2.5 text-left text-[13px]"
                onClick={() => {
                  onApplyPreset(p)
                  close()
                }}
              >
                {p.name}
              </button>
              <button
                title="Overwrite with current style"
                onClick={() => update(p.id, currentStyle())}
                className="hidden size-6 place-items-center rounded-md text-ink-400 group-hover:grid hover:text-white"
              >
                <Upload size={12} />
              </button>
              <button
                title={defaultId === p.id ? 'Default for new recordings' : 'Use for new recordings'}
                onClick={() => setDefault(defaultId === p.id ? null : p.id)}
                className={cx(
                  'size-6 place-items-center rounded-md hover:text-white',
                  defaultId === p.id ? 'grid text-amber-300' : 'hidden text-ink-400 group-hover:grid'
                )}
              >
                <Star size={12} fill={defaultId === p.id ? 'currentColor' : 'none'} />
              </button>
              <button
                title="Delete preset"
                onClick={() => remove(p.id)}
                className="hidden size-6 place-items-center rounded-md text-ink-400 group-hover:grid hover:text-red-400"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="my-1.5 h-px bg-white/[0.06]" />
          {naming ? (
            <form
              className="flex items-center gap-1.5 p-1"
              onSubmit={(e) => {
                e.preventDefault()
                save(name, currentStyle())
                setName('')
                setNaming(false)
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Preset name"
                className="h-8 min-w-0 flex-1 rounded-lg bg-ink-900 px-2.5 text-[13px] ring-1 ring-white/10 outline-none focus:ring-brand-500"
              />
              <Button type="submit" size="sm" variant="primary">
                <Check size={13} />
              </Button>
            </form>
          ) : (
            <button
              onClick={() => setNaming(true)}
              className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-brand-300 hover:bg-white/[0.06]"
            >
              Save current style as preset…
            </button>
          )}
        </div>
      )}
    </Dropdown>
  )
}

export function TitleBar(p: Props): React.JSX.Element {
  return (
    <header
      className="drag grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/[0.07] bg-black/25 pr-3 backdrop-blur-2xl"
      style={{ paddingLeft: p.isMac ? 84 : 12 }}
    >
      <div className="flex items-center gap-1">
        <AppIcon size={20} tone="white" className="mr-1" />
        <IconButton label="Show in Finder" onClick={p.onReveal}>
          <FolderOpen size={17} />
        </IconButton>
        <IconButton label="Delete recording" onClick={p.onDelete}>
          <Trash size={17} />
        </IconButton>
      </div>

      <div className="flex min-w-0 justify-center">
        <EditableName name={p.name} onRename={p.onRename} />
      </div>

      <div className="flex items-center justify-end gap-1">
        <IconButton label="Undo" onClick={p.onUndo} disabled={!p.canUndo}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="Redo" onClick={p.onRedo} disabled={!p.canRedo}>
          <Redo2 size={17} />
        </IconButton>
        <div className="mx-2 h-6 w-px bg-white/[0.08]" />
        <PresetsMenu currentStyle={p.currentStyle} onApplyPreset={p.onApplyPreset} />
        <Button variant="primary" size="lg" className="ml-2" onClick={p.onExport}>
          <Upload size={16} /> Export
        </Button>
      </div>
    </header>
  )
}
