export const api = window.api

/** URL for a file inside a project folder, served by the main process (supports range requests). */
// Overridable so the media pipeline can be exercised in a plain browser (see test/pipeline).
const MEDIA_BASE: string = (globalThis as { __MEDIA_BASE__?: string }).__MEDIA_BASE__ ?? 'media://p'

export function mediaUrl(projectId: string, file: string, bust?: number | string): string {
  const q = bust !== undefined ? `?v=${encodeURIComponent(String(bust))}` : ''
  return `${MEDIA_BASE}/${encodeURIComponent(projectId)}/${encodeURIComponent(file)}${q}`
}
