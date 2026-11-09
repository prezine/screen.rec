import type { Word } from '@shared/transcript'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FolderOpen, X } from '@renderer/lib/icons'
import { contentSize, type CursorData, type EditState, type ExportSettings, type ProjectMeta } from '@shared/types'
import { defaultExportSettings } from '@shared/defaults'
import { api } from '@renderer/lib/api'
import { useSettings } from '@renderer/lib/settings'
import { totalLength } from '@shared/clips'
import { exportVideo } from '@renderer/engine/exporter'
import { outputSize } from '@renderer/engine/compositor'
import { Button, Field, Segmented } from '@renderer/lib/ui'
import { openUpgrade, useLimits } from '@renderer/lib/account'
import { clampExport } from '@shared/account'

const ProTag = (): React.JSX.Element => (
  <span className="rounded-[5px] bg-brand-500/20 px-1 py-px text-[9px] font-bold tracking-wide text-brand-300">
    PRO
  </span>
)

interface Props {
  project: ProjectMeta
  edit: EditState
  cursor: CursorData
  /** transcript words, for burned-in captions */
  words?: Word[]
  faceTrack?: import('@renderer/engine/faceTrack').FaceTrack | null
  onClose: () => void
}

export function ExportDialog({ project, edit, cursor, words, faceTrack, onClose }: Props): React.JSX.Element {
  const app = useSettings()
  const { limits, account } = useLimits()
  const plan = account?.plan ?? 'free'
  const [wanted, setSettings] = useState<ExportSettings>(defaultExportSettings)
  // what will actually be exported on this plan
  const settings = clampExport(wanted, plan)
  const [upsell, setUpsell] = useState(false)
  const seeded = useRef(false)
  useEffect(() => {
    if (!app.settings || seeded.current) return
    seeded.current = true
    const { resolution, fps, quality } = app.settings.export
    setSettings({ resolution, fps, quality })
  }, [app.settings])
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [info, setInfo] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const cs = contentSize(project.source)
  const size = outputSize(edit.aspect, cs.w, cs.h, settings.resolution)
  const opt = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]): void => {
    const locked =
      (k === 'resolution' && (v as number) > limits.maxExportHeight) ||
      (k === 'fps' && (v as number) > limits.maxExportFps)
    if (locked) return setUpsell(true)
    setSettings((s) => ({ ...s, [k]: v }))
  }
  const lock = (over: boolean, label: string): React.ReactNode =>
    over ? (
      <>
        {label} <ProTag />
      </>
    ) : (
      label
    )

  const run = async (): Promise<void> => {
    // remember what they asked for, so it comes back after upgrading
    app.set({ export: wanted })
    const safe =
      project.name
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .slice(0, 60) || 'recording'
    const target = await api.exportFile.choosePath(`${safe}.mp4`)
    if (!target) return
    setPath(target.path)
    setPhase('running')
    setProgress(0)
    setError(null)
    const ac = new AbortController()
    abort.current = ac
    try {
      await exportVideo({
        project,
        edit,
        cursor,
        words,
        faceTrack,
        settings,
        watermark: limits.watermark,
        token: target.token,
        signal: ac.signal,
        onProgress: (p, i) => {
          setProgress(p)
          setInfo(i)
        }
      })
      setPhase('done')
      if (app.settings?.export.revealAfterExport) void api.exportFile.showItem(target.path)
    } catch (err) {
      if (ac.signal.aborted) {
        setPhase('idle')
        return
      }
      console.error(err)
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 backdrop-blur-md">
      <div className="w-[440px] glass-strong rounded-[24px]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-[15px] font-semibold">Export video</h2>
          {phase !== 'running' && (
            <button
              onClick={onClose}
              className="grid size-7 place-items-center rounded-lg text-ink-400 hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-5 py-5">
          {phase === 'idle' && (
            <>
              <Field label="Resolution">
                <Segmented
                  value={settings.resolution}
                  onChange={(v) => opt('resolution', v)}
                  options={[
                    { value: 720, label: '720p' },
                    { value: 1080, label: lock(1080 > limits.maxExportHeight, '1080p') },
                    { value: 1440, label: lock(1440 > limits.maxExportHeight, '1440p') },
                    { value: 2160, label: lock(2160 > limits.maxExportHeight, '4K') }
                  ]}
                />
              </Field>
              <Field label="Frame rate">
                <Segmented
                  value={settings.fps}
                  onChange={(v) => opt('fps', v)}
                  options={[
                    { value: 30, label: '30 fps' },
                    { value: 60, label: lock(60 > limits.maxExportFps, '60 fps') }
                  ]}
                />
              </Field>
              <Field label="Quality">
                <Segmented
                  value={settings.quality}
                  onChange={(v) => opt('quality', v)}
                  options={[
                    { value: 'medium', label: 'Smaller' },
                    { value: 'high', label: 'High' },
                    { value: 'very-high', label: 'Best' }
                  ]}
                />
              </Field>
              <div className="mt-5 flex items-center justify-between rounded-xl bg-ink-900 px-3.5 py-3 text-xs text-ink-300 ring-1 ring-white/[0.05]">
                <span>MP4 · H.264</span>
                <span className="tabular-nums">
                  {size.w}×{size.h} · {totalLength(edit.clips).toFixed(1)}s
                </span>
              </div>
              {(limits.watermark || upsell) && (
                <div className="mt-3 flex items-center gap-3 rounded-xl bg-brand-500/[0.08] px-3.5 py-3 text-xs ring-1 ring-brand-500/20">
                  <p className="min-w-0 flex-1 text-ink-200">
                    {upsell
                      ? 'Higher resolutions and 60 fps come with Toom Pro.'
                      : 'Free exports are 720p and carry a small “Made with Toom” mark.'}
                  </p>
                  <Button size="sm" variant="primary" onClick={openUpgrade}>
                    {account?.user ? 'Upgrade' : 'Get Pro'}
                  </Button>
                </div>
              )}
            </>
          )}

          {phase === 'running' && (
            <div className="py-2">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-ink-200">Rendering…</span>
                <span className="tabular-nums text-ink-400">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-400 tabular-nums">{info}</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col items-center py-3 text-center">
              <CheckCircle2 size={36} className="mb-3 text-emerald-400" />
              <p className="font-medium">Export finished</p>
              <p className="mt-1 max-w-full truncate text-xs text-ink-400">{path}</p>
            </div>
          )}

          {phase === 'error' && (
            <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300 ring-1 ring-red-500/20">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          {phase === 'idle' && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void run()}>
                Export…
              </Button>
            </>
          )}
          {phase === 'running' && (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel export
            </Button>
          )}
          {phase === 'done' && (
            <>
              <Button variant="ghost" onClick={() => path && void api.exportFile.showItem(path)}>
                <FolderOpen size={14} /> Show in folder
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          )}
          {phase === 'error' && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button variant="primary" onClick={() => setPhase('idle')}>
                Try again
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
