import type { StreamTargetChunk } from 'mediabunny'
import { api } from './api'

/** A WritableStream for mediabunny's StreamTarget that writes positionally to a file via the main process. */
export function ipcWritable(handle: number): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      await api.file.write(handle, chunk.position, chunk.data)
    }
  })
}
