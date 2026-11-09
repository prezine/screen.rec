import type { Clip } from '@shared/clips'
import { toOutput, toSource, totalLength } from '@shared/clips'
import type { SoundItem, SoundSource } from '@shared/types'
import { mediaUrl } from '@renderer/lib/api'

// ---------------------------------------------------------------------------
// Built-in sounds. Everything here is synthesised on the device (no downloads, no licences):
// short UI/transition effects and a few seamless music loops.
// ---------------------------------------------------------------------------

export interface SfxPreset {
  id: string
  label: string
  group: 'Interface' | 'Transitions' | 'Accents'
  duration: number
}

export interface MusicPreset {
  id: string
  label: string
  mood: string
  bpm: number
  /** loop length in seconds */
  duration: number
  colors: [string, string]
}

export const SFX_PRESETS: SfxPreset[] = [
  { id: 'click', label: 'Click', group: 'Interface', duration: 0.12 },
  { id: 'pop', label: 'Pop', group: 'Interface', duration: 0.25 },
  { id: 'tap', label: 'Soft tap', group: 'Interface', duration: 0.2 },
  { id: 'toggle', label: 'Toggle', group: 'Interface', duration: 0.22 },
  { id: 'typing', label: 'Typing', group: 'Interface', duration: 1.4 },
  { id: 'notify', label: 'Notification', group: 'Interface', duration: 0.7 },
  { id: 'success', label: 'Success', group: 'Interface', duration: 0.9 },
  { id: 'error', label: 'Error', group: 'Interface', duration: 0.6 },
  { id: 'shutter', label: 'Camera', group: 'Interface', duration: 0.35 },
  { id: 'whoosh', label: 'Whoosh', group: 'Transitions', duration: 0.8 },
  { id: 'swipe', label: 'Swipe', group: 'Transitions', duration: 0.4 },
  { id: 'rise', label: 'Riser', group: 'Transitions', duration: 2 },
  { id: 'boom', label: 'Boom', group: 'Transitions', duration: 1.6 },
  { id: 'ding', label: 'Ding', group: 'Accents', duration: 1.4 },
  { id: 'chime', label: 'Chime', group: 'Accents', duration: 1.8 },
  { id: 'sparkle', label: 'Sparkle', group: 'Accents', duration: 1.2 }
]

const loopLen = (bpm: number, bars: number): number => (bars * 4 * 60) / bpm

export const MUSIC_PRESETS: MusicPreset[] = [
  {
    id: 'lofi',
    label: 'Lo-fi',
    mood: 'Mellow, warm',
    bpm: 80,
    duration: loopLen(80, 8),
    colors: ['#7c5cff', '#f59e9e']
  },
  {
    id: 'ambient',
    label: 'Ambient',
    mood: 'Calm, spacious',
    bpm: 60,
    duration: loopLen(60, 8),
    colors: ['#0ea5e9', '#6366f1']
  },
  {
    id: 'upbeat',
    label: 'Upbeat',
    mood: 'Bright, energetic',
    bpm: 118,
    duration: loopLen(118, 8),
    colors: ['#f59e0b', '#ef4444']
  },
  {
    id: 'corporate',
    label: 'Product',
    mood: 'Clean, optimistic',
    bpm: 100,
    duration: loopLen(100, 8),
    colors: ['#10b981', '#06b6d4']
  }
]

export function presetLabel(src: SoundSource): string {
  if (src.type === 'file') return src.name
  return SFX_PRESETS.find((p) => p.id === src.id)?.label ?? MUSIC_PRESETS.find((p) => p.id === src.id)?.label ?? src.id
}

// ---- synthesis helpers -------------------------------------------------------------

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12)

