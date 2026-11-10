import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { isRecording, requestStop } from './recording'
import { showAbout, showLauncher, showLibrary, showSettings, showSignIn } from './windows'
import { accountLoaded, isSignedIn } from './account'
import { getSettings } from './settings'
import { installUpdate, updateStatus } from './updater'

let tray: Tray | null = null

export function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', name) : join(__dirname, '../../resources', name)
}

function accel(a: string): string | undefined {
  return a ? a : undefined
}

export function buildTrayMenu(): void {
  if (!tray) return
  const s = getSettings().shortcuts
  const recording = isRecording()
  // signed out: the only way in is signing in
  if (accountLoaded() && !isSignedIn() && !recording) {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Sign in to Toom…', click: () => showSignIn() },
        { type: 'separator' },
        { label: 'About Toom', click: () => void showAbout() },
        { label: 'Quit Toom', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
      ])
    )
    return
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      recording
        ? { label: 'Stop recording', accelerator: accel(s.toggleRecording), click: () => requestStop() }
        : { label: 'New recording…', accelerator: accel(s.showLauncher), click: () => showLauncher() },
      { type: 'separator' },
      { label: 'Library', click: () => showLibrary() },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => showSettings() },
      ...(() => {
        const u = updateStatus()
        return u.state === 'ready'
          ? ([
              { type: 'separator' },
              { label: `Restart to update (${u.version})`, click: () => installUpdate() }
            ] as const)
          : []
      })(),
      { type: 'separator' },
      { label: 'About Toom', click: () => void showAbout() },
      { label: 'Quit Toom', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
    ])
  )
}

export function createTray(): void {
  if (tray) return
  const mac = process.platform === 'darwin'
  const img = nativeImage.createFromPath(resourcePath(mac ? 'trayTemplate.png' : 'tray-win.png'))
  if (mac) img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Toom')
  buildTrayMenu()
  // Windows: left click opens the launcher; right click shows the menu.
  if (!mac) tray.on('click', () => showLauncher())
}
