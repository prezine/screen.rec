import { BrowserWindow, ipcMain, screen } from 'electron'
import type {
  ChunkPayload,
  ProjectMeta,
  RecState,
  RecorderCommand,
  RecordingOptions,
  RecordingStarted,
  ToolbarCommand
} from '@shared/types'
import { CursorTracker } from './cursor-tracker'
import { WindowBoundsWatcher, windowIdFromSource } from './window-bounds'
import {
  appendToFile,
  createProject,
  deleteProject,
  flushAppends,
  projectFile,
  saveProject,
  writeCursor
} from './projects'
import {
  broadcastProjectsChanged,
  createToolbarWindow,
  getLauncherWindow,
  getToolbarWindow,
  hideLauncher,
  openEditorWindow,
  showLauncher,
  showLibrary,
  showSignIn
} from './windows'
import { getSettings } from './settings'
import { buildTrayMenu } from './tray'
import { currentLimits, isSignedIn } from './account'

interface Session {
  meta: ProjectMeta
  options: RecordingOptions
  recorder: BrowserWindow
  tracker: CursorTracker
  windowWatcher: WindowBoundsWatcher | null
  state: RecState
  startedAt: number
  pausedTotal: number
  pausedAt: number | null
  ticker: NodeJS.Timeout | null
}

let session: Session | null = null

export function isRecording(): boolean {
  return !!session
}

function broadcastState(): void {
  if (!session) return
  const s = session
  if (s.state.phase === 'recording') {
    s.state.elapsed = (Date.now() - s.startedAt - s.pausedTotal) / 1000
  } else if (s.state.phase === 'paused' && s.pausedAt) {
    s.state.elapsed = (s.pausedAt - s.startedAt - s.pausedTotal) / 1000
  }
  // Free plan: recordings stop by themselves at the limit
  const limit = currentLimits().maxRecordingSeconds
  s.state.limit = limit ?? undefined
  if (limit && s.state.phase === 'recording' && s.state.elapsed >= limit) {
    s.state.elapsed = limit
    requestStop()
    return
  }
  getToolbarWindow()?.webContents.send('rec:state', s.state)
}

function sendToRecorder(cmd: RecorderCommand): void {
  if (session && !session.recorder.isDestroyed()) session.recorder.webContents.send('rec:command', cmd)
}

export function requestStop(): void {
  if (!session) return
  if (session.state.phase === 'countdown') return requestCancel()
  if (session.state.phase !== 'recording' && session.state.phase !== 'paused') return
  if (session.state.phase === 'paused') resume()
  session.state.phase = 'finishing'
  broadcastState()
  sendToRecorder('stop')
}

export function requestCancel(): void {
  if (!session) return
  session.state.phase = 'finishing'
  broadcastState()
  sendToRecorder('cancel')
}

function pause(): void {
  if (!session || session.state.phase !== 'recording') return
  session.pausedAt = Date.now()
  session.tracker.pause()
  session.state.phase = 'paused'
  sendToRecorder('pause')
  broadcastState()
}

function resume(): void {
  if (!session || session.state.phase !== 'paused' || session.pausedAt === null) return
  session.pausedTotal += Date.now() - session.pausedAt
  session.pausedAt = null
  session.tracker.resume()
  session.state.phase = 'recording'
  sendToRecorder('resume')
  broadcastState()
}

function endSession(): void {
  if (!session) return
  if (session.ticker) clearInterval(session.ticker)
  session.windowWatcher?.stop()
  session = null
  buildTrayMenu()
  getToolbarWindow()?.close()
}