function noiseBuffer(c: BaseAudioContext, seconds: number): AudioBuffer {
  const b = c.createBuffer(1, Math.max(1, Math.ceil(seconds * c.sampleRate)), c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}

function reverb(c: BaseAudioContext, seconds: number, decay = 3): ConvolverNode {
  const len = Math.ceil(seconds * c.sampleRate)
  const b = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
  }
  const conv = c.createConvolver()
  conv.buffer = b
  return conv
}

/** Attack/decay envelope on a gain node. */
function env(g: GainNode, t: number, peak: number, a: number, d: number, sustain = 0.0001): void {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + a)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d)
}

function tone(
  c: BaseAudioContext,
  out: AudioNode,
  o: {
    type?: OscillatorType
    f: number
    f2?: number
    t: number
    a?: number
    d: number
    gain: number
    detune?: number
    glide?: number
  }
): void {
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, o.t)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + (o.glide ?? o.d))
  if (o.detune) osc.detune.value = o.detune
  const g = c.createGain()
  env(g, o.t, o.gain, o.a ?? 0.004, o.d)
  osc.connect(g).connect(out)
  osc.start(o.t)
  osc.stop(o.t + (o.a ?? 0.004) + o.d + 0.05)
}

function noiseHit(
  c: BaseAudioContext,
  out: AudioNode,
  o: {
    t: number
    d: number
    gain: number
    type?: BiquadFilterType
    f: number
    f2?: number
    q?: number
    a?: number
    noise: AudioBuffer
  }
): void {
  const src = c.createBufferSource()
  src.buffer = o.noise
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.setValueAtTime(o.f, o.t)
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, o.t + o.d)
  f.Q.value = o.q ?? 1
  const g = c.createGain()
  env(g, o.t, o.gain, o.a ?? 0.002, o.d)
  src.connect(f).connect(g).connect(out)
  src.start(o.t, Math.random() * 0.5)
  src.stop(o.t + (o.a ?? 0.002) + o.d + 0.05)
}

// ---- effects ---------------------------------------------------------------------

