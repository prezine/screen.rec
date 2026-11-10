// Toom brand marks (artwork in assets/brand).
import iconUrl from '@renderer/assets/brand/toom-icon.svg'
import wordmarkUrl from '@renderer/assets/brand/toom-wordmark.svg'

/** app icon: white mark on the green → amber gradient */
export function AppIcon({ size = 64, className = '' }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt="Toom"
      draggable={false}
      className={className}
      style={{
        borderRadius: size * 0.077,
        boxShadow: `0 ${size * 0.2}px ${size * 0.5}px -${size * 0.18}px rgba(150, 170, 30, 0.75)`
      }}
    />
  )
}

/** "TOOM" wordmark in the brand gradient (reads on light and dark) */
export function Wordmark({ height = 18, className = '' }: { height?: number; className?: string }): React.JSX.Element {
  return <img src={wordmarkUrl} alt="Toom" draggable={false} className={className} style={{ height, width: 'auto' }} />
}
