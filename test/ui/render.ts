// Renders compositor frames directly (layouts, transitions, glass click, cursor styles) for visual checks.
import { defaultEditState } from '@shared/defaults'
import type { CameraLayout, CursorData, EditState } from '@shared/types'
import { renderFrame } from '@renderer/engine/compositor'
import { SceneBuilder } from '@renderer/engine/scene'

declare global {
  interface Window {
    renderAll: () => Promise<Record<string, string>>
  }
}

async function img(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob())
}

/** Person mask from the synthetic camera colours (stand-in for the segmenter). */
function fakeMask(cam: ImageBitmap): OffscreenCanvas {
  const c = new OffscreenCanvas(cam.width, cam.height)
  const x = c.getContext('2d')!
  x.drawImage(cam, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height)
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, g, b] = [d.data[i], d.data[i + 1], d.data[i + 2]]
    const skin = r > 190 && g > 150 && b > 120 && r - b > 50
    const shirt = b > 70 && b < 110 && r < 60
    d.data[i + 3] = skin || shirt ? 255 : 0
  }
  x.putImageData(d, 0, 0)
  return c
}

window.renderAll = async () => {
  const base = `${location.origin}/p/demo`
  const screen = await img(`${base}/desk.png`)
  const cam = await img(`${base}/cam.png`)
  const mask = fakeMask(cam)
  const cursor: CursorData = {
    tracked: true,
    samples: Array.from(
      { length: 300 },
      (_, i) => [i / 60, 0.3 + 0.4 * (i / 300), 0.35 + 0.1 * Math.sin(i / 30)] as [number, number, number]
    ),
    clicks: [{ t: 2.0, x: 0.42, y: 0.38, button: 'left' }]
  }
  const W = 960
  const H = 540
  const out: Record<string, string> = {}
  const words = 'So here is our payments dashboard. Let me open the invoice page and send it.'
    .split(' ')
    .map((text, i) => ({ text: ` ${text}`, start: 0.3 + i * 0.32, end: 0.3 + i * 0.32 + 0.26 }))
  cursor.keys = [
    { t: 1.4, key: 'K', mods: ['meta'] },
    { t: 4.0, key: 'Z', mods: ['meta', 'shift'] }
  ]
  const shot = async (name: string, edit: EditState, t: number): Promise<void> => {
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d')!
    const scene = new SceneBuilder(cursor, 5, true).setWords(words).build(edit, screen.width, screen.height, null)
    renderFrame(ctx, W, H, scene, {
      t,
      screen,
      screenSize: { w: screen.width, h: screen.height },
      camera: cam,
      cameraSize: { w: cam.width, h: cam.height },
      cameraMask: { source: mask, w: mask.width, h: mask.height },
      shutter: 1 / 120
    })
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    out[name] = await new Promise((r) => {
      const fr = new FileReader()
      fr.onload = () => r(fr.result as string)
      fr.readAsDataURL(blob)
    })
  }
  const edit = (layout: CameraLayout): EditState => {
    const e = defaultEditState(5, true)
    e.camera.layout = layout
    e.cursor.overlay = true
    return e
  }
  for (const l of ['overlay', 'split', 'camera', 'cutout', 'screen'] as CameraLayout[])
    await shot(`layout-${l}`, edit(l), 1)
  // mid-transition: overlay → fullscreen camera
  const tr = edit('overlay')
  tr.layouts = [{ id: 'x', start: 1, end: 4, layout: 'split' }]
  await shot('transition', tr, 1.2)
  // glass click on a zoomed shot
  const g = edit('screen')
  g.cursor.clickEffect = 'glass'
  g.zooms = [{ id: 'z', start: 0, end: 5, scale: 1.8, auto: false }]
  for (const [n, tt] of [
    ['glass-a', 2.06],
    ['glass', 2.18],
    ['glass-c', 2.42]
  ] as const)
    await shot(n, g, tt)
  // cursor styles + cursor motion blur
  for (const st of ['arrow', 'arrow-light', 'dot', 'ring'] as const) {
    const c = edit('screen')
    c.cursor.style = st
    c.cursor.size = 2.2
    c.motionBlur.cursor = 1
    c.zooms = [{ id: 'z', start: 0, end: 5, scale: 2.4, auto: false }]
    await shot(`cursor-${st}`, c, 3)
  }
  // privacy masks, zoomed
  for (const st of ['blur', 'pixelate', 'solid'] as const) {
    const m = edit('screen')
    m.zooms = [{ id: 'z', start: 0, end: 5, scale: 1.5, auto: false }]
    m.masks = [{ id: 'm', start: 0, end: 5, rect: { x: 0.45, y: 0.12, w: 0.3, h: 0.16 }, style: st, strength: 0.6 }]
    await shot(`mask-${st}`, m, 2.5)
  }
  // captions in every style (with keycaps showing ⌘K)
  for (const st of ['karaoke', 'bold', 'box', 'glass', 'clean'] as const) {
    const c = edit('overlay')
    c.captions = { ...c.captions, enabled: true, style: st, highlight: st === 'bold' ? '#facc15' : '#8f80ff' }
    c.keystrokes = { ...c.keystrokes, style: st === 'box' ? 'light' : 'dark' }
    await shot(`captions-${st}`, c, 1.5)
  }
  // face tracking: the fake camera's face sits right of centre; tracking re-centres the crop
  for (const on of [false, true]) {
    const f = edit('split')
    f.camera.faceTracking = on
    f.camera.faceZoom = 1.6
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d')!
    const scene = new SceneBuilder(cursor, 5, true)
      .setFaceTrack(
        {
          version: 1,
          samples: [
            [0, 0.62, 0.42, 0.3],
            [5, 0.62, 0.42, 0.3]
          ]
        },
        0
      )
      .build(f, screen.width, screen.height, null)
    renderFrame(ctx, W, H, scene, {
      t: 1,
      screen,
      screenSize: { w: screen.width, h: screen.height },
      camera: cam,
      cameraSize: { w: cam.width, h: cam.height }
    })
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    out[`face-${on ? 'on' : 'off'}`] = await new Promise((r) => {
      const fr = new FileReader()
      fr.onload = () => r(fr.result as string)
      fr.readAsDataURL(blob)
    })
  }
  return out
}
