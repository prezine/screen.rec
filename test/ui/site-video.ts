// Renders the demo project through the real compositor, frame by frame, for the website's hero video.
// The frames are exactly what Toom's exporter draws; the Node side encodes them with ffmpeg.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import type { CursorData, EditState } from '@shared/types'
import { framePlan, speedOf } from '@shared/clips'
import { outputSize, renderFrame } from '@renderer/engine/compositor'
import { SceneBuilder } from '@renderer/engine/scene'

declare global {
  interface Window {
    siteVideo: (opts: { shortSide: number; fps: number; edit?: Partial<EditState> }) => Promise<{ w: number; h: number; frames: number }>
    nextFrame: () => Promise<string | null>
  }
}

let next: (() => Promise<string | null>) | null = null

window.siteVideo = async ({ shortSide, fps, edit: patch }) => {
  const base = `${location.origin}/p/demo`
  const project = await (await fetch(`${base}/project.json`)).json()
  const cursor: CursorData = await (await fetch(`${base}/cursor.json`)).json()
  const words = (await (await fetch(`${base}/transcript.json`)).json()).words
  const edit: EditState = { ...project.edit, ...patch }
  const screenIn = new Input({ source: new UrlSource(`${base}/screen.webm`), formats: ALL_FORMATS })
  const camIn = new Input({ source: new UrlSource(`${base}/camera.webm`), formats: ALL_FORMATS })
  const screenTrack = (await screenIn.getPrimaryVideoTrack())!
  const camTrack = await camIn.getPrimaryVideoTrack()
  const srcW = screenTrack.displayWidth
  const srcH = screenTrack.displayHeight
  const { w: W, h: H } = outputSize(edit.aspect, srcW, srcH, shortSide)
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const scene = new SceneBuilder(cursor, project.duration, !!camTrack).setWords(words).build(edit, srcW, srcH, null)
  const plan = framePlan(edit.clips.length ? edit.clips : [{ id: 'all', start: 0, end: project.duration }], fps)
  const times: number[] = []
  for (const { clip, frames } of plan) for (let k = 0; k < frames; k++) times.push(clip.start + (k * speedOf(clip)) / fps)
  const sf = new VideoSampleSink(screenTrack).samplesAtTimestamps(times)
  const cf = camTrack ? new VideoSampleSink(camTrack).samplesAtTimestamps(times.map((t) => Math.max(0, t - project.cameraOffset))) : null
  let i = 0
  next = async () => {
    if (i >= times.length) return null
    const s = await sf.next()
    const c = cf ? await cf.next() : null
    const sample = s.done ? null : s.value
    const cam = c && !c.done ? c.value : null
    renderFrame(ctx, W, H, scene, {
      t: times[i],
      shutter: 1 / fps / 2,
      screen: sample ? sample.toCanvasImageSource() : null,
      screenSize: { w: srcW, h: srcH },
      camera: cam ? cam.toCanvasImageSource() : null,
      cameraSize: camTrack ? { w: camTrack.displayWidth, h: camTrack.displayHeight } : undefined
    })
    sample?.close()
    cam?.close()
    i++
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
    return btoa(bin)
  }
  return { w: W, h: H, frames: times.length }
}

window.nextFrame = () => next!()
