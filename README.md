# Toom

Screen recording and editing for macOS and Windows, built with Electron. Inspired by Screen Studio: you record, and the editor turns the recording into a polished demo with automatic zoom, a smoothed cursor, backgrounds and a webcam overlay. Export is frame-accurate MP4 via WebCodecs.

## Quick start

```bash
npm install
npm run dev        # run the app with hot reload
npm run build      # production bundle in out/
npm run dist:mac   # .dmg   (or dist:win for an NSIS installer)
npm test           # engine unit tests
```

Requires Node 20+.

Toom is split into four repos that live side by side (e.g. in `Sites/localhost/`):

| Repo | What |
|---|---|
| **toom-software** (this one) | the desktop app |
| **toom-api** | accounts, plans, Bachs billing, promo codes, admin API |
| **toom-admin** | the admin dashboard (Next.js) |
| **toom-website** | the marketing site |

Run the API next to the app:

```bash
cd ../toom-api && npm install && npm run dev   # http://localhost:8787 — the app's dev builds use it
```

The app runs fine without it: you just stay on the Free plan, and sign-in shows "Can't reach Toom".

### macOS permissions
- **Screen Recording** (required). Grant it in System Settings → Privacy & Security, then restart the app.
- **Camera / Microphone**: you are prompted the first time you use them.
- **Accessibility** (optional). This enables global click tracking, which auto-zoom uses. Without it, auto-zoom falls back to detecting where the cursor travels and then settles.

In `npm run dev`, these permissions attach to the Electron binary itself or your terminal, not to "Toom".

## What's in the MVP