function synthSfx(id: string, c: OfflineAudioContext): void {
  const comp = c.createDynamicsCompressor()
  comp.connect(c.destination)
  const dry = c.createGain()
  dry.connect(comp)
  const verb = reverb(c, 1.6)
  const wet = c.createGain()
  wet.gain.value = 0.18
  verb.connect(wet).connect(comp)
  const out = c.createGain()
  out.connect(dry)
  out.connect(verb)
  const N = noiseBuffer(c, 3)
  switch (id) {
    case 'click':
      noiseHit(c, out, { t: 0, d: 0.03, gain: 0.9, type: 'highpass', f: 2500, noise: N })
      tone(c, out, { f: 2200, f2: 1400, t: 0, d: 0.04, gain: 0.3 })
      break
    case 'pop':
      tone(c, out, { f: 900, f2: 260, t: 0, d: 0.16, gain: 0.9, glide: 0.08 })
      break
    case 'tap':
      tone(c, out, { type: 'triangle', f: 520, f2: 380, t: 0, d: 0.14, gain: 0.7 })
      break
    case 'toggle':
      tone(c, out, { f: 660, t: 0, d: 0.07, gain: 0.5 })
      tone(c, out, { f: 990, t: 0.07, d: 0.12, gain: 0.5 })
      break
    case 'typing':
      for (let i = 0; i < 9; i++) {
        const t = i * 0.13 + Math.random() * 0.05
        noiseHit(c, out, {
          t,
          d: 0.035,
          gain: 0.5 + Math.random() * 0.3,
          type: 'bandpass',
          f: 2600 + Math.random() * 1600,
          q: 1.4,
          noise: N
        })
        tone(c, out, { f: 180 + Math.random() * 60, t, d: 0.03, gain: 0.25 })
      }
      break
    case 'notify':
      tone(c, out, { f: mtof(84), t: 0, d: 0.35, gain: 0.45 })
      tone(c, out, { f: mtof(91), t: 0.12, d: 0.5, gain: 0.45 })
      break
    case 'success':
      tone(c, out, { type: 'triangle', f: mtof(76), t: 0, d: 0.3, gain: 0.5 })
      tone(c, out, { type: 'triangle', f: mtof(81), t: 0.11, d: 0.65, gain: 0.55 })
      tone(c, out, { f: mtof(88), t: 0.11, d: 0.6, gain: 0.2 })
      break
    case 'error': {
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1400
      lp.connect(out)
      tone(c, lp, { type: 'square', f: mtof(62), t: 0, d: 0.18, gain: 0.35 })
      tone(c, lp, { type: 'square', f: mtof(56), t: 0.16, d: 0.35, gain: 0.35 })
      break
    }
    case 'shutter':
      noiseHit(c, out, { t: 0, d: 0.05, gain: 1, type: 'highpass', f: 1800, noise: N })
      noiseHit(c, out, { t: 0.09, d: 0.12, gain: 0.8, type: 'bandpass', f: 3000, q: 0.8, noise: N })
      tone(c, out, { f: 120, t: 0.09, d: 0.08, gain: 0.4 })
      break
    case 'whoosh':
      noiseHit(c, out, { t: 0, a: 0.35, d: 0.42, gain: 0.9, type: 'bandpass', f: 300, f2: 2600, q: 0.9, noise: N })
      break
    case 'swipe':
      noiseHit(c, out, { t: 0, a: 0.12, d: 0.24, gain: 0.8, type: 'highpass', f: 1200, f2: 5200, q: 0.7, noise: N })
      break
    case 'rise':
      noiseHit(c, out, { t: 0, a: 1.7, d: 0.25, gain: 0.7, type: 'bandpass', f: 200, f2: 6000, q: 1.2, noise: N })
      tone(c, out, { type: 'sawtooth', f: 110, f2: 880, t: 0, a: 1.7, d: 0.2, gain: 0.08, glide: 1.9 })
      break
    case 'boom':
      tone(c, out, { f: 90, f2: 34, t: 0, d: 1.4, gain: 1, glide: 0.6 })
      noiseHit(c, out, { t: 0, d: 0.5, gain: 0.5, type: 'lowpass', f: 800, f2: 120, noise: N })
      break
    case 'ding':
      tone(c, out, { f: mtof(88), t: 0, d: 1.3, gain: 0.5 })
      tone(c, out, { f: mtof(88) * 2.76, t: 0, d: 0.5, gain: 0.12 })
      tone(c, out, { f: mtof(88) * 5.4, t: 0, d: 0.2, gain: 0.05 })
      break
    case 'chime':
      ;[84, 88, 91, 96].forEach((m, i) => {
        tone(c, out, { f: mtof(m), t: i * 0.09, d: 1.2, gain: 0.32 })
        tone(c, out, { f: mtof(m) * 2.76, t: i * 0.09, d: 0.35, gain: 0.06 })
      })
      break
    case 'sparkle':
      for (let i = 0; i < 12; i++) {
        tone(c, out, {
          f: mtof(96 + Math.floor(Math.random() * 12)),
          t: i * 0.06 + Math.random() * 0.03,
          d: 0.35,
          gain: 0.14
        })
      }
      break
  }
}

// ---- music ------------------------------------------------------------------------

function kick(c: BaseAudioContext, out: AudioNode, t: number, gain = 1): void {
  tone(c, out, { f: 150, f2: 42, t, d: 0.32, gain, glide: 0.12 })
}
function snare(c: BaseAudioContext, out: AudioNode, t: number, N: AudioBuffer, gain = 0.5): void {
  noiseHit(c, out, { t, d: 0.16, gain, type: 'bandpass', f: 1900, q: 0.7, noise: N })
  tone(c, out, { type: 'triangle', f: 190, t, d: 0.08, gain: gain * 0.5 })
}
function hat(c: BaseAudioContext, out: AudioNode, t: number, N: AudioBuffer, gain = 0.15, d = 0.04): void {
  noiseHit(c, out, { t, d, gain, type: 'highpass', f: 7500, noise: N })
}
function clap(c: BaseAudioContext, out: AudioNode, t: number, N: AudioBuffer, gain = 0.45): void {
  for (let k = 0; k < 3; k++)
    noiseHit(c, out, { t: t + k * 0.012, d: 0.05 + k * 0.03, gain, type: 'bandpass', f: 1400, q: 1.2, noise: N })
}

