// About Toom: the app's identity, its version, updates and where to find us. Opens from the Toom
// menu (macOS), Help menu (Windows) and the tray, signed in or not.
import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/api'
import { useUpdateStatus } from '@renderer/lib/account'
import { AppIcon, Wordmark } from '@renderer/lib/brand'
import { Button } from '@renderer/lib/ui'
import { Download } from '@renderer/lib/icons'

type Info = Awaited<ReturnType<typeof api.app.aboutInfo>>

const SITE = 'https://trytoom.tech'
const LINKS: [string, string][] = [
  ['Website', SITE],
  ['What’s new', `${SITE}/changelog`],
  ['Help', `${SITE}/#faq`],
  ['Privacy', `${SITE}/privacy`],
  ['Terms', `${SITE}/terms`]
]
const SOCIALS = [
  {
    name: 'Toom on X',
    href: 'https://x.com/trytoom',
    d: 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z'
  },
  {
    name: 'Toom on Instagram',
    href: 'https://www.instagram.com/trytooom/',
    d: 'M12 2.2c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.7.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z'
  }
]

const OS_NAME: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
const ARCH: Record<string, string> = { arm64: 'Apple silicon', x64: 'Intel' }

export function About(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [copied, setCopied] = useState(false)
  const u = useUpdateStatus()

  useEffect(() => {
    document.title = 'About Toom'
    void api.app.aboutInfo().then(setInfo)
  }, [])

  const archLabel = info ? (info.platform === 'darwin' ? ARCH[info.arch] ?? info.arch : info.arch) : ''
  const details = info
    ? `Toom ${info.version} (${info.arch})${info.packaged ? '' : ' development build'}\n${OS_NAME[info.platform] ?? info.platform} ${info.os}\nElectron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`
    : ''

  const update =
    u.state === 'checking'
      ? 'Checking for updates…'
      : u.state === 'none'
        ? 'Toom is up to date.'
        : u.state === 'downloading'
          ? `Downloading Toom ${u.version}… ${u.percent}%`
          : u.state === 'ready'
            ? `Toom ${u.version} is ready to install.`
            : u.state === 'error'
              ? u.message
              : u.state === 'unsupported'
                ? u.reason
                : ''

  return (
    <div className="flex h-full flex-col select-none">
      <header className="drag h-9 shrink-0" />
      <main className="flex flex-1 flex-col items-center px-8 text-center">
        <AppIcon size={96} />
        <Wordmark height={26} className="mt-6" />
        <p className="mt-3 text-[13px] text-ink-300">Screen recordings that edit themselves.</p>

        <button
          className="no-drag mt-4 rounded-md px-2 py-1 text-[12px] text-ink-300 tabular-nums transition hover:bg-white/[0.06] hover:text-ink-100"
          title="Copy version details"
          onClick={() => {
            void navigator.clipboard.writeText(details).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          {copied ? 'Copied version details' : info ? `Version ${info.version}${archLabel ? ` (${archLabel})` : ''}` : ' '}
        </button>

        <div className="no-drag mt-3 flex min-h-[52px] flex-col items-center gap-2">
          {u.state === 'ready' ? (
            <Button size="sm" variant="primary" onClick={() => void api.updater.install()}>
              <Download size={13} /> Restart to update
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={u.state === 'unsupported' || u.state === 'checking' || u.state === 'downloading'}
              onClick={() => void api.updater.check()}
            >
              Check for Updates
            </Button>
          )}
          {update && <p className="max-w-[300px] text-[11.5px] leading-snug text-ink-400">{update}</p>}
        </div>

        <nav className="no-drag mt-5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12.5px]" aria-label="Links">
          {LINKS.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="text-ink-200 hover:text-ink-100 hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <div className="no-drag mt-4 flex gap-2">
          {SOCIALS.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              title={s.name}
              aria-label={s.name}
              className="grid size-8 place-items-center rounded-full bg-white/[0.07] text-ink-200 transition hover:bg-white/[0.14] hover:text-ink-100"
            >
              <svg viewBox="0 0 24 24" className="size-[14px]" fill="currentColor" aria-hidden>
                <path d={s.d} />
              </svg>
            </a>
          ))}
        </div>
      </main>
      <footer className="px-6 pt-4 pb-5 text-center text-[11px] leading-relaxed text-ink-400">
        © {new Date().getFullYear()} Toom. All rights reserved.
        {info && (
          <span className="block">
            Electron {info.electron} · Chromium {info.chrome.split('.')[0]}
          </span>
        )}
      </footer>
    </div>
  )
}
