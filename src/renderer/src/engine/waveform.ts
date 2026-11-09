import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny'

/**
 * Peak amplitude per bucket (0..1), `perSecond` buckets per second of audio.
 * Returns null when the file has no audio track.
 */
export async function computePeaks(url: string, duration: number, perSecond = 30): Promise<Float32Array | null> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const n = Math.max(1, Math.ceil(duration * perSecond))
    const peaks = new Float32Array(n)
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const ch0 = buffer.getChannelData(0)
      const sr = buffer.sampleRate
      const step = Math.max(1, Math.floor(sr / perSecond / 32)) // sub-sample for speed
      for (let i = 0; i < ch0.length; i += step) {
        const b = Math.floor((timestamp + i / sr) * perSecond)
        if (b < 0 || b >= n) continue
        const v = Math.abs(ch0[i])
        if (v > peaks[b]) peaks[b] = v
      }
    }
    // normalise with a gentle curve so quiet speech is still visible
    let max = 0
    for (const v of peaks) if (v > max) max = v
    if (max > 0) for (let i = 0; i < n; i++) peaks[i] = Math.sqrt(peaks[i] / max)
    return peaks
  } finally {
    input.dispose()
  }
}