/** Electric-piano-ish chord. */
function keys(c: BaseAudioContext, out: AudioNode, notes: number[], t: number, d: number, gain: number): void {
  for (const m of notes) {
    tone(c, out, { f: mtof(m), t, a: 0.01, d, gain })
    tone(c, out, { type: 'triangle', f: mtof(m + 12), t, a: 0.005, d: d * 0.4, gain: gain * 0.25 })
  }
}

function pad(c: BaseAudioContext, out: AudioNode, notes: number[], t: number, d: number, gain: number): void {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1100
  lp.connect(out)
  for (const m of notes) {
    for (const det of [-7, 7]) {
      const osc = c.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = mtof(m)
      osc.detune.value = det
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(gain, t + Math.min(1.2, d * 0.4))
      g.gain.setValueAtTime(gain, t + d * 0.8)
      g.gain.linearRampToValueAtTime(0.0001, t + d + 0.6)
      osc.connect(g).connect(lp)
      osc.start(t)
      osc.stop(t + d + 0.7)
    }
  }
}

function pluck(c: BaseAudioContext, out: AudioNode, m: number, t: number, gain: number): void {
  const osc = c.createOscillator()
  osc.type = 'square'
  osc.frequency.value = mtof(m)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(3200, t)
  lp.frequency.exponentialRampToValueAtTime(400, t + 0.25)
  const g = c.createGain()
  env(g, t, gain, 0.003, 0.28)
  osc.connect(lp).connect(g).connect(out)
  osc.start(t)
  osc.stop(t + 0.35)
}