export function registerRecordingIpc(): void {
  ipcMain.handle('rec:prepare', async (e, options: RecordingOptions) => {
    if (session) throw new Error('A recording is already in progress')
    // Toom needs an account (the recording bar can't be opened without one either)
    if (!isSignedIn()) {
      hideLauncher()
      showSignIn()
      throw new Error('Sign in to record.')
    }
    const recorder = BrowserWindow.fromWebContents(e.sender)
    if (!recorder) throw new Error('No recorder window')
    const meta = await createProject(options)

    // Cursor positions are normalised to the captured region: the whole display, or the area crop.
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    if (options.kind === 'screen' || options.kind === 'area') {
      const display =
        screen.getAllDisplays().find((d) => String(d.id) === options.displayId) ?? screen.getPrimaryDisplay()
      bounds = display.bounds
      if (options.kind === 'area' && options.crop) {
        const c = options.crop
        bounds = {
          x: display.bounds.x + c.x * display.bounds.width,
          y: display.bounds.y + c.y * display.bounds.height,
          width: c.w * display.bounds.width,
          height: c.h * display.bounds.height
        }
      }
      meta.source.displayId = String(display.id)
    }
    // Window recordings: follow the window's frame so clicks and zooms line up with it.
    let windowWatcher: WindowBoundsWatcher | null = null
    const winId = options.kind === 'window' ? windowIdFromSource(options.sourceId) : null
    if (winId) {
      windowWatcher = new WindowBoundsWatcher(winId, (b) => session?.tracker.setBounds(b))
      bounds = await windowWatcher.start()
      if (bounds) {
        const display = screen.getDisplayMatching(bounds)
        meta.source.displayId = String(display.id)
      } else {
        windowWatcher.stop()
        windowWatcher = null
      }
    }
    const countdown = getSettings().recording.countdown

    session = {
      meta,
      options,
      recorder,
      tracker: new CursorTracker(bounds, getSettings().advanced.clickTracking, getSettings().advanced.keyTracking),
      windowWatcher,
      state: { phase: 'countdown', elapsed: 0, countdown },
      startedAt: 0,
      pausedTotal: 0,
      pausedAt: null,
      ticker: null
    }

    if (recorder === getLauncherWindow()) hideLauncher()
    else recorder.hide()
    const toolbar = createToolbarWindow(meta.source.displayId)
    toolbar.webContents.once('did-finish-load', () => broadcastState())

    // countdown, then tell the recorder to begin
    if (countdown === 0) {
      session.state.countdown = undefined
      setTimeout(() => sendToRecorder('begin'), 150)
      return { projectId: meta.id }
    }
    let n = countdown
    const tick = (): void => {
      if (!session || session.state.phase !== 'countdown') return
      n -= 1
      if (n <= 0) {
        session.state.countdown = undefined
        sendToRecorder('begin')
      } else {
        session.state.countdown = n
        broadcastState()
        setTimeout(tick, 1000)
      }
    }
    setTimeout(tick, 1000)
    return { projectId: meta.id }
  })

  ipcMain.handle('rec:started', (_e, info: RecordingStarted) => {
    if (!session) return
    session.startedAt = info.screenStartedAt
    session.meta.source.width = info.width
    session.meta.source.height = info.height
    session.meta.files.screen = info.screenMime.includes('mp4') ? 'screen.mp4' : 'screen.webm'
    if (session.meta.files.camera && info.cameraMime) {
      session.meta.files.camera = info.cameraMime.includes('mp4') ? 'camera.mp4' : 'camera.webm'
    }
    session.meta.cameraOffset = info.cameraStartedAt ? (info.cameraStartedAt - info.screenStartedAt) / 1000 : 0
    if (!info.cameraStartedAt) session.meta.files.camera = undefined
    session.tracker.start(info.screenStartedAt)
    session.state.phase = 'recording'
    session.ticker = setInterval(broadcastState, 250)
    broadcastState()
    buildTrayMenu()
    void saveProject(session.meta)
  })

  ipcMain.handle('rec:chunk', async (_e, payload: ChunkPayload) => {
    if (!session) return
    const name = payload.track === 'screen' ? session.meta.files.screen : session.meta.files.camera
    if (!name) return
    await appendToFile(projectFile(session.meta.id, name), payload.data)
  })

  ipcMain.handle('rec:finished', async () => {
    if (!session) return
    const s = session
    const cursor = s.tracker.stop()
    await flushAppends()
    s.meta.duration = (Date.now() - s.startedAt - s.pausedTotal) / 1000
    s.meta.status = 'raw'
    await writeCursor(s.meta.id, cursor)
    await saveProject(s.meta)
    const id = s.meta.id
    endSession()
    if (getSettings().recording.openEditorAfterRecording) openEditorWindow(id)
    else showLibrary()
    broadcastProjectsChanged()
  })

  ipcMain.handle('rec:cancelled', async () => {
    if (!session) return
    const id = session.meta.id
    session.tracker.stop()
    await flushAppends()
    endSession()
    await deleteProject(id)
    showLauncher()
  })

  ipcMain.handle('rec:failed', async (_e, message: string) => {
    console.error('[rec] recorder failed:', message)
    if (!session) return
    const id = session.meta.id
    session.tracker.stop()
    await flushAppends()
    endSession()
    await deleteProject(id).catch(() => undefined)
    showLauncher()
    getLauncherWindow()?.webContents.send('rec:error', message)
  })

  ipcMain.handle('toolbar:command', (_e, cmd: ToolbarCommand) => {
    if (cmd === 'stop') requestStop()
    else if (cmd === 'pause') pause()
    else if (cmd === 'resume') resume()
    else if (cmd === 'cancel') requestCancel()
  })
}
