<p align="center">
  <img src="build/icon.png" width="112" alt="Toom app icon">
</p>

<h1 align="center">Toom</h1>

<p align="center">
  <b>Screen recordings that edit themselves.</b><br>
  Hit record and talk. Toom zooms in where you click, smooths your cursor, writes your captions and hides what's private.
</p>

<p align="center">
  <a href="https://github.com/prezine/toom-software/releases/latest"><b>Download</b></a> ·
  <a href="https://trytoom.tech">Website</a> ·
  <a href="https://trytoom.tech/changelog">What's new</a> ·
  <a href="https://x.com/trytoom">X</a> ·
  <a href="https://www.instagram.com/trytooom/">Instagram</a>
</p>

---

## What Toom does

- **Auto zoom.** The view follows your clicks, so viewers always see what you're doing.
- **Smooth cursor.** Shaky mouse movement becomes a calm glide, with click effects you can style.
- **Captions.** Spoken words are transcribed on your computer and added as animated captions.
- **Privacy, automatically.** Emails, card numbers, API keys and faces are found and covered before you share.
- **Edit by text.** Delete words from the transcript and the video cuts with them. Remove filler words and long pauses in one click.
- **Camera layouts.** Webcam overlay, split screen, full screen or a cutout with the background removed.
- **Backgrounds and frames.** Wallpapers, gradients or your own image, with padding, rounded corners and shadow.
- **Keystrokes and speed.** Show keyboard shortcuts on screen, and speed up typing automatically.
- **Export.** MP4 up to 4K at 60 fps.

Recording and editing happen on your computer. Your videos never leave it.

## Download and install

Get the latest version from the [releases page](https://github.com/prezine/toom-software/releases/latest):

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 or newer) | `Toom-arm64.dmg` |
| Mac with Intel | `Toom-x64.dmg` |
| Windows 10 or 11 (x64 or Arm) | `Toom-Setup.exe` |

Not sure which Mac you have? Open the Apple menu → **About This Mac**. It says *Chip: Apple M…* or *Processor: Intel…*.

### Mac

1. Open the `.dmg` and drag **Toom** into **Applications**.
2. Open Toom from Applications. macOS will block it the first time, because Toom isn't signed by Apple yet. To allow it:
   1. Open **System Settings → Privacy & Security**.
   2. Scroll down to **Security**. You'll see *"Toom" was blocked to protect your Mac*.
   3. Click **Open Anyway**, then **Open**, and enter your password if asked.

   You only do this once. On macOS 14 or earlier you can also right-click Toom in Applications and choose **Open**.
3. If macOS says *"Toom" is damaged and can't be opened*, it was quarantined by your browser. Open **Terminal**, run this once, then open Toom again:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Toom.app
   ```

You don't need to turn off macOS security (Gatekeeper) for Toom. **Open Anyway** allows just this one app.

### Windows

1. Run `Toom-Setup.exe`.
2. If Windows shows *Windows protected your PC*, click **More info → Run anyway**. This appears because the installer isn't signed yet.
3. Follow the installer, then open Toom from the Start menu.

## Permissions

Toom asks for these the first time it needs them. You can change them later in your system settings.

| Permission | Why | |
|---|---|---|
| Screen Recording (Mac) | to record your screen | Required. After allowing it, quit and reopen Toom. |
| Microphone | to record your voice | When you turn the mic on |
| Camera | for the webcam overlay | When you turn the camera on |
| Accessibility (Mac) | lets auto zoom follow your clicks anywhere | Optional, but recommended |

On a Mac, these are in **System Settings → Privacy & Security**.

## Getting started

1. **Sign in.** Toom asks you to sign in or create a free account the first time it opens.
2. **Open the recording bar** with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>1</kbd> (Mac) or <kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>1</kbd> (Windows), or from the Toom icon in the menu bar or system tray.
3. **Choose what to record:** a display, a window, an area you drag out, or a camera. Turn on your microphone and camera if you want them.
4. **Record.** Press <kbd>⌘/Ctrl</kbd><kbd>⇧</kbd><kbd>2</kbd> to start and stop. You can pause or discard from the controls.
5. **Edit.** When you stop, the editor opens with zooms already added. Adjust the look, trim, add captions or a camera layout.
6. **Export** with <kbd>⌘/Ctrl</kbd><kbd>E</kbd> and share.

### Editor shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>S</kbd> | Split the clip at the playhead |
| <kbd>⌫</kbd> | Delete the selected clip, zoom or transcript words |
| <kbd>Z</kbd> | Add a zoom |
| <kbd>M</kbd> | Add a privacy mask |
| <kbd>←</kbd> / <kbd>→</kbd> | Step one frame (hold <kbd>Shift</kbd> for one second) |

All shortcuts can be changed in **Settings → Shortcuts**.

## Free and Pro

Toom is free to download and use. The free plan has every editing tool, with recordings up to 5 minutes, exports at 720p and a small "Made with Toom" mark. **Pro** removes all three: unlimited recording length, exports up to 4K at 60 fps and no watermark. Upgrade from **Settings → Account**.

## Updates

Toom updates itself. It checks in the background, downloads new versions quietly and installs them the next time you restart it. To check now, open **About Toom** (Toom menu on Mac, Help menu on Windows) and click **Check for Updates**. See what changed on the [changelog](https://trytoom.tech/changelog).

## System requirements

- **Mac:** macOS 12 Monterey or later, Apple silicon or Intel
- **Windows:** Windows 10 or 11, x64 or Arm

## Uninstall

- **Mac:** quit Toom and drag it from Applications to the Bin. Your recordings stay in `Movies/Toom` until you delete them.
- **Windows:** Settings → Apps → Installed apps → Toom → Uninstall. Your recordings stay in `Videos\Toom`.

## Help

Questions or problems? Read the [FAQ](https://trytoom.tech/#faq) or email [hello@trytoom.tech](mailto:hello@trytoom.tech). When reporting a bug, include your version from **About Toom** (click the version to copy it).

## License

[MIT](LICENSE) © 2026 Precious Tom