function synthMusic(id: string, c: OfflineAudioContext, bars: number): void {
  const preset = MUSIC_PRESETS.find((p) => p.id === id)!
  const beat = 60 / preset.bpm
  const bar = beat * 4
  const N = noiseBuffer(c, 3)
  const master = c.createDynamicsCompressor()
  master.threshold.value = -14
  master.ratio.value = 3
  master.connect(c.destination)
  const bus = c.createGain()
  bus.gain.value = 0.7
  const verb = reverb(c, id === 'ambient' ? 4 : 2.2, 2.5)
  const wet = c.createGain()
  wet.gain.value = id === 'ambient' ? 0.55 : 0.22
  bus.connect(master)
  bus.connect(verb)
  verb.connect(wet).connect(master)
  const drums = c.createGain()
  drums.connect(master)

  if (id === 'lofi') {
    const tape = c.createBiquadFilter()
    tape.type = 'lowpass'
    tape.frequency.value = 3800
    tape.connect(master)
    bus.disconnect()
    bus.connect(tape)
    bus.connect(verb)
    drums.disconnect()
    drums.connect(tape)
    const prog = [
      [57, 60, 64, 67, 71],
      [50, 53, 57, 60, 64],
      [55, 59, 62, 65, 69],
      [48, 52, 55, 59, 62]
    ]
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar
      const ch = prog[Math.floor(b / 2) % 4]
      keys(c, bus, ch, t0, bar * 0.9, 0.06)
      keys(c, bus, ch.slice(1), t0 + beat * 2.5, beat * 1.2, 0.035)
      tone(c, bus, { type: 'triangle', f: mtof(ch[0] - 12), t: t0, a: 0.02, d: bar * 0.8, gain: 0.25 })
      kick(c, drums, t0, 0.8)
      kick(c, drums, t0 + beat * 1.5, 0.55)
      kick(c, drums, t0 + beat * 2.25, 0.5)
      snare(c, drums, t0 + beat, N, 0.32)
      snare(c, drums, t0 + beat * 3, N, 0.32)
      for (let k = 0; k < 8; k++) hat(c, drums, t0 + (k + (k % 2 ? 0.16 : 0)) * (beat / 2), N, k % 2 ? 0.06 : 0.1)
    }
    // vinyl crackle
    const crackle = c.createBufferSource()
    const cb = c.createBuffer(1, c.length, c.sampleRate)
    const d = cb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.25 : 0
    crackle.buffer = cb
    crackle.connect(tape)
    crackle.start(0)
  } else if (id === 'ambient') {
    const prog = [
      [48, 55, 59, 64, 67],
      [45, 52, 55, 60, 64],
      [41, 48, 52, 57, 60],
      [43, 50, 55, 59, 64]
    ]
    for (let b = 0; b < bars; b += 2) {
      const ch = prog[(b / 2) % 4]
      pad(c, bus, ch, b * bar, bar * 2, 0.045)
      for (let k = 0; k < 8; k++) {
        if (Math.random() < 0.55) {
          const m = ch[Math.floor(Math.random() * ch.length)] + 24
          tone(c, bus, { f: mtof(m), t: b * bar + k * beat + Math.random() * 0.1, d: 1.8, gain: 0.07 })
        }
      }
    }
  } else if (id === 'upbeat') {
    const prog = [
      [60, 64, 67],
      [55, 59, 62],
      [57, 60, 64],
      [53, 57, 60]
    ]
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar
      const ch = prog[b % 4]
      for (let k = 0; k < 8; k++) {
        const t = t0 + k * (beat / 2)
        if (k % 2) for (const m of ch) pluck(c, bus, m + 12, t, 0.07)
        tone(c, bus, { type: 'triangle', f: mtof(ch[0] - 24), t, a: 0.005, d: beat * 0.4, gain: 0.32 })
        hat(c, drums, t + beat / 4, N, 0.1)
      }
      for (let k = 0; k < 4; k++) kick(c, drums, t0 + k * beat, 0.9)
      clap(c, drums, t0 + beat, N)
      clap(c, drums, t0 + beat * 3, N)
    }
  } else {
    // product / corporate: piano arpeggios over a soft pad
    const prog = [
      [60, 64, 67, 72],
      [59, 62, 67, 71],
      [57, 60, 64, 69],
      [53, 57, 60, 65]
    ]
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar
      const ch = prog[b % 4]
      pad(c, bus, ch.slice(0, 3), t0, bar, 0.018)
      for (let k = 0; k < 8; k++) {
        const m = ch[[0, 1, 2, 3, 2, 1, 2, 3][k]] + 12
        tone(c, bus, { f: mtof(m), t: t0 + k * (beat / 2), a: 0.004, d: 0.6, gain: 0.11 })
        tone(c, bus, { f: mtof(m) * 2, t: t0 + k * (beat / 2), a: 0.002, d: 0.2, gain: 0.025 })
      }
      tone(c, bus, { type: 'triangle', f: mtof(ch[0] - 24), t: t0, a: 0.01, d: bar * 0.9, gain: 0.3 })
      kick(c, drums, t0, 0.6)
      kick(c, drums, t0 + beat * 2, 0.6)
      for (let k = 0; k < 16; k++) hat(c, drums, t0 + k * (beat / 4), N, k % 4 === 2 ? 0.07 : 0.035, 0.03)
    }
  }
}

const presetCache = new Map<string, Promise<AudioBuffer>>()

