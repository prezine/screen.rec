import { app, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { getSettings } from './settings'
import { projectFile } from './projects'
import type { Credit, LibraryImage, UnsplashPhoto } from '@shared/media'

/**
 * Background image library: every image used as a background (Unsplash or your own) is cached in
 * the app data folder, so it can be reused across projects and offline.
 */

export const libraryDir = (): string => join(app.getPath('userData'), 'backgrounds')
const indexFile = (): string => join(libraryDir(), 'index.json')
const UTM = 'utm_source=toom&utm_medium=referral'

async function readIndex(): Promise<LibraryImage[]> {
  try {
    return JSON.parse(await fs.readFile(indexFile(), 'utf8')) as LibraryImage[]
  } catch {
    return []
  }
}

async function writeIndex(items: LibraryImage[]): Promise<void> {
  await fs.mkdir(libraryDir(), { recursive: true })
  await fs.writeFile(indexFile(), JSON.stringify(items.slice(0, 60), null, 2))
}

async function addToLibrary(item: LibraryImage): Promise<void> {
  const items = (await readIndex()).filter((i) => i.file !== item.file)
  await writeIndex([item, ...items])
}

/** Copy a library image into a project folder; returns the project-relative file name. */
async function useInProject(projectId: string, file: string): Promise<string> {
  const name = `bg-${basename(file)}`
  const dst = projectFile(projectId, name)
  try {
    await fs.access(dst)
  } catch {
    await fs.copyFile(join(libraryDir(), basename(file)), dst)
  }
  return name
}

function key(): string {
  const k = getSettings().integrations.unsplashKey.trim()
  if (!k) throw new Error('NO_KEY')
  return k
}

async function unsplash(path: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`https://api.unsplash.com${path}`, {
      headers: { Authorization: `Client-ID ${key()}`, 'Accept-Version': 'v1' }
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_KEY') throw err
    throw new Error('OFFLINE')
  }
  if (res.status === 401) throw new Error('BAD_KEY')
  if (res.status === 403) throw new Error('RATE_LIMIT')
  if (!res.ok) throw new Error(`Unsplash error ${res.status}`)
  return res.json()
}

interface RawPhoto {
  id: string
  width: number
  height: number
  color: string
  alt_description: string | null
  description: string | null
  urls: { raw: string; small: string; thumb: string }
  links: { download_location: string }
  user: { name: string; links: { html: string } }
}

function toPhoto(p: RawPhoto): UnsplashPhoto {
  return {
    id: p.id,
    thumb: p.urls.thumb,
    small: p.urls.small,
    raw: p.urls.raw,
    color: p.color,
    width: p.width,
    height: p.height,
    alt: p.alt_description ?? p.description ?? '',
    author: p.user.name,
    authorUrl: `${p.user.links.html}?${UTM}`,
    downloadLocation: p.links.download_location
  }
}

export function registerBackgroundIpc(): void {
  ipcMain.handle('unsplash:search', async (_e, query: string, page = 1) => {
    const q = query.trim()
    if (!q) {
      const list = (await unsplash(`/photos?per_page=24&page=${page}&order_by=popular`)) as RawPhoto[]
      return { results: list.map(toPhoto), totalPages: 20 }
    }
    const data = (await unsplash(
      `/search/photos?query=${encodeURIComponent(q)}&per_page=24&page=${page}&orientation=landscape&content_filter=high`
    )) as { results: RawPhoto[]; total_pages: number }
    return { results: data.results.map(toPhoto), totalPages: data.total_pages }
  })

  ipcMain.handle('unsplash:use', async (_e, projectId: string, photo: UnsplashPhoto) => {
    const file = `unsplash-${photo.id}.jpg`
    const path = join(libraryDir(), file)
    try {
      await fs.access(path)
    } catch {
      // Unsplash API guidelines: register the download, then fetch the image.
      void unsplash(new URL(photo.downloadLocation).pathname + new URL(photo.downloadLocation).search).catch(
        () => undefined
      )
      const url = `${photo.raw}${photo.raw.includes('?') ? '&' : '?'}w=3840&q=85&fm=jpg&fit=max`
      let res: Response
      try {
        res = await fetch(url)
      } catch {
        throw new Error('OFFLINE')
      }
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      await fs.mkdir(libraryDir(), { recursive: true })
      await fs.writeFile(path, new Uint8Array(await res.arrayBuffer()))
    }
    const credit: Credit = { name: photo.author, url: photo.authorUrl, source: 'Unsplash' }
    await addToLibrary({ file, credit, addedAt: Date.now() })
    return { file: await useInProject(projectId, file), credit }
  })

  ipcMain.handle('backgrounds:recent', () => readIndex())

  ipcMain.handle('backgrounds:use', async (_e, projectId: string, file: string) => {
    const items = await readIndex()
    const item = items.find((i) => i.file === basename(file))
    if (!item) throw new Error('Image not found in library')
    await addToLibrary({ ...item, addedAt: Date.now() })
    return { file: await useInProject(projectId, item.file), credit: item.credit }
  })

  ipcMain.handle('backgrounds:remove', async (_e, file: string) => {
    const items = await readIndex()
    await writeIndex(items.filter((i) => i.file !== basename(file)))
    await fs.rm(join(libraryDir(), basename(file)), { force: true })
  })
}

/** Called when the user picks their own image: keep a copy in the library too. */
export async function addLocalImageToLibrary(src: string): Promise<void> {
  const ext = extname(src).toLowerCase() || '.png'
  const file = `local-${Date.now()}${ext}`
  await fs.mkdir(libraryDir(), { recursive: true })
  await fs.copyFile(src, join(libraryDir(), file))
  await addToLibrary({ file, addedAt: Date.now() })
}
