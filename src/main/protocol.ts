import { protocol } from 'electron'
import { promises as fs, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { basename, extname, join } from 'node:path'
import { libraryDir } from './backgrounds'
import { soundsDir } from './sounds'
import { projectFile } from './projects'

export const MEDIA_SCHEME = 'media'

const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac'
}

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

/**
 * media://p/<projectId>/<file> → file inside the project folder; media://lib/<file> → background library.
 * Supports HTTP Range requests so <video> seeking and mediabunny's UrlSource work.
 */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      const parts = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/')
      let path: string
      if (url.host === 'lib') {
        // media://lib/<file> → shared background library
        path = join(libraryDir(), basename(parts.join('/')))
      } else if (url.host === 'snd') {
        // media://snd/<file> → your sound library
        path = join(soundsDir(), basename(parts.join('/')))
      } else {
        const [id, ...rest] = parts
        path = projectFile(id, rest.join('/'))
      }
      const stat = await fs.stat(path)
      const size = stat.size
      const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
      const baseHeaders = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
      const range = req.headers.get('range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        let start = m && m[1] ? parseInt(m[1], 10) : 0
        let end = m && m[2] ? parseInt(m[2], 10) : size - 1
        if (m && !m[1] && m[2]) {
          // suffix range: last N bytes
          start = Math.max(0, size - parseInt(m[2], 10))
          end = size - 1
        }
        end = Math.min(end, size - 1)
        if (start >= size || start > end) {
          return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } })
        }
        const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`
          }
        })
      }
      const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(stream, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(size) } })
    } catch (err) {
      return new Response(String(err), { status: 404 })
    }
  })
}