/** Render a built-in sound (cached). Music loops wrap their tail onto the start so they repeat seamlessly. */
export function renderPreset(id: string, sampleRate = 48000): Promise<AudioBuffer> {
  const key = `${id}@${sampleRate}`
  let p = presetCache.get(key)
  if (p) return p
  p = (async () => {
    const music = MUSIC_PRESETS.find((m) => m.id === id)
    if (music) {
      const bars = 8
      const tail = 3
      const len = Math.ceil(music.duration * sampleRate)
      const c = new OfflineAudioContext(2, len + tail * sampleRate, sampleRate)
      synthMusic(id, c, bars)
      const full = await c.startRendering()
      const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate })
      for (let ch = 0; ch < 2; ch++) {
        const src = full.getChannelData(ch)
        const dst = out.getChannelData(ch)
        dst.set(src.subarray(0, len))
        for (let i = 0; i < tail * sampleRate && len + i < src.length; i++) dst[i] += src[len + i]
      }
      return out
    }
    const sfx = SFX_PRESETS.find((s) => s.id === id)
    const dur = (sfx?.duration ?? 1) + 0.6
    const c = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate)
    synthSfx(id, c)
    return c.startRendering()
  })()
  p.catch(() => presetCache.delete(key))
  presetCache.set(key, p)
  return p
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export const soundKey = (s: SoundSource): string => (s.type === 'preset' ? `preset:${s.id}` : `file:${s.file}`)

const fileCache = new Map<string, Promise<AudioBuffer>>()
let decoder: OfflineAudioContext | null = null

