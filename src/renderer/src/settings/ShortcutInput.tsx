import { useEffect, useState } from 'react'
import { cx } from '@renderer/lib/ui'

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  return CODE_KEYS[code] ?? null
}

/** KeyboardEvent → Electron accelerator, or null if it's only modifiers / not allowed. */
export function eventToAccelerator(e: KeyboardEvent, isMac: boolean): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: string[] = []
  if (isMac) {
    if (e.metaKey) mods.push('CommandOrControl')
    if (e.ctrlKey) mods.push('Control')
  } else {
    if (e.ctrlKey) mods.push('CommandOrControl')
    if (e.metaKey) mods.push('Super')
  }
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  // global shortcuts need a modifier, except function keys
  if (mods.length === 0 && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

export function formatAccelerator(accel: string, isMac: boolean): string[] {
  if (!accel) return []
  return accel.split('+').map((p) => {
    if (isMac) {
      if (p === 'CommandOrControl' || p === 'Command' || p === 'Cmd') return '⌘'
      if (p === 'Control' || p === 'Ctrl') return '⌃'
      if (p === 'Alt' || p === 'Option') return '⌥'
      if (p === 'Shift') return '⇧'
    } else {
      if (p === 'CommandOrControl' || p === 'Control') return 'Ctrl'
      if (p === 'Super') return 'Win'
    }
    if (p === 'Up') return '↑'
    if (p === 'Down') return '↓'
    if (p === 'Left') return '←'
    if (p === 'Right') return '→'
    return p
  })
}

export function ShortcutInput({
  value,
  onChange,
  isMac,
  invalid
}: {
  value: string
  onChange: (accel: string) => void
  isMac: boolean
  invalid?: boolean
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return setRecording(false)
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        onChange('')
        return setRecording(false)
      }
      const accel = eventToAccelerator(e, isMac)
      if (accel) {
        onChange(accel)
        setRecording(false)
      }
    }
    const onBlur = (): void => setRecording(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording, isMac, onChange])

  const parts = formatAccelerator(value, isMac)
  return (
    <button
      onClick={() => setRecording((r) => !r)}
      className={cx(
        'flex h-8 min-w-[140px] items-center justify-center gap-1 rounded-lg px-2.5 text-[13px] ring-1 transition-colors',
        recording
          ? 'bg-brand-500/15 text-brand-300 ring-brand-500'
          : invalid
            ? 'bg-red-500/10 ring-red-500/40'
            : 'bg-ink-900 ring-white/10 hover:ring-white/20'
      )}
    >
      {recording ? (
        <span className="text-xs">Press keys… (⌫ clears)</span>
      ) : parts.length ? (
        parts.map((p, i) => (
          <kbd
            key={i}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-ink-700 px-1.5 font-sans text-[11px] font-medium text-ink-100 ring-1 ring-white/10"
          >
            {p}
          </kbd>
        ))
      ) : (
        <span className="text-xs text-ink-400">Not set</span>
      )}
    </button>
  )
}
