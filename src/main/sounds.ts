import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { projectFile } from './projects'
import type { LibrarySound } from '@shared/media'

/**
 * Your own music and sound effects: uploaded files are copied into the project (so it stays
 * self-contained) and into a library in the app data folder, so they can be reused offline.
 */

export const soundsDir = (): string => join(app.getPath('userData'), 'sounds')
const indexFile = (): string => join(soundsDir(), 'index.json')
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm']

async function readIndex(): Promise<LibrarySound[]> {
  try {
    return JSON.parse(await fs.readFile(indexFile(), 'utf8')) as LibrarySound[]
  } catch {
    return []
  }
}

async function writeIndex(items: LibrarySound[]): Promise<void> {
  await fs.mkdir(soundsDir(), { recursive: true })
  await fs.writeFile(indexFile(), JSON.stringify(items.slice(0, 200), null, 2))
}

/** Copy a library sound into a project; returns the project-relative file name. */
async function useInProject(projectId: string, file: string): Promise<string> {
  const name = `snd-${basename(file)}`
  const dst = projectFile(projectId, name)
  try {
    await fs.access(dst)
  } catch {
    await fs.copyFile(join(soundsDir(), basename(file)), dst)
  }
  return name
}

export function registerSoundIpc(): void {
  ipcMain.handle('sounds:import', async (e, projectId: string, kind: 'music' | 'sfx') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: kind === 'music' ? 'Add music' : 'Add a sound effect',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXT }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return []
    await fs.mkdir(soundsDir(), { recursive: true })
    const added: { file: string; name: string; libId: string }[] = []
    const index = await readIndex()
    for (const src of res.filePaths) {
      const ext = extname(src).toLowerCase() || '.mp3'
      const id = randomUUID().slice(0, 12)
      const libFile = `${id}${ext}`
      await fs.copyFile(src, join(soundsDir(), libFile))
      const name = basename(src, extname(src))
      index.unshift({ id, file: libFile, name, kind, addedAt: Date.now() })
      added.push({ file: await useInProject(projectId, libFile), name, libId: id })
    }
    await writeIndex(index)
    return added
  })

  ipcMain.handle('sounds:library', async () => readIndex())

  ipcMain.handle('sounds:use', async (_e, projectId: string, id: string) => {
    const item = (await readIndex()).find((s) => s.id === id)
    if (!item) throw new Error('That sound is no longer in your library.')
    return { file: await useInProject(projectId, item.file), name: item.name }
  })

  ipcMain.handle('sounds:remove', async (_e, id: string) => {
    const items = await readIndex()
    const item = items.find((s) => s.id === id)
    await writeIndex(items.filter((s) => s.id !== id))
    if (item) await fs.rm(join(soundsDir(), basename(item.file)), { force: true })
  })
}