export async function decodeUrl(url: string): Promise<AudioBuffer> {
  let p = fileCache.get(url)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Couldn’t read the audio file (${res.status})`)
      const data = await res.arrayBuffer()
      decoder ??= new OfflineAudioContext(2, 1, 48000)
      return decoder.decodeAudioData(data)
    })()
    p.catch(() => fileCache.delete(url))
    fileCache.set(url, p)
  }
  return p
}

export function loadSound(projectId: string, src: SoundSource): Promise<AudioBuffer> {
  return src.type === 'preset' ? renderPreset(src.id) : decodeUrl(mediaUrl(projectId, src.file))
}

export async function loadSounds(projectId: string, items: SoundItem[]): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>()
  await Promise.all(
    items.map(async (it) => {
      const k = soundKey(it.source)
      if (out.has(k)) return
      try {
        out.set(k, await loadSound(projectId, it.source))
      } catch (err) {
        console.warn('[sounds] could not load', k, err)
      }
    })
  )
  return out
}

// ---------------------------------------------------------------------------
// ducking: music dips while you're talking
// ---------------------------------------------------------------------------

/** Per-bucket music gain (1 = full) from the recording's waveform peaks (30/s, source time). */
export function duckCurve(
  peaks: Float32Array | null,
  amount: number,
  perSecond = 30,
  /** voice-over stretches (recording time) count as talking too */
  voice: [number, number][] = [],
  duration = 0
): Float32Array | null {
  if (amount <= 0 || (!peaks && !voice.length)) return null
  const n = peaks?.length ?? Math.ceil(duration * perSecond)
  const out = new Float32Array(n)
  const inVoice = (i: number): boolean => voice.some(([a, b]) => i / perSecond >= a - 0.1 && i / perSecond < b + 0.2)
  const look = Math.round(perSecond * 0.15)
  let g = 1
  for (let i = 0; i < n; i++) {
    let talk = inVoice(i)
    for (let k = Math.max(0, i - look); !talk && peaks && k <= Math.min(n - 1, i + look * 2); k++) {
      if (peaks[k] > 0.32) {
        talk = true
        break
      }
    }
    const target = talk ? 1 - amount : 1
    // dip fast, recover slowly
    g += (target - g) * (target < g ? 0.45 : 0.06)
    out[i] = g
  }
  return out
}

export function duckAt(curve: Float32Array | null, tSrc: number, perSecond = 30): number {
  if (!curve) return 1
  const i = Math.min(curve.length - 1, Math.max(0, Math.floor(tSrc * perSecond)))
  return curve[i]
}

// ---------------------------------------------------------------------------
// scheduling (shared by the live preview and the export)
// ---------------------------------------------------------------------------

export interface SoundBus {
  music: AudioNode
  sfx: AudioNode
}

const inClip = (t: number, clips: Clip[]): boolean => clips.some((c) => t >= c.start - 1e-6 && t < c.end)

/**
 * Schedule every sound that overlaps output time [from, to) on `ctx`, where output time `from`
 * happens at context time `at`. Output time is the edited timeline with cuts removed, so music
 * keeps flowing across a cut instead of jumping.
 */
export function scheduleSounds(
  ctx: BaseAudioContext,
  items: SoundItem[],
  buffers: Map<string, AudioBuffer>,
  clips: Clip[],
  from: number,
  to: number,
  at: number,
  rate: number,
  bus: SoundBus
): AudioScheduledSourceNode[] {
  const nodes: AudioScheduledSourceNode[] = []
  const T = (o: number): number => at + (o - from) / rate
  for (const it of items) {
    const buf = buffers.get(soundKey(it.source))
    if (!buf) continue
    if (it.kind === 'sfx' && !inClip(it.start, clips)) continue // the moment it was placed on was cut
    const oS = toOutput(it.start, clips)
    const oE = toOutput(it.end, clips)
    const s = Math.max(oS, from)
    const e = Math.min(oE, to)
    if (e - s < 0.005) continue
    let pos = it.offset + (s - oS)
    if (!it.loop && pos >= buf.duration) continue
    if (it.loop) pos %= buf.duration
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    if (it.loop) {
      src.loop = true
      src.loopStart = 0
      src.loopEnd = buf.duration
    }
    const g = ctx.createGain()
    const gainAt = (o: number): number => {
      let v = it.volume
      if (it.fadeIn > 0) v *= Math.min(1, Math.max(0, (o - oS) / it.fadeIn))
      if (it.fadeOut > 0) v *= Math.min(1, Math.max(0, (oE - o) / it.fadeOut))
      return v
    }
    g.gain.setValueAtTime(gainAt(s), T(s))
    const points = [oS + it.fadeIn, oE - it.fadeOut, e].filter((p) => p > s && p <= e).sort((a, b) => a - b)
    for (const p of points) g.gain.linearRampToValueAtTime(gainAt(p), T(p))
    // music ducks; effects and voice-overs don't
    src.connect(g).connect(it.kind === 'music' ? bus.music : bus.sfx)
    src.start(T(s), pos)
    src.stop(T(e))
    nodes.push(src)
  }
  return nodes
}

/** Total output length of a timeline (for scheduling "to the end"). */
export const outputEnd = (clips: Clip[]): number => totalLength(clips)

// ---------------------------------------------------------------------------
// live preview
// ---------------------------------------------------------------------------

export class SoundPlayer {
  private ctx: AudioContext | null = null
  private bus: { music: GainNode; sfx: GainNode } | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private buffers = new Map<string, AudioBuffer>()
  private loading = new Set<string>()
  private playing = false
  private sig = ''
  private lastOut = 0
  private lastWall = 0
  private dirty = false

  constructor(private projectId: string) {}

  private ensure(): { ctx: AudioContext; bus: { music: GainNode; sfx: GainNode } } {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      const music = this.ctx.createGain()
      const sfx = this.ctx.createGain()
      music.connect(this.ctx.destination)
      sfx.connect(this.ctx.destination)
      this.bus = { music, sfx }
    }
    return { ctx: this.ctx, bus: this.bus! }
  }

  private load(items: SoundItem[]): void {
    for (const it of items) {
      const k = soundKey(it.source)
      if (this.buffers.has(k) || this.loading.has(k)) continue
      this.loading.add(k)
      loadSound(this.projectId, it.source)
        .then((b) => {
          this.buffers.set(k, b)
          this.dirty = true
        })
        .catch((err) => console.warn('[sounds] load failed', k, err))
        .finally(() => this.loading.delete(k))
    }
  }

  private stopAll(): void {
    for (const n of this.nodes) {
      try {
        n.stop()
      } catch {
        /* already stopped */
      }
      n.disconnect()
    }
    this.nodes = []
  }

  /** Call every frame with the video's state. */
  update(
    t: number,
    playing: boolean,
    items: SoundItem[],
    clips: Clip[],
    rate: number,
    duck: Float32Array | null
  ): void {
    if (!items.length && !this.nodes.length) {
      this.playing = playing
      return
    }
    this.load(items)
    if (!playing) {
      if (this.playing) this.stopAll()
      this.playing = false
      return
    }
    const { ctx, bus } = this.ensure()
    if (ctx.state === 'suspended') void ctx.resume()
    const out = toOutput(t, clips)
    const now = performance.now()
    const sig = JSON.stringify([items, clips, rate])
    const expected = this.lastOut + ((now - this.lastWall) / 1000) * rate
    const jumped = Math.abs(out - expected) > 0.25
    if (!this.playing || jumped || sig !== this.sig || this.dirty) {
      this.stopAll()
      this.nodes = scheduleSounds(
        ctx,
        items,
        this.buffers,
        clips,
        out,
        outputEnd(clips),
        ctx.currentTime + 0.03,
        rate,
        bus
      )
      this.sig = sig
      this.dirty = false
    }
    this.playing = true
    this.lastOut = out
    this.lastWall = now
    bus.music.gain.setTargetAtTime(duckAt(duck, t), ctx.currentTime, 0.06)
  }

  close(): void {
    this.stopAll()
    void this.ctx?.close()
    this.ctx = null
  }
}

/** One-shot audition for the sound pickers. */
let auditionCtx: AudioContext | null = null
let auditionNode: AudioBufferSourceNode | null = null
export async function audition(buf: AudioBuffer, maxSeconds = 8): Promise<void> {
  stopAudition()
  auditionCtx ??= new AudioContext()
  if (auditionCtx.state === 'suspended') await auditionCtx.resume()
  const src = auditionCtx.createBufferSource()
  src.buffer = buf
  const g = auditionCtx.createGain()
  const t = auditionCtx.currentTime
  const len = Math.min(buf.duration, maxSeconds)
  g.gain.setValueAtTime(0.9, t)
  g.gain.setValueAtTime(0.9, t + Math.max(0, len - 0.4))
  g.gain.linearRampToValueAtTime(0, t + len)
  src.connect(g).connect(auditionCtx.destination)
  src.start(t)
  src.stop(t + len)
  auditionNode = src
}
export function stopAudition(): void {
  try {
    auditionNode?.stop()
  } catch {
    /* ignore */
  }
  auditionNode = null
}

// ---------------------------------------------------------------------------
// export: render the added sounds for a stretch of output time
// ---------------------------------------------------------------------------

export async function renderSoundsChunk(
  items: SoundItem[],
  buffers: Map<string, AudioBuffer>,
  clips: Clip[],
  from: number,
  seconds: number,
  sampleRate: number,
  duck: Float32Array | null
): Promise<AudioBuffer> {
  const len = Math.max(1, Math.round(seconds * sampleRate))
  const c = new OfflineAudioContext(2, len, sampleRate)
  const music = c.createGain()
  const sfx = c.createGain()
  music.connect(c.destination)
  sfx.connect(c.destination)
  if (duck) {
    // sample the duck curve along output time (maps back to recording time through the cuts)
    const steps = Math.max(2, Math.ceil(seconds * 50))
    const curve = new Float32Array(steps)
    for (let k = 0; k < steps; k++) curve[k] = duckAt(duck, toSource(from + (k / (steps - 1)) * seconds, clips))
    music.gain.setValueCurveAtTime(curve, 0, seconds)
  }
  scheduleSounds(c, items, buffers, clips, from, from + seconds, 0, 1, { music, sfx })
  return c.startRendering()
}
