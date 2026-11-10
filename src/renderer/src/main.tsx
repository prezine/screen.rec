import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Launcher } from './launcher/Launcher'
import { Library } from './library/Library'
import { Toolbar } from './toolbar/Toolbar'
import { Island } from './toolbar/Island'
import { Editor } from './editor/Editor'
import { AreaSelect } from './area/AreaSelect'
import { SettingsWindow, type SectionId } from './settings/SettingsWindow'
import { useAppearance } from './lib/appearance'
import { Onboarding } from './onboarding/Onboarding'
import { RequireAccount } from './account/RequireAccount'

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, '') || '/')
  useEffect(() => {
    const on = (): void => setHash(window.location.hash.replace(/^#/, '') || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const TRANSPARENT = ['/toolbar', '/launcher', '/area', '/island', '/settings', '/welcome']

function App(): React.JSX.Element {
  const route = useHash()
  useAppearance()
  useEffect(() => {
    document.documentElement.classList.toggle(
      'toolbar',
      TRANSPARENT.some((r) => route.startsWith(r))
    )
  }, [route])

  if (route.startsWith('/toolbar')) return <Toolbar />
  if (route.startsWith('/island')) return <Island />
  if (route.startsWith('/launcher')) return <Launcher />
  if (route.startsWith('/welcome')) return <Onboarding signInOnly={route.startsWith('/welcome/signin')} />
  const area = /^\/area\/([\w-]+)/.exec(route)
  if (area) return <AreaSelect displayId={area[1]} />
  const settings = /^\/settings(?:\/(\w+))?/.exec(route)
  if (settings)
    return (
      <RequireAccount>
        <SettingsWindow initial={(settings[1] as SectionId) || 'general'} />
      </RequireAccount>
    )
  const editor = /^\/editor\/([\w-]+)/.exec(route)
  if (editor)
    return (
      <RequireAccount>
        <Editor projectId={editor[1]} />
      </RequireAccount>
    )
  return (
    <RequireAccount>
      <Library />
    </RequireAccount>
  )
}

void window.api
  .platform()
  .then((p) => document.documentElement.classList.add(`platform-${p === 'darwin' ? 'mac' : 'win'}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
