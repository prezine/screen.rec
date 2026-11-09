// How much disk Toom uses, and clearing what can be downloaded again.
import { app, ipcMain, session } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { projectsRoot } from './projects'

export interface StorageUsage {
  recordings: number
  /** speech model, face/cutout models, browser caches — all re-downloadable */
  downloads: number
  /** background and sound libraries */
  libraries: number
}

async function dirSize(dir: string, depth = 0): Promise<number> {
  if (depth > 6) return 0
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(p, depth + 1)
    else if (e.isFile())
      total += await fs.stat(p).then(
        (s) => s.size,
        () => 0
      )
  }
  return total
}

const userData = (...p: string[]): string => join(app.getPath('userData'), ...p)

export async function storageUsage(): Promise<StorageUsage> {
  const [recordings, models, cacheStorage, http, backgrounds, sounds] = await Promise.all([
    dirSize(projectsRoot()),
    dirSize(userData('models')),
    dirSize(userData('Service Worker', 'CacheStorage')),
    session.defaultSession.getCacheSize(),
    dirSize(userData('backgrounds')),
    dirSize(userData('sounds'))
  ])
  return { recordings, downloads: models + cacheStorage + http, libraries: backgrounds + sounds }
}

/** Remove downloaded models and caches. They download again when a feature needs them. */
export async function clearDownloads(): Promise<StorageUsage> {
  await session.defaultSession.clearCache()
  await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] })
  await fs.rm(userData('models'), { recursive: true, force: true })
  return storageUsage()
}

export function registerStorageIpc(): void {
  ipcMain.handle('storage:usage', () => storageUsage())
  ipcMain.handle('storage:clearDownloads', () => clearDownloads())
}
