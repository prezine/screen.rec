import { contextBridge, ipcRenderer } from 'electron'
import type {
  CaptureSource,
  ChunkPayload,
  CursorData,
  DisplayInfo,
  NRect,
  ProjectMeta,
  RecState,
  RecorderCommand,
  RecordingOptions,
  RecordingStarted,
  ToolbarCommand
} from '@shared/types'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import type { Credit, LibraryImage, LibrarySound, UnsplashPhoto } from '@shared/media'
import type { AccountEvent, AccountResult, AccountState, PromoResult, PublicPlan, UpdateStatus } from '@shared/account'

function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export type MenuCommand =
  | 'undo'
  | 'redo'
  | 'export'
  | 'reveal'
  | 'delete-project'
  | 'split'
  | 'delete-selection'
  | 'add-zoom'
  | 'auto-zoom'
  | 'add-mask'
  | 'add-layout'
  | 'play'
  | 'go-start'
  | 'go-end'
  | 'timeline-in'
  | 'timeline-out'
  | `panel:${string}`

export interface IslandInfo {
  /** the display has a camera housing (notch) the island wraps around */
  notch: boolean
  /** notch / menu bar size in points */
  notchWidth: number
  menuBarHeight: number
}

type Permissions = { screen: string; camera: string; microphone: string; accessibility: boolean }

