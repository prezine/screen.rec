import { ALL_FORMATS, Conversion, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource } from 'mediabunny'
import { api, mediaUrl } from '@renderer/lib/api'
import { ipcWritable } from '@renderer/lib/ipcWritable'

export interface ProbeResult {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export async function probe(url: string): Promise<ProbeResult> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    return {
      duration: await input.computeDuration(),
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      hasAudio: !!audio
    }
  } finally {
    input.dispose()
  }
}

/**
 * MediaRecorder output (WebM without cues/duration) is awkward to seek. Remux it into a
 * regular MP4 — packets are copied, not re-encoded, so this is fast.
 */
export async function remuxToMp4(
  projectId: string,
  srcName: string,
  dstName: string,
  onProgress?: (p: number) => void
): Promise<void> {
  const input = new Input({ source: new UrlSource(mediaUrl(projectId, srcName)), formats: ALL_FORMATS })
  const handle = await api.file.open({ projectId, name: dstName })
  try {
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(ipcWritable(handle), { chunked: true, chunkSize: 4 * 1024 * 1024 })
    })
    const conversion = await Conversion.init({ input, output })
    if (!conversion.isValid) {
      throw new Error(
        `Cannot convert recording: ${conversion.discardedTracks.map((d) => d.reason).join(', ') || 'unknown reason'}`
      )
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(p)
    await conversion.execute()
  } finally {
    await api.file.close(handle)
    input.dispose()
  }
}
