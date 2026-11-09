import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, RotateCcw } from '@renderer/lib/icons'

export { clsx as cx }

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type BtnVariant = 'ghost' | 'subtle' | 'primary' | 'danger'

export function Button({
  variant = 'subtle',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  return (
    <button
      {...rest}
      className={clsx(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-10 px-4 text-sm',
        variant === 'ghost' && 'text-ink-200 hover:bg-white/[0.06] hover:text-white',
        variant === 'subtle' && 'bg-white/[0.06] text-ink-100 ring-1 ring-white/[0.07] hover:bg-white/[0.1]',
        variant === 'primary' &&
          'bg-gradient-to-b from-brand-400 to-brand-600 text-[#fff] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.2),0_10px_28px_-8px_rgba(109,92,255,0.85)] hover:brightness-110',
        variant === 'danger' && 'text-red-400 hover:bg-red-500/10',
        className
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  active,
  className,
  children,
  tooltipSide = 'bottom',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  tooltipSide?: 'bottom' | 'top' | 'left' | 'right'
}): React.JSX.Element {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <button
        aria-label={label}
        {...rest}
        className={clsx(
          'no-drag grid size-9 place-items-center rounded-lg text-ink-200 transition-colors hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30',
          active && 'bg-brand-500/15 text-brand-300 hover:bg-brand-500/20 hover:text-brand-300',
          className
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Tooltip (CSS only)
// ---------------------------------------------------------------------------

export function Tooltip({
  label,
  side = 'bottom',
  children
}: {
  label: string
  side?: 'bottom' | 'top' | 'left' | 'right'
  children: ReactNode
}): React.JSX.Element {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-50 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-ink-950 opacity-0 shadow-lg transition-opacity delay-300 group-hover/tt:opacity-100',
          side === 'bottom' && 'top-full left-1/2 mt-2 -translate-x-1/2',
          side === 'top' && 'bottom-full left-1/2 mb-2 -translate-x-1/2',
          side === 'right' && 'top-1/2 left-full ml-2 -translate-y-1/2',
          side === 'left' && 'top-1/2 right-full mr-2 -translate-y-1/2'
        )}
      >
        {label}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

export function Dropdown({
  trigger,
  children,
  align = 'left',
  width = 220,
  open: controlledOpen,
  onOpenChange,
  side = 'bottom'
}: {
  /** open below (default) or above the trigger */
  side?: 'top' | 'bottom'
  trigger: (open: boolean) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  width?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (v: boolean): void => {
    setInnerOpen(v)
    onOpenChange?.(v)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  })
  const close = (): void => setOpen(false)
  return (
    <div ref={ref} className="no-drag relative">
      <div onClick={() => setOpen(!open)}>{trigger(open)}</div>
      {open && (
        <div
          style={{ width }}
          className={clsx(
            'glass-strong absolute z-40 rounded-2xl p-1.5',
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            align === 'left' ? 'left-0' : 'right-0'
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  right,
  className
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  right?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink-100 hover:bg-white/[0.07]',
        active && 'text-brand-300',
        className
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      {right}
    </button>
  )
}

export function SelectButton({
  icon,
  label,
  value,
  open
}: {
  icon?: ReactNode
  label?: string
  value: string
  open: boolean
}): React.JSX.Element {
  return (
    <button
      className={clsx(
        'no-drag flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-100 transition-colors hover:bg-white/[0.06]',
        open && 'bg-white/[0.06]'
      )}
    >
      {icon}
      {label && <span>{label}</span>}
      <span className={label ? 'text-ink-400' : ''}>{value}</span>
      <ChevronDown size={14} className={clsx('text-ink-400 transition-transform', open && 'rotate-180')} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Section({
  title,
  children,
  action
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <section className="border-b border-white/[0.06] px-5 py-5 last:border-b-0">
      <div className="mb-3.5 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink-100">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Field({
  label,
  children,
  hint
}: {
  label?: string
  children: ReactNode
  hint?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      {label && <div className="mb-2 text-xs text-ink-300">{label}</div>}
      {children}
      {hint && <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{hint}</p>}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  defaultValue,
  onChange,
  neutral
}: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  defaultValue?: number
  onChange: (v: number) => void
  neutral?: boolean
}): React.JSX.Element {
  const fill = ((value - min) / (max - min)) * 100
  const canReset = defaultValue !== undefined && Math.abs(value - defaultValue) > step / 2
  return (
    <div className="mb-4 last:mb-0">
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-ink-300">{label}</span>
          <span className="flex items-center gap-2">
            {canReset && (
              <button
                onClick={() => onChange(defaultValue!)}
                className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100"
                title="Reset"
              >
                <RotateCcw size={11} /> Reset
              </button>
            )}
            <span className="min-w-9 text-right tabular-nums text-ink-200">{format ? format(value) : value}</span>
          </span>
        </div>
      )}
      <input
        type="range"
        className={clsx('range', neutral && 'neutral')}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <div className="flex gap-1 rounded-xl bg-black/25 p-1 ring-1 ring-white/[0.06]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
            size === 'md' ? 'h-8 text-[13px]' : 'h-7 text-xs',
            value === o.value ? 'glass-chip text-white' : 'text-ink-300 hover:text-ink-100'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pills<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // keep the selected pill in view
    const active = el.querySelector<HTMLElement>('[data-active="true"]')
    if (active) {
      const l = active.offsetLeft - 8
      const r = active.offsetLeft + active.offsetWidth + 8
      if (l < el.scrollLeft) el.scrollTo({ left: l, behavior: 'smooth' })
      else if (r > el.scrollLeft + el.clientWidth) el.scrollTo({ left: r - el.clientWidth, behavior: 'smooth' })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value, measure])
  const mask =
    edges.left || edges.right
      ? `linear-gradient(90deg, ${edges.left ? 'transparent 0, #000 28px' : '#000 0'}, ${edges.right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`
      : undefined
  return (
    <div
      ref={ref}
      onScroll={measure}
      onWheel={(e) => {
        // vertical wheels scroll the strip sideways
        if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY
      }}
      className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-9 shrink-0 rounded-xl px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === o.value
              ? 'glass-chip text-white'
              : 'bg-white/[0.04] text-ink-200 ring-1 ring-white/[0.05] hover:bg-white/[0.08]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  disabled
}: {
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-brand-500' : 'bg-ink-600'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fff] shadow transition-transform',
          on && 'translate-x-4'
        )}
      />
    </button>
  )
}

export function ToggleRow({
  label,
  hint,
  on,
  onChange,
  disabled
}: {
  label: string
  hint?: ReactNode
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-100">{label}</span>
        <Toggle on={on} onChange={onChange} disabled={disabled} />
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">{hint}</p>}
    </div>
  )
}

export function Swatch({
  background,
  selected,
  onClick,
  title,
  className
}: {
  background: string
  selected: boolean
  onClick: () => void
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ background }}
      className={clsx(
        'aspect-square rounded-[10px] ring-offset-2 ring-offset-ink-850 transition-[box-shadow,transform] hover:scale-[1.04]',
        selected ? 'ring-2 ring-white' : 'ring-1 ring-white/10',
        className
      )}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-ink-700 px-1.5 font-sans text-[11px] font-medium text-ink-200 ring-1 ring-white/10">
      {children}
    </kbd>
  )
}