const api = {
  platform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:platform'),
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  newRecording: (): Promise<void> => ipcRenderer.invoke('app:newRecording'),

  app: {
    showLauncher: (): Promise<void> => ipcRenderer.invoke('app:showLauncher'),
    showLibrary: (): Promise<void> => ipcRenderer.invoke('app:showLibrary'),
    showSettings: (section?: string): Promise<void> => ipcRenderer.invoke('app:showSettings', section),
    showAbout: (): Promise<void> => ipcRenderer.invoke('app:about'),
    /** reveal main.log in Finder / Explorer */
    showLogs: (): Promise<void> => ipcRenderer.invoke('app:showLogs'),
    /** the last few hundred log lines */
    diagnostics: (): Promise<string> => ipcRenderer.invoke('app:diagnostics'),
    aboutInfo: (): Promise<{
      version: string
      electron: string
      chrome: string
      node: string
      platform: NodeJS.Platform
      arch: string
      os: string
      packaged: boolean
    }> => ipcRenderer.invoke('app:aboutInfo'),
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
    confirm: (o: { message: string; detail?: string; ok?: string; destructive?: boolean }): Promise<boolean> =>
      ipcRenderer.invoke('app:confirm', o),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    devtools: (): Promise<void> => ipcRenderer.invoke('app:devtools'),
    openPath: (which: 'userData' | 'recordings'): Promise<void> => ipcRenderer.invoke('app:openPath', which)
  },

  launcher: {
    setIgnoreMouse: (ignore: boolean): Promise<void> => ipcRenderer.invoke('launcher:setIgnoreMouse', ignore),
    hide: (): Promise<void> => ipcRenderer.invoke('launcher:hide'),
    onShown: (cb: () => void) => on('launcher:shown', cb),
    onHidden: (cb: () => void) => on('launcher:hidden', cb),
    dragStart: (): void => ipcRenderer.send('launcher:dragStart'),
    drag: (dx: number, dy: number): void => ipcRenderer.send('launcher:drag', dx, dy),
    dragEnd: (): void => ipcRenderer.send('launcher:dragEnd'),
    resetPosition: (): Promise<void> => ipcRenderer.invoke('launcher:resetPosition')
  },

  /** Toom account, plan and billing */
  account: {
    get: (): Promise<AccountState> => ipcRenderer.invoke('account:get'),
    /** open the sign-in screen (Toom needs an account) */
    showSignIn: (): Promise<void> => ipcRenderer.invoke('account:showSignIn'),
    refresh: (): Promise<AccountState> => ipcRenderer.invoke('account:refresh'),
    apiUrl: (): Promise<string> => ipcRenderer.invoke('account:apiUrl'),
    signup: (a: { email: string; password: string; name?: string }): Promise<AccountResult> =>
      ipcRenderer.invoke('account:signup', a),
    login: (a: { email: string; password: string }): Promise<AccountResult> => ipcRenderer.invoke('account:login', a),
    /** email a 6-digit code (and, for sign-in, a magic link) */
    emailStart: (email: string, purpose: 'login' | 'reset' = 'login'): Promise<AccountResult> =>
      ipcRenderer.invoke('account:emailStart', email, purpose),
    emailVerify: (a: { email: string; code: string; name?: string }): Promise<AccountResult> =>
      ipcRenderer.invoke('account:emailVerify', a),
    resetPassword: (a: { email: string; code: string; password: string }): Promise<AccountResult> =>
      ipcRenderer.invoke('account:resetPassword', a),
    update: (patch: { name: string }): Promise<AccountResult> => ipcRenderer.invoke('account:update', patch),
    changePassword: (p: { current?: string; password: string }): Promise<AccountResult> =>
      ipcRenderer.invoke('account:changePassword', p),
    logout: (): Promise<AccountState> => ipcRenderer.invoke('account:logout'),
    remove: (): Promise<AccountResult> => ipcRenderer.invoke('account:delete'),
    plans: (): Promise<{ plans: PublicPlan[]; enabled: boolean }> => ipcRenderer.invoke('account:plans'),
    /** opens Bachs checkout in the browser; the plan updates by itself when payment lands */
    checkout: (plan: PublicPlan['id'], code?: string): Promise<AccountResult> =>
      ipcRenderer.invoke('account:checkout', plan, code),
    /** what a promo code does (free Pro, or a discount) */
    promoCheck: (code: string): Promise<PromoResult> => ipcRenderer.invoke('account:promoCheck', code),
    /** use a free-Pro code */
    promoRedeem: (code: string): Promise<AccountResult> => ipcRenderer.invoke('account:promoRedeem', code),
    /** activate a licence key (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX) or free-Pro code on this computer */
    licenseActivate: (key: string): Promise<AccountResult> => ipcRenderer.invoke('account:licenseActivate', key),
    /** stop using the account's key on one of its computers */
    licenseDeactivate: (deviceId: string): Promise<AccountResult> =>
      ipcRenderer.invoke('account:licenseDeactivate', deviceId),
    cancelWaiting: (): Promise<AccountState> => ipcRenderer.invoke('account:cancelWaiting'),
    portal: (): Promise<AccountResult> => ipcRenderer.invoke('account:portal'),
    onChanged: (cb: (s: AccountState) => void) => on('account:changed', cb),
    onEvent: (cb: (e: AccountEvent) => void) => on('account:event', cb)
  },

  updater: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (s: UpdateStatus) => void) => on('updater:status', cb)
  },

  /** disk used by Toom, and clearing re-downloadable data */
  storage: {
    usage: (): Promise<{ recordings: number; downloads: number; libraries: number }> =>
      ipcRenderer.invoke('storage:usage'),
    clearDownloads: (): Promise<{ recordings: number; downloads: number; libraries: number }> =>
      ipcRenderer.invoke('storage:clearDownloads')
  },

  /** first-run welcome window */
  onboarding: {
    finish: (): Promise<void> => ipcRenderer.invoke('onboarding:finish'),
    show: (): Promise<void> => ipcRenderer.invoke('onboarding:show')
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: SettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
    reset: (): Promise<AppSettings> => ipcRenderer.invoke('settings:reset'),
    shortcutStatus: (): Promise<{ toggleRecording: boolean; showLauncher: boolean }> =>
      ipcRenderer.invoke('settings:shortcutStatus'),
    defaultFolders: (): Promise<{ recordings: string; export: string }> =>
      ipcRenderer.invoke('settings:defaultFolders'),
    chooseFolder: (kind: 'recordings' | 'export'): Promise<string | null> =>
      ipcRenderer.invoke('settings:chooseFolder', kind),
    onChanged: (cb: (s: AppSettings) => void) => on('settings:changed', cb),
    onSection: (cb: (section: string) => void) => on('settings:section', cb)
  },

  backgrounds: {
    search: (query: string, page?: number): Promise<{ results: UnsplashPhoto[]; totalPages: number }> =>
      ipcRenderer.invoke('unsplash:search', query, page),
    useUnsplash: (projectId: string, photo: UnsplashPhoto): Promise<{ file: string; credit: Credit }> =>
      ipcRenderer.invoke('unsplash:use', projectId, photo),
    recent: (): Promise<LibraryImage[]> => ipcRenderer.invoke('backgrounds:recent'),
    use: (projectId: string, file: string): Promise<{ file: string; credit?: Credit }> =>
      ipcRenderer.invoke('backgrounds:use', projectId, file),
    remove: (file: string): Promise<void> => ipcRenderer.invoke('backgrounds:remove', file)
  },

  /** bundled text-recognition engine + English data */
  ocr: {
    assets: (): Promise<{ worker: string; core: string; eng: Uint8Array }> => ipcRenderer.invoke('ocr:assets')
  },

  models: {
    get: (name: string): Promise<Uint8Array> => ipcRenderer.invoke('models:get', name),
    status: (name: string): Promise<boolean> => ipcRenderer.invoke('models:status', name)
  },

  listSources: (types?: ('screen' | 'window')[]): Promise<CaptureSource[]> => ipcRenderer.invoke('sources:list', types),
  selectCapture: (sel: { sourceId: string; audio: boolean }): Promise<void> =>
    ipcRenderer.invoke('capture:select', sel),
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('displays:list'),

  area: {
    pick: (): Promise<{ displayId: string; rect: NRect } | null> => ipcRenderer.invoke('area:pick'),
    result: (r: { displayId: string; rect: NRect } | null): Promise<void> => ipcRenderer.invoke('area:result', r)
  },

  permissions: {
    status: (): Promise<Permissions> => ipcRenderer.invoke('permissions:status'),
    request: (kind: 'camera' | 'microphone' | 'screen' | 'accessibility'): Promise<boolean> =>
      ipcRenderer.invoke('permissions:request', kind)
  },

  rec: {
    prepare: (options: RecordingOptions): Promise<{ projectId: string }> => ipcRenderer.invoke('rec:prepare', options),
    started: (info: RecordingStarted): Promise<void> => ipcRenderer.invoke('rec:started', info),
    chunk: (payload: ChunkPayload): Promise<void> => ipcRenderer.invoke('rec:chunk', payload),
    finished: (): Promise<void> => ipcRenderer.invoke('rec:finished'),
    cancelled: (): Promise<void> => ipcRenderer.invoke('rec:cancelled'),
    failed: (message: string): Promise<void> => ipcRenderer.invoke('rec:failed', message),
    onCommand: (cb: (cmd: RecorderCommand) => void) => on('rec:command', cb),
    onError: (cb: (message: string) => void) => on('rec:error', cb)
  },

  toolbar: {
    command: (cmd: ToolbarCommand): Promise<void> => ipcRenderer.invoke('toolbar:command', cmd),
    onState: (cb: (state: RecState) => void) => on('rec:state', cb)
  },

  /** Dynamic Island recording controls */
  island: {
    info: (): Promise<IslandInfo> => ipcRenderer.invoke('island:info'),
    setIgnoreMouse: (ignore: boolean): Promise<void> => ipcRenderer.invoke('island:setIgnoreMouse', ignore)
  },

  /** your own music and sound effects */
  sounds: {
    import: (projectId: string, kind: 'music' | 'sfx'): Promise<{ file: string; name: string; libId: string }[]> =>
      ipcRenderer.invoke('sounds:import', projectId, kind),
    library: (): Promise<LibrarySound[]> => ipcRenderer.invoke('sounds:library'),
    use: (projectId: string, id: string): Promise<{ file: string; name: string }> =>
      ipcRenderer.invoke('sounds:use', projectId, id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('sounds:remove', id)
  },

  glass: {
    info: (): Promise<{ regions: boolean; material: 'liquid' | 'vibrancy' | 'acrylic' | 'none' }> =>
      ipcRenderer.invoke('glass:info'),
    setRegions: (regions: { id: string; x: number; y: number; w: number; h: number; r: number }[]): void =>
      ipcRenderer.send('glass:regions', regions),
    onRefresh: (cb: () => void) => on('glass:refresh', cb)
  },

  /** commands from the application menu (File / Edit / Clip / View) */
  menu: {
    onCommand: (cb: (cmd: MenuCommand) => void) => on('menu:command', cb),
    setContext: (ctx: 'editor' | 'other'): Promise<void> => ipcRenderer.invoke('menu:context', ctx)
  },

  projects: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('projects:list'),
    get: (id: string): Promise<ProjectMeta | null> => ipcRenderer.invoke('projects:get', id),
    save: (meta: ProjectMeta): Promise<void> => ipcRenderer.invoke('projects:save', meta),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
    /** Native confirmation, then delete. Resolves true when deleted. */
    confirmRemove: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:confirmDelete', id),
    open: (id: string): Promise<void> => ipcRenderer.invoke('projects:open', id),
    reveal: (id?: string): Promise<void> => ipcRenderer.invoke('projects:reveal', id),
    removeFile: (id: string, name: string): Promise<void> => ipcRenderer.invoke('projects:removeFile', id, name),
    cursor: (id: string): Promise<CursorData> => ipcRenderer.invoke('projects:cursor', id),
    importImage: (id: string): Promise<string | null> => ipcRenderer.invoke('projects:importImage', id),
    onChanged: (cb: () => void) => on('projects:changed', cb)
  },

  file: {
    open: (target: { projectId: string; name: string } | { token: string }): Promise<number> =>
      ipcRenderer.invoke('file:open', target),
    write: (handle: number, position: number, data: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('file:write', handle, position, data),
    /** `discard` removes a half-written export */
    close: (handle: number, discard?: boolean): Promise<string | null> =>
      ipcRenderer.invoke('file:close', handle, discard)
  },

  exportFile: {
    choosePath: (defaultName: string): Promise<{ token: string; path: string } | null> =>
      ipcRenderer.invoke('export:choosePath', defaultName),
    showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
