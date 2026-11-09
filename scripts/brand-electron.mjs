// macOS dev only: the menu bar, Dock and ⌘-Tab read the app name from the Electron bundle's
// Info.plist, so `npm run dev` shows "Electron". Rename the dev bundle to "toom" and re-sign it
// ad hoc. Packaged builds don't need this (electron-builder sets the name).
//
// Note: re-signing gives the dev app a new identity, so macOS asks once more for
// Screen Recording / Accessibility permission. Skip with TOOM_SKIP_BRAND=1.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'toom'
if (process.platform !== 'darwin' || process.env.TOOM_SKIP_BRAND) process.exit(0)

const app = join('node_modules', 'electron', 'dist', 'Electron.app')
const plist = join(app, 'Contents', 'Info.plist')
if (!existsSync(plist)) process.exit(0)

const current = readFileSync(plist, 'utf8')
if (current.includes(`<string>${NAME}</string>`)) process.exit(0) // already branded

const backup = plist + '.orig'
copyFileSync(plist, backup)
try {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    try {
      execFileSync('plutil', ['-replace', key, '-string', NAME, plist])
    } catch {
      execFileSync('plutil', ['-insert', key, '-string', NAME, plist])
    }
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
  console.log(`[toom] Dev Electron bundle renamed to "${NAME}" (macOS may ask for screen recording permission again).`)
} catch (err) {
  copyFileSync(backup, plist)
  console.warn('[toom] Could not rename the dev Electron bundle; the menu bar will say "Electron" in dev.', err.message)
}
