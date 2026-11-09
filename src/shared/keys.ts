// Keystrokes recorded alongside a recording.
// Privacy: only shortcuts (a key pressed with ⌘/Ctrl/⌥) and non-text keys (Enter, Esc, arrows…) keep
// their identity. Ordinary typing is stored as bare timestamps — never which keys were pressed.

export type Mod = 'meta' | 'ctrl' | 'alt' | 'shift'

export interface KeyEvent {
  t: number
  /** key name, e.g. "C", "Enter", "ArrowLeft", "F5" */
  key: string
  mods: Mod[]
}

const MODIFIER_KEYS = new Set([
  'Ctrl',
  'CtrlRight',
  'Alt',
  'AltRight',
  'Shift',
  'ShiftRight',
  'Meta',
  'MetaRight',
  'CapsLock'
])
const SPECIAL_KEYS = new Set([
  'Enter',
  'NumpadEnter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Insert'
])

export type KeyKind = 'ignore' | 'shortcut' | 'special' | 'typing'

export function classifyKey(key: string | undefined, mods: Mod[]): KeyKind {
  if (!key || MODIFIER_KEYS.has(key)) return 'ignore'
  if (mods.some((m) => m !== 'shift')) return 'shortcut'
  if (SPECIAL_KEYS.has(key) || /^F\d{1,2}$/.test(key)) return 'special'
  return 'typing'
}

const MAC_MODS: Record<Mod, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const WIN_MODS: Record<Mod, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }
const MOD_ORDER: Mod[] = ['ctrl', 'alt', 'shift', 'meta']

const KEY_LABELS: Record<string, [mac: string, win: string]> = {
  Enter: ['↩', 'Enter'],
  NumpadEnter: ['↩', 'Enter'],
  Escape: ['esc', 'Esc'],
  Tab: ['⇥', 'Tab'],
  Backspace: ['⌫', 'Backspace'],
  Delete: ['⌦', 'Del'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  PageUp: ['⇞', 'PgUp'],
  PageDown: ['⇟', 'PgDn'],
  Home: ['↖', 'Home'],
  End: ['↘', 'End'],
  Space: ['Space', 'Space'],
  Semicolon: [';', ';'],
  Equal: ['=', '='],
  Comma: [',', ','],
  Minus: ['-', '-'],
  Period: ['.', '.'],
  Slash: ['/', '/'],
  Backquote: ['`', '`'],
  BracketLeft: ['[', '['],
  BracketRight: [']', ']'],
  Backslash: ['\\', '\\'],
  Quote: ["'", "'"]
}

/** The keycaps to draw for one key event, in display order. */
export function keycaps(e: KeyEvent, mac: boolean): string[] {
  const mods = MOD_ORDER.filter((m) => e.mods.includes(m)).map((m) => (mac ? MAC_MODS : WIN_MODS)[m])
  const l = KEY_LABELS[e.key]
  const key = l ? l[mac ? 0 : 1] : e.key.replace(/^Numpad/, '')
  return [...mods, key]
}

/**
 * Stretches of continuous typing (seconds, recording time): bursts of keystrokes no more than
 * `gap` apart, at least `minLength` long and with at least `minKeys` keys.
 */
export function typingRanges(
  typing: number[],
  opts: { gap?: number; minLength?: number; minKeys?: number } = {}
): [number, number][] {
  const gap = opts.gap ?? 1.2
  const minLength = opts.minLength ?? 1.5
  const minKeys = opts.minKeys ?? 6
  const ts = [...typing].sort((a, b) => a - b)
  const out: [number, number][] = []
  let start = -1
  let last = -1
  let n = 0
  const flush = (): void => {
    if (start >= 0 && last - start >= minLength && n >= minKeys) out.push([start, last + 0.15])
  }
  for (const t of ts) {
    if (start < 0 || t - last > gap) {
      flush()
      start = t
      n = 0
    }
    last = t
    n++
  }
  flush()
  return out
}
