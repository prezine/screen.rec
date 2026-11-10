// Master artwork exported from the Toom brand kit (trytoom.tech/brand). The `gradient` tone is
// the colour version: Toom Green #0AFF68 (the files keep their old names).
import iconUrl from '@renderer/assets/brand/exports/app-icon-gradient.png'
import iconWhiteUrl from '@renderer/assets/brand/exports/app-icon-white.png'
import iconBlackUrl from '@renderer/assets/brand/exports/app-icon-black-on-white.png'
import markGradientUrl from '@renderer/assets/brand/exports/mark-gradient.png'
import markWhiteUrl from '@renderer/assets/brand/exports/mark-white.png'
import markBlackUrl from '@renderer/assets/brand/exports/mark-black.png'
import wordmarkGradientUrl from '@renderer/assets/brand/exports/wordmark-gradient.png'
import wordmarkWhiteUrl from '@renderer/assets/brand/exports/wordmark-white.png'
import wordmarkBlackUrl from '@renderer/assets/brand/exports/wordmark-black.png'

type Tone = 'gradient' | 'white' | 'black'

/** app icon: the green mark on a white tile */
export function AppIcon({ size = 64, tone = 'gradient', className = '' }: { size?: number; tone?: Tone; className?: string }): React.JSX.Element {
  const src = tone === 'white' ? iconWhiteUrl : tone === 'black' ? iconBlackUrl : iconUrl
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Toom"
      draggable={false}
      className={className}
      style={{
        // the colour tile has its corners drawn in (22.5%, like the macOS icon); others are square
        borderRadius: tone === 'white' ? 0 : tone === 'gradient' ? size * 0.225 : size * 0.077,
        boxShadow: tone === 'gradient' ? `0 ${size * 0.2}px ${size * 0.5}px -${size * 0.18}px rgba(10, 255, 104, 0.35)` : undefined
      }}
    />
  )
}

/** The Toom mark in the approved color for its background. */
export function BrandMark({ size = 20, tone = 'gradient', className = '' }: { size?: number; tone?: Tone; className?: string }): React.JSX.Element {
  const src = tone === 'white' ? markWhiteUrl : tone === 'black' ? markBlackUrl : markGradientUrl
  return <img src={src} width={size} height={size * (2285 / 2494)} alt="Toom" draggable={false} className={className} />
}

/** "TOOM" wordmark, with a white/black variant for contrasting surfaces. */
export function Wordmark({ height = 18, tone = 'gradient', className = '' }: { height?: number; tone?: Tone; className?: string }): React.JSX.Element {
  const src = tone === 'white' ? wordmarkWhiteUrl : tone === 'black' ? wordmarkBlackUrl : wordmarkGradientUrl
  return <img src={src} alt="Toom" draggable={false} className={className} style={{ height, width: 'auto' }} />
}
