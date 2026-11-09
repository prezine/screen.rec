import { app } from 'electron'
import { promises as fs, createReadStream } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import type { CursorData, ProjectMeta, RecordingOptions } from '@shared/types'
import { getSettings } from './settings'

export function defaultProjectsRoot(): string {
  return join(app.getPath('videos'), 'Toom')
}

export function projectsRoot(): string {
  const custom = getSettings().general.recordingsFolder
  // a folder chosen before the rename may have been moved along with the default one
  if (custom && ['screen.rec', 'toom'].some((n) => custom === join(app.getPath('videos'), n)))
    return defaultProjectsRoot()
  return custom || defaultProjectsRoot()
}

export function projectDir(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`)
  return join(projectsRoot(), id)
}

/** Resolve a file inside a project, refusing anything that escapes the project folder. */
export function projectFile(id: string, name: string): string {
  const dir = resolve(projectDir(id))
  const full = resolve(dir, name)
  if (!full.startsWith(dir + sep)) throw new Error(`Invalid file path: ${name}`)
  return full
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export async function createProject(opts: RecordingOptions): Promise<ProjectMeta> {
  const d = new Date()
  const id = `rec-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  await fs.mkdir(projectDir(id), { recursive: true })
  const meta: ProjectMeta = {
    id,
    name: `${opts.kind === 'area' ? `${opts.sourceName} (area)` : opts.sourceName} — ${d.toLocaleString()}`,
    createdAt: d.getTime(),
    status: 'recording',
    source: { kind: opts.kind, name: opts.sourceName, displayId: opts.displayId, width: 0, height: 0, crop: opts.crop },
    files: { screen: 'screen.webm', camera: opts.camera ? 'camera.webm' : undefined },
    cameraOffset: 0,
    duration: 0
  }
  await saveProject(meta)
  return meta
}

export async function saveProject(meta: ProjectMeta): Promise<void> {
  const file = projectFile(meta.id, 'project.json')
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2))
  await fs.rename(tmp, file)
}

export async function getProject(id: string): Promise<ProjectMeta | null> {
  try {
    return JSON.parse(await fs.readFile(projectFile(id, 'project.json'), 'utf8')) as ProjectMeta
  } catch {
    return null
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await fs.mkdir(projectsRoot(), { recursive: true })
  const entries = await fs.readdir(projectsRoot(), { withFileTypes: true })
  const metas = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => getProject(e.name).catch(() => null))
  )
  return metas
    .filter((m): m is ProjectMeta => !!m && m.status !== 'recording')
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true })
}

export async function writeCursor(id: string, data: CursorData): Promise<void> {
  await fs.writeFile(projectFile(id, 'cursor.json'), JSON.stringify(data))
}

export async function readCursor(id: string): Promise<CursorData> {
  try {
    return JSON.parse(await fs.readFile(projectFile(id, 'cursor.json'), 'utf8')) as CursorData
  } catch {
    return { samples: [], clicks: [], tracked: false }
  }
}

export async function copyIntoProject(id: string, src: string): Promise<string> {
  const name = `bg-${Date.now()}-${basename(src).replace(/[^a-zA-Z0-9._-]/g, '_')}`
  await fs.copyFile(src, projectFile(id, name))
  return name
}

// ---------- chunked appends (crash-safe recording) ----------

const appendQueues = new Map<string, Promise<void>>()

export function appendToFile(path: string, data: ArrayBuffer): Promise<void> {
  const prev = appendQueues.get(path) ?? Promise.resolve()
  const next = prev.then(() => fs.appendFile(path, Buffer.from(data)))
  appendQueues.set(
    path,
    next.catch(() => undefined)
  )
  return next
}

export async function flushAppends(): Promise<void> {
  await Promise.all([...appendQueues.values()])
  appendQueues.clear()
}

// ---------- positional writers (used by conversion + export) ----------

interface Writer {
  handle: fs.FileHandle
  path: string
}
const writers = new Map<number, Writer & { owner: number }>()
let nextWriter = 1

/** `owner` is the webContents id; its writers are closed if that window goes away mid-write. */
export async function openWriter(path: string, owner = 0): Promise<number> {
  const handle = await fs.open(path, 'w')
  const id = nextWriter++
  writers.set(id, { handle, path, owner })
  return id
}

export async function writeAt(id: number, position: number, data: Uint8Array): Promise<void> {
  const w = writers.get(id)
  if (!w) throw new Error('Writer closed')
  if (!Number.isSafeInteger(position) || position < 0) throw new Error('Bad write position')
  await w.handle.write(data, 0, data.byteLength, position)
}

/** Close a writer; `discard` deletes the half-written file (a failed or cancelled export). */
export async function closeWriter(id: number, discard = false): Promise<string | null> {
  const w = writers.get(id)
  if (!w) return null
  writers.delete(id)
  await w.handle.close()
  if (discard) await fs.rm(w.path, { force: true }).catch(() => undefined)
  return w.path
}

/** A window closed or crashed: release its open files. */
export async function closeWritersOf(owner: number): Promise<void> {
  for (const [id, w] of writers) if (w.owner === owner) await closeWriter(id).catch(() => undefined)
}

export { createReadStream }
