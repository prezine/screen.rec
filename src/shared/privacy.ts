// Finds sensitive text in OCR results: emails, phone numbers, card numbers and secret keys.
// Pure functions so they can be unit-tested without an OCR engine.

export type PrivacyKind = 'email' | 'phone' | 'card' | 'key' | 'face'

export const PRIVACY_LABELS: Record<PrivacyKind, string> = {
  email: 'Emails',
  phone: 'Phone numbers',
  card: 'Card numbers',
  key: 'API keys & tokens',
  face: 'Faces'
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  bbox: Box
}

export interface Finding {
  kind: Exclude<PrivacyKind, 'face'>
  bbox: Box
  text: string
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const CARD = /(?:\d[ -]?){13,19}/g
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}/g
const KEYS = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\b(?:pk|sk|api|key|token|secret)[_-][A-Za-z0-9_-]{16,}/gi
]
/** long random-looking strings (mixed letters and digits, no spaces) */
const GENERIC_SECRET = /[A-Za-z0-9_\-+/=]{28,}/g

export function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

function looksRandom(s: string): boolean {
  const letters = /[A-Za-z]/.test(s)
  const digits = /\d/.test(s)
  const upper = /[A-Z]/.test(s)
  const lower = /[a-z]/.test(s)
  if (!(letters && digits)) return false
  if (!(upper && lower) && !/\d{4,}/.test(s)) return false
  // not a URL path or file name
  return !/^(https?|www)|\.(com|js|ts|png|jpg|html)$/i.test(s)
}

/**
 * Find sensitive spans in one line of OCR words. Matching runs on the joined line so values
 * split across words (card groups, phone numbers) are caught; each match maps back to the union
 * of the words it touches.
 */
export function findInLine(words: OcrWord[]): Finding[] {
  if (!words.length) return []
  let line = ''
  const spans: [number, number][] = []
  for (const w of words) {
    if (line) line += ' '
    spans.push([line.length, line.length + w.text.length])
    line += w.text
  }
  const out: Finding[] = []
  const taken: [number, number][] = []
  const add = (kind: Finding['kind'], s: number, e: number): void => {
    if (taken.some(([a, b]) => s < b && e > a)) return
    const touched = words.filter((_, i) => spans[i][0] < e && spans[i][1] > s)
    if (!touched.length) return
    taken.push([s, e])
    out.push({
      kind,
      text: line.slice(s, e),
      bbox: {
        x0: Math.min(...touched.map((w) => w.bbox.x0)),
        y0: Math.min(...touched.map((w) => w.bbox.y0)),
        x1: Math.max(...touched.map((w) => w.bbox.x1)),
        y1: Math.max(...touched.map((w) => w.bbox.y1))
      }
    })
  }
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      fn(m)
      if (m[0].length === 0) re.lastIndex++
    }
  }
  each(EMAIL, (m) => add('email', m.index, m.index + m[0].length))
  for (const re of KEYS) each(re, (m) => add('key', m.index, m.index + m[0].length))
  each(GENERIC_SECRET, (m) => looksRandom(m[0]) && add('key', m.index, m.index + m[0].length))
  each(CARD, (m) => {
    const raw = m[0].trim()
    const digits = raw.replace(/\D/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add('card', m.index, m.index + raw.length)
  })
  each(PHONE, (m) => {
    const raw = m[0].trim()
    const digits = raw.replace(/\D/g, '')
    const before = line[m.index - 1] ?? ''
    // phone-shaped: 9–15 digits, written with + / brackets / separators, not part of an amount or a date
    if (digits.length < 9 || digits.length > 15) return
    if (/[$€£₦.,]/.test(before) || /\d[.,]\d{2}$/.test(raw)) return
    if (!/[+()\s.-]/.test(raw) && !raw.startsWith('0')) return
    if (/^\d{4}[-.]\d{2}[-.]\d{2}/.test(raw)) return
    add('phone', m.index, m.index + raw.length)
  })
  return out
}
