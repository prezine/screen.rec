import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditState, ProjectMeta } from '@shared/types'
import { clipAt } from '@shared/clips'
import {
  deleteWords,
  fillerIndices,
  isKept,
  longPauses,
  paragraphs,
  removeFillers,
  replaceWords,
  restoreWords,
  trimPauses,
  type Transcript,
  type Word
} from '@shared/transcript'
import {
  loadTranscript,
  saveTranscript,
  startTranscription,
  WHISPER_MODELS,
  type TranscribeJob,
  type TranscribeProgress
} from '@renderer/engine/transcribe'
import { formatTime } from '@renderer/engine/math'
import { useSettings } from '@renderer/lib/settings'
import { Button, Section, Segmented, cx } from '@renderer/lib/ui'
import { Pencil, RotateCcw, Sparkles, Trash, Undo2, X } from '@renderer/lib/icons'

type Update = (fn: (e: EditState) => EditState, key?: string) => void

const LANGS: [string, string][] = [
  ['', 'Detect automatically'],
  ['en', 'English'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['de', 'German'],
  ['yo', 'Yoruba'],
  ['ha', 'Hausa'],
  ['sw', 'Swahili'],
  ['ar', 'Arabic'],
  ['zh', 'Chinese'],
  ['hi', 'Hindi']
]

export function TranscriptPanel({
  project,
  edit,
  update,
  time,
  onSeek,
  onTranscript
}: {
  project: ProjectMeta
  edit: EditState
  update: Update
  time: number
  onSeek: (t: number) => void
  /** tells the editor when the transcript changes (captions use it) */
  onTranscript?: (t: Transcript | null) => void
}): React.JSX.Element {
  const { settings, set } = useSettings()
  const [transcript, setTranscript] = useState<Transcript | null | undefined>(undefined)
  useEffect(() => {
    if (transcript !== undefined) onTranscript?.(transcript)
  }, [transcript, onTranscript])
  const [job, setJob] = useState<TranscribeJob | null>(null)
  const [progress, setProgress] = useState<TranscribeProgress | null>(null)
  const [partial, setPartial] = useState<Word[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const dragging = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** words being corrected inline (a range: several words can become one, or one several) */
  const [editing, setEditing] = useState<{ lo: number; hi: number; text: string } | null>(null)
  /** earlier versions of the words, for "Undo text edit" */
  const [textHistory, setTextHistory] = useState<Word[][]>([])
  /** Enter/Tab commit, then the input's blur would commit again */
  const committed = useRef(false)

  useEffect(() => {
    let alive = true
    void loadTranscript(project.id).then((t) => alive && setTranscript(t))
    return () => {
      alive = false
    }
  }, [project.id])

  useEffect(() => () => job?.cancel(), [job])

  const generate = (): void => {
    if (!settings) return
    setError(null)
    setPartial([])
    const j = startTranscription(
      project.id,
      project.files.screen,
      project.duration,
      { model: settings.transcription.model, language: settings.transcription.language },
      setProgress,
      (w) => setPartial((cur) => [...cur, ...w])
    )
    setJob(j)
    j.promise
      .then(async (words) => {
        const t: Transcript = {
          version: 1,
          model: WHISPER_MODELS[settings.transcription.model].id,
          language: settings.transcription.language || undefined,
          createdAt: Date.now(),
          words
        }
        await saveTranscript(project.id, t)
        setTranscript(t)
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
      .finally(() => {
        setJob(null)
        setProgress(null)
      })
  }

  const words = transcript?.words ?? partial
  const lo = sel ? Math.min(sel[0], sel[1]) : -1
  const hi = sel ? Math.max(sel[0], sel[1]) : -1
  const selDeleted = sel ? words.slice(lo, hi + 1).every((w) => !isKept(w, edit.clips)) : false

  const applyDelete = useCallback(() => {
    if (!sel || !transcript) return
    update((e) => {
      const next = deleteWords(e.clips, transcript.words, lo, hi)
      return next.length ? { ...e, clips: next } : e
    })
    setSel(null)
  }, [sel, transcript, update, lo, hi])

  const applyRestore = useCallback(() => {
    if (!sel || !transcript) return
    update((e) => ({ ...e, clips: restoreWords(e.clips, transcript.words, lo, hi, project.duration) }))
    setSel(null)
  }, [sel, transcript, update, lo, hi, project.duration])

  const startEditing = useCallback(
    (a: number, b: number) => {
      if (!transcript) return
      const lo2 = Math.min(a, b)
      const hi2 = Math.max(a, b)
      setSel(null)
      committed.current = false
      setEditing({
        lo: lo2,
        hi: hi2,
        text: transcript.words
          .slice(lo2, hi2 + 1)
          .map((w) => w.text)
          .join('')
          .trim()
      })
    },
    [transcript]
  )

  const saveWords = useCallback(
    (next: Word[], prev: Word[]) => {
      if (!transcript) return
      const t: Transcript = { ...transcript, words: next, editedAt: Date.now() }
      setTranscript(t)
      setTextHistory((h) => [...h.slice(-49), prev])
      void saveTranscript(project.id, t)
    },
    [transcript, project.id]
  )

  /** Save the inline edit; `then` moves on to the next word (Tab) */
  const commitEdit = useCallback(
    (then?: 'next' | 'prev') => {
      if (!editing || !transcript || committed.current) return setEditing(null)
      committed.current = true
      const before = transcript.words
        .slice(editing.lo, editing.hi + 1)
        .map((w) => w.text)
        .join('')
        .trim()
      let words2 = transcript.words
      let added = editing.hi - editing.lo + 1
      if (editing.text.trim() !== before) {
        words2 = replaceWords(transcript.words, editing.lo, editing.hi, editing.text)
        added = editing.text.split(/\s+/).filter(Boolean).length
        saveWords(words2, transcript.words)
      }
      const nextIdx = then === 'next' ? editing.lo + added : then === 'prev' ? editing.lo - 1 : -1
      if (nextIdx >= 0 && nextIdx < words2.length) {
        committed.current = false
        setEditing({ lo: nextIdx, hi: nextIdx, text: words2[nextIdx].text.trim() })
      } else setEditing(null)
    },
    [editing, transcript, saveWords]
  )

  const undoText = (): void => {
    const prev = textHistory[textHistory.length - 1]
    if (!prev || !transcript) return
    const t: Transcript = { ...transcript, words: prev, editedAt: Date.now() }
    setTranscript(t)
    setTextHistory((h) => h.slice(0, -1))
    setEditing(null)
    void saveTranscript(project.id, t)
  }

  // ⌫ deletes the selected words (captured before the editor's own shortcuts)
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (selDeleted) applyRestore()
        else applyDelete()
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setSel(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel, selDeleted, applyDelete, applyRestore])

  useEffect(() => {
    const up = (): void => {
      dragging.current = false
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  // keep the current word in view while playing
  const currentIdx = useMemo(() => words.findIndex((w) => time >= w.start && time < w.end + 0.05), [words, time])
  useEffect(() => {
    if (currentIdx < 0 || sel) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-w="${currentIdx}"]`)
    const box = scrollRef.current
    if (!el || !box) return
    const r = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top + 40 || r.bottom > b.bottom - 40) box.scrollTop += r.top - b.top - b.height / 3
  }, [currentIdx, sel])

  const paras = useMemo(() => paragraphs(words), [words])
  const fillers = transcript ? fillerIndices(transcript.words, edit.clips).length : 0
  const pauses = transcript ? longPauses(transcript.words, edit.clips, 1).length : 0

  if (transcript === undefined || !settings)
    return (
      <Section title="Transcript">
        <p className="text-xs text-ink-400">Loading…</p>
      </Section>
    )

  // ---- not transcribed yet / in progress
  if (!transcript) {
    const m = settings.transcription.model
    return (
      <>
        <Section title="Transcript">
          <p className="mb-4 text-xs leading-relaxed text-ink-300">
            Turn speech into text, then edit the video by editing the words — delete a sentence and that part of the
            video is cut. Runs entirely on this Mac.
          </p>
          {!job ? (
            <>
              <div className="mb-1.5 text-xs text-ink-300">Model</div>
              <div className="mb-3">
                <Segmented
                  size="sm"
                  value={m}
                  onChange={(v) => set({ transcription: { model: v } })}
                  options={[
                    { value: 'fast', label: `Fast · ${WHISPER_MODELS.fast.size}` },
                    { value: 'accurate', label: `Accurate · ${WHISPER_MODELS.accurate.size}` }
                  ]}
                />
              </div>
              <div className="mb-1.5 text-xs text-ink-300">Language</div>
              <select
                value={settings.transcription.language}
                onChange={(e) => set({ transcription: { language: e.target.value } })}
                className="mb-4 h-8 w-full rounded-lg bg-ink-900 px-2 text-[13px] ring-1 ring-white/10 outline-none"
              >
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <Button variant="primary" className="w-full" onClick={generate}>
                <Sparkles size={14} /> Generate transcript
              </Button>
              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-400">
                The model downloads once ({WHISPER_MODELS[m].size}) and is cached — after that it works offline.
              </p>
            </>
          ) : (
            <div>
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-ink-200">
                  {progress?.stage === 'audio' && 'Reading audio…'}
                  {progress?.stage === 'download' && `Downloading speech model… ${progress.detail ?? ''}`}
                  {progress?.stage === 'transcribe' && 'Transcribing…'}
                  {!progress && 'Starting…'}
                </span>
                <span className="tabular-nums text-ink-400">{Math.round((progress?.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
                />
              </div>
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => job.cancel()}>
                <X size={13} /> Cancel
              </Button>
            </div>
          )}
          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-300 ring-1 ring-red-500/20">
              {error}
            </p>
          )}
        </Section>
        {partial.length > 0 && (
          <div className="px-5 pb-5 text-[13px] leading-7 text-ink-300">{partial.map((w) => w.text).join('')}</div>
        )}
      </>
    )
  }

  // ---- editable transcript
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/[0.06] px-5 pt-5 pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Transcript</h3>
          <span className="flex-1" />
          {textHistory.length > 0 && (
            <button
              className="mr-3 flex items-center gap-1 text-[11px] text-ink-300 hover:text-white"
              title="Undo the last text correction"
              onClick={undoText}
            >
              <Undo2 size={11} /> Undo text edit
            </button>
          )}
          <button
            className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-white"
            title="Transcribe again"
            onClick={() => {
              if (transcript.editedAt && !window.confirm('Transcribe again? Your text corrections will be lost.'))
                return
              setTranscript(null)
              setSel(null)
              setTextHistory([])
            }}
          >
            <RotateCcw size={11} /> Redo
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            disabled={!fillers}
            onClick={() => update((e) => ({ ...e, clips: removeFillers(e.clips, transcript.words) }))}
          >
            Remove {fillers || ''} filler{fillers === 1 ? '' : 's'}
          </Button>
          <Button
            size="sm"
            disabled={!pauses}
            onClick={() => update((e) => ({ ...e, clips: trimPauses(e.clips, transcript.words, 1, 0.25) }))}
          >
            Trim {pauses || ''} pause{pauses === 1 ? '' : 's'}
          </Button>
        </div>
        {sel ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brand-500/10 px-3 py-2 ring-1 ring-brand-500/30">
            <span className="flex-1 text-xs text-ink-200">
              {hi - lo + 1} word{hi === lo ? '' : 's'} · {formatTime(words[lo].start, true)}
            </span>
            <Button size="sm" onClick={() => startEditing(lo, hi)} title="Correct the text (captions use it)">
              <Pencil size={12} /> Edit
            </Button>
            {selDeleted ? (
              <Button size="sm" onClick={applyRestore}>
                <RotateCcw size={12} /> Restore
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={applyDelete}>
                <Trash size={12} /> Cut <span className="text-[10px] opacity-70">⌫</span>
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            Click a word to jump to it. Double-click to fix its text — captions update too. Drag across words, then
            press ⌫ to cut them from the video.
          </p>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[14px] leading-[1.9] select-none">
        {transcript.words.length === 0 && (
          <p className="text-xs text-ink-400">No speech was found in this recording.</p>
        )}
        {paras.map((idxs) => {
          const first = transcript.words[idxs[0]]
          return (
            <p key={idxs[0]} className="mb-4">
              <span className="mr-2 align-middle text-[10px] font-medium tabular-nums text-ink-500">
                {formatTime(first.start)}
              </span>
              {idxs.map((i) => {
                if (editing && i > editing.lo && i <= editing.hi) return null
                if (editing && i === editing.lo)
                  return (
                    <input
                      key={`edit-${i}`}
                      autoFocus
                      value={editing.text}
                      size={Math.max(2, editing.text.length + 1)}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onBlur={() => commitEdit()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          committed.current = true
                          setEditing(null)
                        } else if (e.key === 'Tab') {
                          e.preventDefault()
                          commitEdit(e.shiftKey ? 'prev' : 'next')
                        }
                      }}
                      aria-label="Correct the word"
                      className="mx-1 rounded-[5px] bg-black/40 px-1 py-0.5 text-[14px] text-white ring-2 ring-brand-400 outline-none"
                    />
                  )
                const w = transcript.words[i]
                const kept = clipAt((w.start + w.end) / 2, edit.clips) !== null
                const selected = i >= lo && i <= hi
                return (
                  <span
                    key={i}
                    data-w={i}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return
                      e.preventDefault()
                      dragging.current = true
                      if (e.shiftKey && sel) setSel([sel[0], i])
                      else {
                        setSel([i, i])
                        onSeek(w.start)
                      }
                    }}
                    onPointerEnter={() => {
                      if (dragging.current && sel) setSel([sel[0], i])
                    }}
                    onDoubleClick={() => startEditing(i, i)}
                    title="Double-click to fix the text"
                    className={cx(
                      'cursor-text rounded-[4px] py-0.5 transition-colors',
                      !kept && 'text-ink-500 line-through decoration-red-400/70',
                      kept && 'text-ink-100',
                      selected
                        ? 'bg-brand-500/40 text-white'
                        : i === currentIdx
                          ? 'bg-white/15'
                          : 'hover:bg-white/[0.07]'
                    )}
                  >
                    {w.text}
                  </span>
                )
              })}
            </p>
          )
        })}
      </div>
    </div>
  )
}
