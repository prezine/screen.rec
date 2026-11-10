import { Wordmark } from '@renderer/lib/brand'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FolderOpen, Search, Settings, Trash, Video } from '@renderer/lib/icons'
import type { ProjectMeta } from '@shared/types'
import { api } from '@renderer/lib/api'
import { formatTime } from '@renderer/engine/math'
import { Button, IconButton, cx } from '@renderer/lib/ui'

type Perms = { screen: string; camera: string; microphone: string; accessibility: boolean }

export function Library(): React.JSX.Element {
  const [platform, setPlatform] = useState('darwin')
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null)
  const [perm, setPerm] = useState<Perms | null>(null)
  const [query, setQuery] = useState('')
  const isMac = platform === 'darwin'

  const refresh = useCallback(async () => setProjects(await api.projects.list()), [])

  useEffect(() => {
    document.title = 'Toom — Library'
    void api.platform().then(setPlatform)
    void refresh()
    void api.permissions.status().then(setPerm)
    const off = api.projects.onChanged(() => void refresh())
    const onFocus = (): void => void api.permissions.status().then(setPerm)
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const groups = useMemo(() => {
    const list = (projects ?? []).filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 864e5).toDateString()
    const out: { label: string; items: ProjectMeta[] }[] = []
    for (const p of list) {
      const d = new Date(p.createdAt)
      const label =
        d.toDateString() === today
          ? 'Today'
          : d.toDateString() === yesterday
            ? 'Yesterday'
            : d.toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
              })
      const g = out.at(-1)
      if (g && g.label === label) g.items.push(p)
      else out.push({ label, items: [p] })
    }
    return out
  }, [projects, query])

  return (
    <div className="flex h-full flex-col">
      <header
        className={cx(
          'drag flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] pr-4',
          isMac ? 'pl-[84px]' : 'pl-5'
        )}
      >
        <Logo />
        <div className="flex-1" />
        <label className="no-drag flex h-8 w-56 items-center gap-2 rounded-lg bg-ink-850 px-2.5 ring-1 ring-white/[0.08] focus-within:ring-brand-500">
          <Search size={14} className="text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recordings"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-500"
          />
        </label>
        <IconButton label="Recordings folder" onClick={() => void api.projects.reveal()}>
          <FolderOpen size={17} />
        </IconButton>
        <IconButton label="Settings" onClick={() => void api.app.showSettings()}>
          <Settings size={17} />
        </IconButton>
        <Button variant="primary" onClick={() => void api.app.showLauncher()}>
          <span className="size-2 rounded-full bg-[#fff]" /> New recording
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {isMac && perm && perm.screen !== 'granted' && (
          <Banner
            action={
              <Button size="sm" onClick={() => void api.permissions.request('screen')}>
                Open Settings
              </Button>
            }
          >
            Screen Recording permission is needed. Enable it in System Settings → Privacy &amp; Security → Screen
            Recording, then restart the app.
          </Banner>
        )}

        {projects === null ? null : projects.length === 0 ? (
          <div className="mt-24 flex flex-col items-center text-center">
            <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-500/15 text-brand-300">
              <Video size={26} />
            </span>
            <h2 className="text-base font-semibold">No recordings yet</h2>
            <p className="mt-1 max-w-sm text-[13px] text-ink-400">
              Open the recording bar to capture a display, a window, an area or a device.
            </p>
            <Button variant="primary" size="lg" className="mt-5" onClick={() => void api.app.showLauncher()}>
              <span className="size-2 rounded-full bg-[#fff]" /> New recording
            </Button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-8">
              <h3 className="mb-3 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{g.label}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                {g.items.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => void api.projects.open(p.id)}
                    className="group overflow-hidden rounded-xl bg-ink-850 ring-1 ring-white/[0.06] transition-shadow hover:ring-white/15"
                  >
                    <div className="relative aspect-[16/10] bg-gradient-to-br from-ink-700 to-ink-850">
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center text-xs text-ink-400">Not opened yet</div>
                      )}
                      <span className="absolute right-2 bottom-2 rounded-md bg-[#000]/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#fff] backdrop-blur">
                        {formatTime(p.duration)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs" title={p.name}>
                          {p.name}
                        </span>
                        <span className="block text-[11px] text-ink-500 capitalize">{p.source.kind}</span>
                      </span>
                      <button
                        title="Delete"
                        className="hidden size-7 place-items-center rounded-md text-ink-400 group-hover:grid hover:bg-red-500/10 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation()
                          void api.projects.confirmRemove(p.id)
                        }}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function Logo(): React.JSX.Element {
  return <Wordmark height={17} />
}

function Banner({
  children,
  action,
  tone = 'warn'
}: {
  children: React.ReactNode
  action?: React.ReactNode
  tone?: 'warn' | 'error'
}): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-3 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs ring-1',
        tone === 'warn'
          ? 'bg-amber-500/10 text-amber-200 ring-amber-500/20'
          : 'bg-red-500/10 text-red-300 ring-red-500/20'
      )}
    >
      <AlertTriangle size={15} className="shrink-0" />
      <div className="flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  )
}
