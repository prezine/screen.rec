// The application menu. On macOS it's the menu bar next to the Apple menu, so it follows
// the focused window: an editor gets File / Edit / Clip / View commands for that project.
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { editorProjectOf, hasAppWindows, showLauncher, showLibrary, showSettings } from './windows'
import { getSettings } from './settings'
import { checkForUpdates, installUpdate, updateStatus } from './updater'

/** "Check for Updates…", or "Restart to Update" once one is downloaded */
export function updateMenuItem(): Item {
  const u = updateStatus()
  if (u.state === 'ready') return { label: `Restart to Update to ${u.version}`, click: () => installUpdate() }
  if (u.state === 'downloading') return { label: `Downloading Update… ${u.percent}%`, enabled: false }
  return {
    label: 'Check for Updates…',
    enabled: u.state !== 'unsupported' && u.state !== 'checking',
    click: () => {
      void checkForUpdates(true)
      showSettings('about')
    }
  }
}

const isMac = process.platform === 'darwin'
type Item = Electron.MenuItemConstructorOptions

function send(cmd: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win && editorProjectOf(win)) win.webContents.send('menu:command', cmd)
}

/** Single-key shortcuts are shown in the menu but left to the editor (so typing still works). */
function cmd(label: string, command: string, accelerator?: string, plain = false): Item {
  return { label, accelerator, registerAccelerator: !plain, click: () => send(command) }
}

export function buildAppMenu(): void {
  const editor = !!editorProjectOf(BrowserWindow.getFocusedWindow())
  const template: Item[] = []

  if (isMac) {
    template.push({
      label: 'Toom',
      submenu: [
        { role: 'about', label: 'About Toom' },
        updateMenuItem(),
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => showSettings() },
        { label: 'Account…', click: () => showSettings('account') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Toom' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Toom' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New Recording…', accelerator: 'CommandOrControl+N', click: () => showLauncher() },
      { label: 'Library', accelerator: 'CommandOrControl+L', click: () => showLibrary() },
      { type: 'separator' },
      ...(editor
        ? ([
            cmd('Export…', 'export', 'CommandOrControl+E'),
            cmd(isMac ? 'Show in Finder' : 'Show in Explorer', 'reveal', 'CommandOrControl+Shift+R'),
            { type: 'separator' },
            cmd('Delete Recording…', 'delete-project'),
            { type: 'separator' }
          ] as Item[])
        : []),
      ...(!isMac
        ? ([
            { label: 'Settings…', accelerator: 'Ctrl+,', click: () => showSettings() },
            { label: 'Account…', click: () => showSettings('account') },
            { type: 'separator' }
          ] as Item[])
        : []),
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })

  template.push({
    label: 'Edit',
    submenu: editor
      ? [
          cmd('Undo', 'undo', 'CommandOrControl+Z'),
          cmd('Redo', 'redo', 'Shift+CommandOrControl+Z'),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          cmd('Delete Selection', 'delete-selection', 'Backspace', true)
        ]
      : [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
  })

  if (editor) {
    template.push({
      label: 'Clip',
      submenu: [
        cmd('Split at Playhead', 'split', 'S', true),
        { type: 'separator' },
        cmd('Add Zoom', 'add-zoom', 'Z', true),
        cmd('Auto Zoom', 'auto-zoom'),
        cmd('Add Privacy Mask', 'add-mask', 'M', true),
        cmd('Add Layout Change', 'add-layout')
      ]
    })
    template.push({
      label: 'View',
      submenu: [
        cmd('Play / Pause', 'play', 'Space', true),
        cmd('Go to Start', 'go-start', 'Home', true),
        cmd('Go to End', 'go-end', 'End', true),
        { type: 'separator' },
        cmd('Zoom Timeline In', 'timeline-in', 'CommandOrControl+='),
        cmd('Zoom Timeline Out', 'timeline-out', 'CommandOrControl+-'),
        { type: 'separator' },
        {
          label: 'Panels',
          submenu: [
            cmd('Background', 'panel:background', 'CommandOrControl+1'),
            cmd('Frame', 'panel:frame', 'CommandOrControl+2'),
            cmd('Cursor', 'panel:cursor', 'CommandOrControl+3'),
            cmd('Zoom', 'panel:zoom', 'CommandOrControl+4'),
            cmd('Camera & Layout', 'panel:camera', 'CommandOrControl+5'),
            cmd('Privacy Masks', 'panel:privacy', 'CommandOrControl+6'),
            cmd('Transcript', 'panel:transcript', 'CommandOrControl+7'),
            cmd('Audio', 'panel:audio', 'CommandOrControl+8')
          ]
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as Item[]))
      ]
    })
  } else {
    template.push({
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as Item[]))
      ]
    })
  }

  template.push({ role: 'windowMenu' })
  template.push({
    role: 'help',
    submenu: [
      { label: 'Keyboard Shortcuts', click: () => send('panel:shortcuts'), enabled: editor },
      ...(!isMac ? ([updateMenuItem()] as Item[]) : []),
      { label: 'Unsplash API Keys', click: () => void shell.openExternal('https://unsplash.com/oauth/applications') }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// macOS only shows an app's menu bar while it's a regular (Dock) app. When the user keeps Toom
// out of the Dock, become a regular app while a real window (editor, library, settings) is open.
function syncDock(): void {
  if (!isMac || !app.dock) return
  const want = getSettings().general.showInDock || hasAppWindows()
  if (want && !app.dock.isVisible()) void app.dock.show()
  else if (!want && app.dock.isVisible()) app.dock.hide()
}

let lastEditor: boolean | null = null
export function registerMenuIpc(): void {
  const refresh = (): void => {
    const editor = !!editorProjectOf(BrowserWindow.getFocusedWindow())
    if (editor !== lastEditor) {
      lastEditor = editor
      buildAppMenu()
    }
  }
  app.on('browser-window-focus', () => {
    refresh()
    syncDock()
  })
  app.on('browser-window-blur', () => setTimeout(refresh, 50))
  app.on('browser-window-created', (_e, win) => {
    win.on('show', syncDock)
    win.on('closed', () => setTimeout(syncDock, 50))
    win.on('hide', () => setTimeout(syncDock, 50))
  })
  ipcMain.handle('menu:context', () => refresh())
}
