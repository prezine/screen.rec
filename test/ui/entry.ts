// UI harness: boots the real renderer with a mocked preload API backed by a tiny local file server.
const BASE = `${location.origin}/p`
;(globalThis as { __MEDIA_BASE__?: string }).__MEDIA_BASE__ = BASE

const json = async <T>(name: string): Promise<T> => (await fetch(`${BASE}/demo/${name}`)).json() as Promise<T>
const post = (name: string, body: BodyInit, op = 'put', extra = ''): Promise<Response> =>
  fetch(`${BASE}/demo/${name}?op=${op}${extra}`, { method: 'POST', body })

import { DEFAULT_SETTINGS, mergeSettings, type AppSettings, type SettingsPatch } from '@shared/settings'
import { accountApi } from './account-mock'

let settings: AppSettings = mergeSettings(DEFAULT_SETTINGS, {
  devices: { cameraId: null, microphoneId: 'default', systemAudio: false },
  editing: { autoPrivacy: false } // the harness runs the scan explicitly
})
const settingsListeners = new Set<(s: AppSettings) => void>()
const setSettings = (p: SettingsPatch): AppSettings => {
  settings = mergeSettings(settings, p)
  settingsListeners.forEach((l) => l(settings))
  return settings
}
;(window as unknown as { __setSettings: typeof setSettings }).__setSettings = setSettings

const qs = new URLSearchParams(location.search)
;(window as unknown as { __drag: unknown[] }).__drag = []
const recListeners = new Set<(s: unknown) => void>()
;(window as unknown as { __emitRec: (s: unknown) => void }).__emitRec = (st) => recListeners.forEach((l) => l(st))

let nextHandle = 1
const handles = new Map<number, string>()
const noop = (): (() => void) => () => undefined

