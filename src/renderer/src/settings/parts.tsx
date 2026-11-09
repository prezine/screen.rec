import type { ReactNode } from 'react'
import { cx } from '@renderer/lib/ui'

export function Group({
  title,
  children,
  footer
}: {
  title?: string
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-7">
      {title && <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{title}</h3>}
      <div className="glass-card divide-y divide-white/[0.06] rounded-[18px]">{children}</div>
      {footer && <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-400">{footer}</p>}
    </section>
  )
}

export function Item({
  label,
  desc,
  children,
  stack
}: {
  label: string
  desc?: ReactNode
  children: ReactNode
  stack?: boolean
}): React.JSX.Element {
  return (
    <div className={cx('px-4 py-3.5', stack ? 'space-y-3' : 'flex items-center justify-between gap-6')}>
      <div className="min-w-0">
        <div className="text-[13px] text-ink-100">{label}</div>
        {desc && <div className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{desc}</div>}
      </div>
      <div className={cx(stack ? '' : 'shrink-0')}>{children}</div>
    </div>
  )
}