| Area | Status |
|---|---|
| Record a display or window at native resolution, up to 60fps | ✅ |
| Microphone, webcam (separate track), system audio (Windows; experimental on macOS 13+) | ✅ |
| Countdown, floating toolbar (excluded from the capture), pause/resume, discard, stop shortcut <kbd>⌘/Ctrl⇧2</kbd> | ✅ |
| Crash-safe recording: chunks are flushed to disk every second | ✅ |
| Cursor positions (60Hz) and click logging | ✅ |
| **Auto-zoom** from click clusters, with a dwell-detection fallback | ✅ |
| Manual zooms: add, move, resize, set level, delete; camera follows the cursor with spring smoothing | ✅ |
| Cursor: 4 styles (arrow, light, dot, ring), size, smoothing, highlight; click effects ripple / circle / **glass bubble** | ✅ |
| Motion blur: cursor and camera movement (zoom/pan), adjustable | ✅ |
| Backgrounds: wallpapers, gradients, colours, your own image, **Unsplash search**; padding, corner radius, shadow. Used images are cached so they work offline | ✅ |
| Aspect ratios: auto, 16:9, 4:3, 1:1, 9:16 | ✅ |
| **Hide sensitive data automatically**: on-device text recognition finds emails, phone numbers, card numbers (checksum-verified) and API keys/tokens; face detection finds faces in photos, avatars and video calls; all are covered with masks — on by default for new recordings | ✅ |
| **Face tracking**: the camera crop follows your face as you move (analysed once on-device) | ✅ |
| **Captions**: burned in from the transcript — Karaoke, Bold, Box, Glass or Clean, with word-pop / rise / fade animation, highlight colour, position and size | ✅ |
| **Keycap overlays** for shortcuts (⌘K, ⇧⌘Z…) and optionally Enter/Esc/arrows, dark or light keys | ✅ |
| **Speed up typing**: typing is detected from keystroke timing and sped up (2×–4×, muted) in one click or automatically; any clip can play at 1.5×–8× | ✅ |
| **Voice-over**: record narration from the playhead while the preview plays; it lands on a Voice lane and music ducks under it | ✅ |
| **Privacy masks**: blur, pixelate or cover any area for a stretch of time; they follow zooms and are burned into the export (<kbd>M</kbd>) | ✅ |
| **Dynamic Island** recording controls around the MacBook notch (a floating pill on other displays): countdown, timer, pause, stop, discard | ✅ |
| **Liquid Glass** UI: Apple's native glass on macOS 26+ for the recording bar, its popovers and Settings; vibrancy on older macOS, Acrylic on Windows 11; CSS glass in the editor, tinted by your background | ✅ |
| Auto zoom for **window** recordings (follows the window's position) | ✅ |
| Camera layouts: overlay, screen only, fullscreen camera, split screen 50:50, **cutout** (on-device background removal). Switch layouts per section on the timeline with smooth transitions | ✅ |
| Camera style: corner, size, shape, mirror | ✅ |
| Cut: split clips (<kbd>S</kbd>), delete clips, drag clip edges; gaps are skipped in preview and export | ✅ |
| **Transcript editing**: on-device Whisper. Select words and press ⌫ to cut that part of the video; remove fillers; trim long pauses | ✅ |
| MP4 export: 720p–4K, 30/60fps, hardware H.264 (falls back to HEVC/VP9/AV1), AAC/Opus audio | ✅ |
| Projects library with thumbnails and autosave | ✅ |

### Menu bar
The macOS menu bar follows the focused window. In an editor you get File (Export, Show in Finder, Delete), Edit (Undo/Redo), Clip (Split, Add Zoom, Auto Zoom, Add Privacy Mask, Add Layout Change) and View (playback, timeline zoom, panels ⌘1–8). When Toom is hidden from the Dock, it joins the Dock while an editor, the library or Settings is open, because macOS only shows a menu bar for Dock apps.

In `npm run dev`, macOS reads the app name from the Electron bundle, so `npm install` renames the dev bundle to "Toom" (`scripts/brand-electron.mjs`). This re-signs the dev app, so macOS asks once more for Screen Recording and Accessibility. Set `TOOM_SKIP_BRAND=1` to skip it.

### Editor shortcuts
<kbd>Space</kbd> play/pause · <kbd>S</kbd> split at playhead · <kbd>⌫</kbd> delete selected clip · <kbd>Z</kbd> add zoom · <kbd>Delete</kbd> remove the selected zoom · <kbd>←/→</kbd> step one frame (hold <kbd>Shift</kbd> for 1s)

## How it works

**Recording bar.** Toom opens as a floating bar at the bottom of the screen (⌘/Ctrl⇧1 toggles it, and it's also in the menu bar / tray).
- **Display:** pick a display and recording starts.
- **Window:** pick from a searchable list of windows.
- **Area:** drag a region on screen (Free, 16:9, 4:3, 1:1 or 9:16, with resize handles), then press Enter or click *Record area*.
- **Device:** record a capture card, camera or Continuity Camera.

The bar also has camera (live preview), microphone (live level meter) and system-audio toggles, your recent recordings, and quick settings (countdown, quality, click tracking). *Advanced settings…* opens the Settings window: General, Recording, Editing, Export, Shortcuts, Advanced. Settings are stored in `settings.json` in the app data folder and apply immediately.

**Global shortcuts** (configurable): ⌘/Ctrl⇧2 starts or stops a recording; ⌘/Ctrl⇧1 shows or hides the bar.

## UI

The UI uses React and Tailwind CSS v4 (via `@tailwindcss/vite`).

- **Icons:** [Hugeicons](https://hugeicons.com) free stroke-rounded set (`@hugeicons/react` + `@hugeicons/core-free-icons`). Every icon is mapped in `src/renderer/src/lib/icons.tsx`, so restyling is one file.
- **Font:** Degular. The app prefers **Degular Text** when it's installed on the machine, otherwise it uses the bundled **Degular Display** files in `src/renderer/public/fonts/`. Degular is a commercial typeface from OH no Type Co., so check that your license covers embedding it in a distributed desktop app before you ship.

The editor layout:
- **Title bar:** reveal, delete, an editable name, undo/redo, style presets and Export.
- **Canvas:** aspect and preview-quality controls, and a floating tool rail with add zoom, auto zoom, smooth cursor and camera.
- **Inspector:** an icon rail with panels for Background, Frame, Cursor, Zoom, Camera, Audio and Shortcuts.
- **Transport and timeline:** trim to playhead, playback speed, and timeline zoom (also ⌘/Ctrl+scroll). The timeline shows a waveform clip with trim handles and click markers, and a zoom lane: click an empty spot to add a zoom, or drag to move or resize one.

Backgrounds: 14 procedural wallpapers (soft mesh gradients rendered on canvas), 12 gradients, solid or custom colours, or your own image, each with optional blur. Presets save the look (background, frame, cursor, camera), and one preset can be starred as the default for new recordings.

## Architecture

```
src/
  main/            Electron main process
    index.ts         app lifecycle, IPC, permissions, getDisplayMedia handler
    recording.ts     recording session state machine (countdown → recording → finishing)
    cursor-tracker.ts 60Hz cursor sampling + uiohook-napi global clicks
    projects.ts      project folders (~/Movies/Toom/<id>), chunk appends, positional writers
    protocol.ts      media:// protocol with HTTP Range support (video seeking + mediabunny)
    windows.ts       home, floating toolbar (content-protected), editor windows
  preload/         typed contextBridge API (window.api)
  shared/          types + default edit state
  renderer/src/
    recorder/capture.ts  MediaStreams, audio mixing, MediaRecorder → chunks → main
    engine/
      compositor.ts  renders one frame: background, zoom camera, rounded frame, cursor, clicks, webcam
      camera.ts      zoom curve + edge-clamped camera translation
      cursor.ts      fixed-rate, spring-smoothed cursor paths (pure lookup → preview = export)
      autozoom.ts    click clustering + dwell detection
      convert.ts     WebM → MP4 remux (packet copy) via mediabunny
      exporter.ts    decode → render → encode (WebCodecs) → MP4, audio trimmed + interleaved
    editor/          Editor, Preview (canvas), Timeline, Inspector, ExportDialog
    home/, toolbar/
```

**Data flow.** The renderer records with `MediaRecorder` into WebM and streams 1-second chunks to the main process, which appends them to disk. The main process samples the cursor and clicks against the same clock. When the editor opens a recording for the first time, it remuxes WebM → MP4 (seekable) and seeds auto-zooms. Preview and export both call the same `renderFrame()` with time-pure inputs, so the export matches the preview.

**Project folder.** `project.json` (metadata + edits), `cursor.json`, `screen.mp4`, `camera.mp4`, and any background images.

## Accounts, plans & updates
- **First run**: a welcome window walks through sign-in, choosing a plan, permissions and the recording shortcuts. Every step can be skipped. Settings → Account handles it later.
- **Sign-in**: an emailed 6-digit code that doubles as a magic link (`toom://auth/magic`), or email and password, with password reset by code. The session token is encrypted with the OS keychain (`safeStorage`).
- **Free vs Pro**:
  - Free: recordings stop by themselves at 5 minutes (the recording controls count down the last 30 s), exports are capped at 720p and 30 fps, and exports carry a small "Made with Toom" mark.
  - Pro: no limits.
  - The limits live in `src/shared/account.ts`.
- **Subscriptions** go through Bachs checkout in the browser. Toom notices the payment by itself, either through the `toom://billing/success` link or by polling. "Manage billing" opens the Bachs customer portal.
- **Offline**: Pro keeps working for up to 7 days without a connection, using a server-signed entitlement that the app verifies with `TOOM_ENTITLEMENT_PUBLIC_KEY`.
- **Auto-updates** use `electron-updater` against the GitHub releases (`publish` in `electron-builder.yml`). Toom checks on launch and every 4 hours, downloads in the background and installs when the app restarts. You can also use *Check for Updates…* (app menu, or the About window).

## Releasing

GitHub Actions builds and publishes every release (`.github/workflows/release.yml`):

```bash
npm run release          # 0.3.0 → 0.3.1: typecheck, test, bump, tag, push
npm run release minor    # 0.3.0 → 0.4.0
```

The tag starts the workflow: it type-checks and tests, builds macOS (Apple silicon and Intel `.dmg` + update `.zip`) and Windows (one `Toom-Setup.exe` for x64 and Arm) in parallel, uploads them to a draft release, then publishes it as the latest. The website's download links (`/releases/latest/download/Toom-arm64.dmg`, `Toom-x64.dmg`, `Toom-Setup.exe`) and every installed app's updates switch to it at the same moment. *Run workflow* on the Actions tab makes a test build without publishing; the installers are attached to the run.

Set these under **Settings → Secrets and variables → Actions**:

| | |
|---|---|
| `TOOM_API_URL` (variable) | the API, default `https://api.trytoom.tech` |
| `TOOM_ENTITLEMENT_PUBLIC_KEY` (variable) | public half of the API's entitlement key, so Pro works offline |
| `RELEASE_REPO` (variable) + `RELEASES_TOKEN` (secret) | optional: publish to another **public** repo (e.g. `toom-releases`) so this one can stay private. Downloads and updates need a public repo. Update `DOWNLOAD_BASE_URL` on the website to match. |
| `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (secrets) | optional: sign and notarize the Mac app (needs an Apple Developer account). Without them the Mac build is unsigned: people open it the first time with right-click → Open, or System Settings → Privacy & Security → Open Anyway. |
| `WIN_CERTIFICATE`, `WIN_CERTIFICATE_PASSWORD` (secrets) | optional: sign the Windows installer. Without it, SmartScreen shows "Windows protected your PC" (More info → Run anyway) until the app builds a reputation. |

Local builds (no upload): `npm run dist:mac` / `npm run dist:win`.

- Build settings go in `.env` (see `.env.example`): `TOOM_API_URL`, `TOOM_ENTITLEMENT_PUBLIC_KEY`. CI sets them from the repo's Actions variables.

## Security, memory & disk
- **Locked-down windows**:
  - Renderers run sandboxed with context isolation and no Node.js.
  - A strict Content-Security-Policy is in place, and it drops the dev-only localhost and websocket entries in shipped builds.
  - Navigation, new windows and webviews are blocked. Links open in the browser, https only in shipped builds.
  - IPC is refused from anything that isn't one of Toom's own pages (`src/main/security.ts`).
  - Camera, microphone and screen permissions are granted only to Toom's own pages.
- **Shipped binary**:
  - Electron fuses switch off run-as-Node, `NODE_OPTIONS` and the inspector flags, and turn on asar integrity checks.
  - Only English Chromium resources are bundled, source maps are left out, and installers use maximum compression.
- **Files**:
  - Project files are resolved inside their project folder only.
  - Open file handles are released if a window closes mid-write.
  - A failed or cancelled export deletes its half-written file.
- **Memory**:
  - Exports release decoders, frames and models even when they fail.
  - The text-recognition engine (~100 MB) unloads a minute after a scan.
  - The background-layer cache holds at most 3 sizes.
  - Idle windows (library, settings, welcome) are throttled while hidden.
- **Disk**: Settings → Advanced → Disk usage shows the space used by recordings, libraries and downloaded models, and can clear the models (they download again when needed).
- **API** (toom-api):
  - Security headers are set on every response, and account responses are sent with `no-store`.
  - Request bodies are limited to 64 KB, or 1 MB for webhooks.
  - Forwarded IPs are trusted only with `TRUST_PROXY=true`.
  - Expired sessions, codes and old webhook ids are purged every 6 hours.

## Offline & downloads
- **Text recognition** for automatic privacy (Tesseract, English) ships with the app — nothing to download.
- **Face detection** (blurring faces, face tracking) downloads a small model (≈230 KB) once.
- **Keystrokes**: Toom records shortcuts and *when* you type, never what you type (Settings → Advanced → Track shortcuts and typing).
- **Transcription** downloads the Whisper model once (≈45 MB Fast, ≈90 MB Accurate). It's cached, so later runs work offline. Pick the model and language in the Transcript panel.
- **Camera cutout** downloads a small segmentation model (≈250 KB) once into the app data folder.
- **Unsplash** needs a free access key (unsplash.com/developers → New application). Paste it into the Unsplash tab. Images you use are saved to the background library and appear under *Recent* when you're offline.

### Renamed from screen.rec
On first launch Toom copies the old app data (settings, background library, models) and moves `~/Movies/screen.rec` (or `~/Movies/toom`) to `~/Movies/Toom`.

## Known limitations / next phases
1. **OS cursor is baked into the capture.** Chromium can't hide it. The custom cursor overlay is therefore off by default. Fix: a small native capture helper (ScreenCaptureKit `showsCursor = false` on macOS, Windows.Graphics.Capture `IsCursorCaptureEnabled = false`) so the smoothed cursor can replace the real one.
2. **Window recordings** follow the window's frame for auto zoom and clicks; moving the window to another display mid-recording isn't handled.
3. **iPhone/iPad screen over USB** needs a native CoreMediaIO helper. Device mode currently records standard video devices only.
4. Phase 2 ideas, in rough Screen Studio parity order:
   - keystroke overlay (uiohook already ships key events)
   - burned-in captions from the transcript
   - GIF/ProRes export
   - sensitive-data masking
   - iPhone recording
   - share links

## Testing
- `npm run test:ui` (needs Playwright): records a scripted demo session, then screenshots the real editor (mocked Electron API) into `test/ui/shots/`.
- `node test/ui/account.mjs` (needs Playwright): starts the real API (toom-api, next to this repo or at `TOOM_API_DIR`) with a fake Bachs, then drives welcome → code sign-in → Pro checkout → webhook → Settings → Account → Free export limits in the real UI.
- `npm test` in toom-api: API tests (auth, Bachs checkout/portal/webhooks, entitlements).
- `npm test`: unit tests for auto-zoom, the zoom curve, camera clamping, layout and cursor smoothing.
- `npm run test:pipeline` (needs Playwright installed): records a synthetic WebM in headless Chromium, then runs the real remux and export code against a local file server.
