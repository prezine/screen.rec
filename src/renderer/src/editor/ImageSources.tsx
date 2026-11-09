import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryImage, UnsplashPhoto } from '@shared/media'
import type { EditState, ProjectMeta } from '@shared/types'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/lib/settings'
import { Search, Upload, X } from '@renderer/lib/icons'
import { Button, cx } from '@renderer/lib/ui'

type Update = (fn: (e: EditState) => EditState, key?: string) => void

const libUrl = (file: string): string => `media://lib/${encodeURIComponent(file)}`

/** Recently used background images (cached on this Mac — available offline). */
export function RecentImages({
  project,
  edit,
  update
}: {
  project: ProjectMeta
  edit: EditState
  update: Update
}): React.JSX.Element | null {
  const [items, setItems] = useState<LibraryImage[]>([])
  const refresh = useCallback(() => void api.backgrounds.recent().then(setItems), [])
  useEffect(refresh, [refresh, edit.background.value])
  if (!items.length) return null
  const current = edit.background.kind === 'image' ? edit.background.value.replace(/^bg-/, '') : ''
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium tracking-wide text-ink-400 uppercase">Recent · works offline</div>
      <div className="grid grid-cols-3 gap-2">
        {items.slice(0, 12).map((it) => (
          <div key={it.file} className="group relative">
            <button
              title={it.credit ? `Photo by ${it.credit.name} on ${it.credit.source}` : 'Your image'}
              onClick={async () => {
                const r = await api.backgrounds.use(project.id, it.file)
                update((e) => ({
                  ...e,
                  background: { ...e.background, kind: 'image', value: r.file, credit: r.credit }
                }))
              }}
              className={cx(
                'block aspect-video w-full overflow-hidden rounded-lg ring-offset-2 ring-offset-ink-850',
                current === it.file ? 'ring-2 ring-white' : 'ring-1 ring-white/10 hover:ring-white/30'
              )}
            >
              <img src={libUrl(it.file)} alt="" loading="lazy" className="size-full object-cover" />
            </button>
            <button
              title="Remove from recent"
              onClick={() => void api.backgrounds.remove(it.file).then(refresh)}
              className="absolute top-1 right-1 hidden size-5 place-items-center rounded-full bg-black/70 text-white group-hover:grid"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ImageTab({
  project,
  edit,
  update
}: {
  project: ProjectMeta
  edit: EditState
  update: Update
}): React.JSX.Element {
  const bg = edit.background
  const pick = async (): Promise<void> => {
    const name = await api.projects.importImage(project.id)
    if (name) update((e) => ({ ...e, background: { ...e.background, kind: 'image', value: name, credit: undefined } }))
  }
  return (
    <div className="space-y-4">
      {bg.kind === 'image' && !bg.credit ? (
        <div className="space-y-3">
          <img
            src={`media://p/${encodeURIComponent(project.id)}/${encodeURIComponent(bg.value)}`}
            alt=""
            className="aspect-video w-full rounded-xl object-cover ring-1 ring-white/10"
          />
          <Button size="sm" onClick={() => void pick()}>
            <Upload size={13} /> Replace image
          </Button>
        </div>
      ) : (
        <button
          onClick={() => void pick()}
          className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-ink-300 hover:border-white/30 hover:text-ink-100"
        >
          <Upload size={18} />
          <span className="text-xs">Choose an image…</span>
        </button>
      )}
      <RecentImages project={project} edit={edit} update={update} />
    </div>
  )
}

const ERRORS: Record<string, string> = {
  OFFLINE: 'You’re offline. Images you’ve used before are still available under Image → Recent.',
  BAD_KEY: 'That Unsplash access key was rejected. Check it in Settings → Editing.',
  RATE_LIMIT: 'Unsplash’s hourly limit was reached for this key. Try again later.'
}

export function UnsplashTab({
  project,
  edit,
  update
}: {
  project: ProjectMeta
  edit: EditState
  update: Update
}): React.JSX.Element {
  const { settings, set } = useSettings()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('wallpaper')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<UnsplashPhoto[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [using, setUsing] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const reqId = useRef(0)
  const hasKey = !!settings?.integrations.unsplashKey

  useEffect(() => {
    if (!hasKey) return
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    api.backgrounds
      .search(submitted, page)
      .then((r) => {
        if (id !== reqId.current) return
        setResults((cur) => (page === 1 ? r.results : [...cur, ...r.results]))
        setTotalPages(r.totalPages)
      })
      .catch((err: Error) => {
        if (id !== reqId.current) return
        const code = /(OFFLINE|BAD_KEY|RATE_LIMIT|NO_KEY)/.exec(err.message)?.[1]
        setError(code ? (ERRORS[code] ?? err.message) : err.message)
      })
      .finally(() => id === reqId.current && setLoading(false))
  }, [submitted, page, hasKey])

  if (settings && !hasKey) {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-ink-300">
          Search millions of free photos from Unsplash. Paste a free access key to turn it on — create one at{' '}
          <a
            className="text-brand-300 underline"
            href="https://unsplash.com/oauth/applications"
            target="_blank"
            rel="noreferrer"
          >
            unsplash.com/developers
          </a>
          .
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (keyDraft.trim()) set({ integrations: { unsplashKey: keyDraft.trim() } })
          }}
        >
          <input
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="Access key"
            className="h-8 min-w-0 flex-1 rounded-lg bg-ink-900 px-2.5 text-[13px] ring-1 ring-white/10 outline-none focus:ring-brand-500"
          />
          <Button type="submit" size="sm" variant="primary" disabled={!keyDraft.trim()}>
            Save
          </Button>
        </form>
      </div>
    )
  }

  const credit =
    edit.background.kind === 'image' && edit.background.credit?.source === 'Unsplash' ? edit.background.credit : null

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setSubmitted(query.trim() || 'wallpaper')
        }}
      >
        <label className="flex h-9 items-center gap-2 rounded-xl bg-ink-900 px-3 ring-1 ring-white/10 focus-within:ring-brand-500">
          <Search size={15} className="text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Unsplash"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-500"
          />
        </label>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {['Gradient', 'Abstract', 'Nature', 'Architecture', 'Minimal', 'Ocean'].map((t) => (
          <button
            key={t}
            onClick={() => {
              setQuery(t)
              setPage(1)
              setSubmitted(t)
            }}
            className={cx(
              'h-7 rounded-full px-2.5 text-xs',
              submitted === t ? 'bg-ink-700 text-white' : 'bg-ink-900/70 text-ink-300 hover:text-white'
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {credit && (
        <p className="text-[11px] text-ink-400">
          Current: photo by{' '}
          <a className="text-ink-200 underline" href={credit.url} target="_blank" rel="noreferrer">
            {credit.name}
          </a>{' '}
          on{' '}
          <a
            className="text-ink-200 underline"
            href="https://unsplash.com/?utm_source=toom&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
          >
            Unsplash
          </a>
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {results.map((p) => (
          <button
            key={p.id}
            disabled={!!using}
            title={p.alt || `Photo by ${p.author}`}
            onClick={async () => {
              setUsing(p.id)
              try {
                const r = await api.backgrounds.useUnsplash(project.id, p)
                update((e) => ({
                  ...e,
                  background: { ...e.background, kind: 'image', value: r.file, credit: r.credit }
                }))
              } catch (err) {
                const code = /(OFFLINE)/.exec((err as Error).message)?.[1]
                setError(code ? ERRORS[code] : (err as Error).message)
              } finally {
                setUsing(null)
              }
            }}
            className="group relative aspect-video overflow-hidden rounded-lg ring-1 ring-white/10 hover:ring-white/40"
            style={{ background: p.color }}
          >
            <img src={p.small} alt="" title={p.alt} loading="lazy" className="size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[#000]/70 to-transparent px-1.5 pt-3 pb-1 text-left text-[10px] text-[#fff] opacity-0 group-hover:opacity-100">
              {p.author}
            </span>
            {using === p.id && (
              <span className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] text-white">
                Downloading…
              </span>
            )}
          </button>
        ))}
      </div>
      {loading && <p className="py-2 text-center text-xs text-ink-400">Loading…</p>}
      {!loading && !error && page < totalPages && results.length > 0 && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setPage((p) => p + 1)}>
          Load more
        </Button>
      )}
      <p className="text-[10px] leading-relaxed text-ink-500">
        Photos are downloaded to this Mac when you use them, so they keep working offline.
      </p>
    </div>
  )
}