;(window as unknown as { api: unknown }).api = {
  platform: async () => 'darwin',
  version: async () => '0.3.0',
  newRecording: async () => undefined,
  account: accountApi,
  updater: {
    status: async () => ({ state: 'none', checkedAt: Date.now() }),
    check: async () => ({ state: 'none', checkedAt: Date.now() }),
    install: async () => false,
    onStatus: noop
  },
  onboarding: {
    finish: async () => ((window as unknown as { __finished: boolean }).__finished = true),
    show: async () => undefined
  },
  app: {
    showLauncher: async () => undefined,
    showLibrary: async () => undefined,
    showSettings: async () => undefined,
    quit: async () => undefined,
    confirm: async () => true,
    relaunch: async () => undefined,
    devtools: async () => undefined,
    openPath: async () => undefined
  },
  launcher: {
    setIgnoreMouse: async () => undefined,
    hide: async () => undefined,
    onShown: noop,
    onHidden: noop,
    dragStart: () => (window as unknown as { __drag: unknown[] }).__drag.push('start'),
    drag: (dx: number, dy: number) => (window as unknown as { __drag: unknown[] }).__drag.push([dx, dy]),
    dragEnd: () => (window as unknown as { __drag: unknown[] }).__drag.push('end'),
    resetPosition: async () => undefined
  },
  settings: {
    get: async () => settings,
    set: async (p: SettingsPatch) => setSettings(p),
    reset: async () => setSettings(DEFAULT_SETTINGS),
    shortcutStatus: async () => ({ toggleRecording: true, showLauncher: true }),
    defaultFolders: async () => ({
      recordings: '/Users/precioustom/Movies/toom',
      export: '/Users/precioustom/Desktop'
    }),
    chooseFolder: async () => null,
    onChanged: (cb: (s: AppSettings) => void) => {
      settingsListeners.add(cb)
      return () => settingsListeners.delete(cb)
    },
    onSection: noop
  },
  area: { pick: async () => null, result: async () => undefined },
  models: {
    get: async () => {
      throw new Error('This feature needs an internet connection the first time, to download its model.')
    },
    status: async () => false
  },
  backgrounds: {
    search: async (q: string) => ({
      results: Array.from({ length: 8 }, (_, i) => ({
        id: `p${i}`,
        thumb: `${BASE}/demo/${i % 2 ? 'thumb2' : 'thumb'}.png`,
        small: `${BASE}/demo/${i % 2 ? 'thumb2' : 'thumb'}.png`,
        raw: '',
        color: '#334',
        width: 1600,
        height: 900,
        alt: q,
        author: ['Ada Lovelace', 'Kwame Nkrumah', 'Ngozi A.', 'Tobi O.'][i % 4],
        authorUrl: '#',
        downloadLocation: ''
      })),
      totalPages: 3
    }),
    useUnsplash: async () => ({ file: 'desk.png', credit: { name: 'Ngozi A.', url: '#', source: 'Unsplash' } }),
    recent: async () => [],
    use: async () => ({ file: 'desk.png' }),
    remove: async () => undefined
  },
  listSources: async (types?: string[]) =>
    [
      {
        id: 'screen:1',
        name: 'Built-in Retina Display',
        kind: 'screen',
        thumbnail: `${BASE}/demo/thumb.png`,
        displayId: '1'
      },
      { id: 'screen:2', name: 'Studio Display', kind: 'screen', thumbnail: `${BASE}/demo/thumb2.png`, displayId: '2' },
      { id: 'window:1', name: 'Ledgerly — Payments', kind: 'window', thumbnail: `${BASE}/demo/thumb.png` },
      { id: 'window:2', name: 'Figma — Checkout flow', kind: 'window', thumbnail: `${BASE}/demo/thumb2.png` },
      { id: 'window:3', name: 'Visual Studio Code', kind: 'window', thumbnail: `${BASE}/demo/thumb.png` },
      { id: 'window:4', name: 'Slack — #product', kind: 'window', thumbnail: `${BASE}/demo/thumb2.png` },
      { id: 'window:5', name: 'Terminal', kind: 'window', thumbnail: `${BASE}/demo/thumb.png` },
      { id: 'window:6', name: 'Notion — Launch plan', kind: 'window', thumbnail: `${BASE}/demo/thumb2.png` }
    ].filter((s) => !types || types.includes(s.kind)),
  selectCapture: async () => undefined,
  listDisplays: async () => [],
  permissions: {
    status: async () =>
      qs.has('perms')
        ? { screen: 'denied', camera: 'not-determined', microphone: 'granted', accessibility: false }
        : { screen: 'granted', camera: 'granted', microphone: 'granted', accessibility: false },
    request: async () => true
  },
  rec: {
    prepare: async () => ({ projectId: 'demo' }),
    started: async () => undefined,
    chunk: async () => undefined,
    finished: async () => undefined,
    cancelled: async () => undefined,
    failed: async () => undefined,
    onCommand: noop,
    onError: noop
  },
  toolbar: {
    command: async () => undefined,
    onState: (cb: (s: unknown) => void) => {
      recListeners.add(cb)
      return () => recListeners.delete(cb)
    }
  },
  island: {
    info: async () =>
      qs.get('notch') === '0'
        ? { notch: false, notchWidth: 0, menuBarHeight: 25 }
        : { notch: true, notchWidth: 185, menuBarHeight: 37 },
    setIgnoreMouse: async () => undefined
  },
  glass: {
    info: async () => ({
      regions: qs.get('glass') === 'regions',
      material: (qs.get('glass') === 'liquid' ? 'liquid' : 'none') as 'liquid' | 'none'
    }),
    setRegions: () => undefined
  },
  menu: { onCommand: noop, setContext: async () => undefined },
  ocr: {
    assets: async () => ({
      worker: await (await fetch('/nm/tesseract.js/dist/worker.min.js')).text(),
      core: await (await fetch('/nm/tesseract.js-core/tesseract-core-simd-lstm.wasm.js')).text(),
      eng: new Uint8Array(
        await (await fetch('/nm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')).arrayBuffer()
      )
    })
  },
  sounds: {
    import: async () => [],
    library: async () => [{ id: 'l1', file: 'x.mp3', name: 'My podcast intro', kind: 'music', addedAt: 0 }],
    use: async () => ({ file: 'x.mp3', name: 'My podcast intro' }),
    remove: async () => undefined
  },
  projects: {
    list: async () => [await json('project.json')],
    get: async () => json('project.json'),
    save: async (meta: unknown) => void (await post('project.json', JSON.stringify(meta))),
    remove: async () => undefined,
    confirmRemove: async () => false,
    open: async () => undefined,
    reveal: async () => undefined,
    removeFile: async () => undefined,
    cursor: async () => json('cursor.json'),
    importImage: async () => null,
    onChanged: noop
  },
  file: {
    async open(t: { projectId: string; name: string } | { token: string }) {
      const name = 'token' in t ? `export-${t.token}.mp4` : t.name
      const id = nextHandle++
      handles.set(id, name)
      await post(name, '', 'truncate')
      return id
    },
    async write(h: number, pos: number, data: Uint8Array) {
      await post(handles.get(h)!, data as unknown as BodyInit, 'write', `&pos=${pos}`)
    },
    async close(h: number) {
      handles.delete(h)
      return null
    }
  },
  exportFile: { choosePath: async () => ({ token: 'ui', path: '/tmp/out.mp4' }), showItem: async () => undefined }
}

await import('@renderer/main')
