/** Background library + Unsplash shapes shared by main and renderer. */

export interface Credit {
  name: string
  url: string
  source: string
}

export interface LibraryImage {
  file: string
  credit?: Credit
  addedAt: number
}

/** A music track or sound effect you uploaded (kept in the app's sound library). */
export interface LibrarySound {
  id: string
  file: string
  name: string
  kind: 'music' | 'sfx' | 'voice'
  addedAt: number
}

export interface UnsplashPhoto {
  id: string
  thumb: string
  small: string
  raw: string
  color: string
  width: number
  height: number
  alt: string
  author: string
  authorUrl: string
  downloadLocation: string
}
