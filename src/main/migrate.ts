// One-time moves from the app's earlier names (screen.rec, then lowercase "toom") to Toom.
// Imported first in index.ts so it runs before settings or projects touch the disk.
// macOS and Windows treat "toom" and "Toom" as the same folder, so this only moves data on Linux
// or when coming from screen.rec.
import { app } from 'electron'
import { cpSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const OLD_NAMES = ['toom', 'screen.rec']

function isEmptyDir(p: string): boolean {
  try {
    return readdirSync(p).filter((f) => f !== '.DS_Store').length === 0
  } catch {
    return true
  }
}

try {
  app.setName('Toom')
  // app data (settings, background library, models, account)
  const userData = app.getPath('userData')
  if (!existsSync(userData)) {
    const old = OLD_NAMES.map((n) => join(app.getPath('appData'), n)).find((p) => p !== userData && existsSync(p))
    if (old) cpSync(old, userData, { recursive: true })
  }
  // default recordings folder: ~/Movies/screen.rec or ~/Movies/toom → ~/Movies/Toom
  const videos = app.getPath('videos')
  const newRec = join(videos, 'Toom')
  if (!existsSync(newRec)) {
    const old = OLD_NAMES.map((n) => join(videos, n)).find((p) => p !== newRec && existsSync(p) && !isEmptyDir(p))
    if (old) renameSync(old, newRec)
  }
} catch (err) {
  console.warn('[migrate] could not move data from an earlier version', err)
}
