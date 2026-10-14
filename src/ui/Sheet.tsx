import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { IconClose } from './icons'

interface SheetProps {
  title: ComponentChildren
  onClose: () => void
  children: ComponentChildren
  footer?: ComponentChildren
  actions?: ComponentChildren
  class?: string
}

let openCount = 0

/** 底部弹出面板，可下拉关闭 */
export function Sheet({ title, onClose, children, footer, actions, class: cls }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    openCount++
    document.documentElement.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      openCount--
      if (!openCount) document.documentElement.style.overflow = ''
    }
  }, [])

  const onTouchStart = (e: TouchEvent) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !sheetRef.current) return
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    drag.current.dy = dy
    sheetRef.current.style.transform = `translateY(${dy}px)`
    sheetRef.current.style.transition = 'none'
  }
  const onTouchEnd = () => {
    const el = sheetRef.current
    if (!drag.current || !el) return
    const { dy } = drag.current
    drag.current = null
    el.style.transition = 'transform 0.2s'
    if (dy > 90) {
      el.style.transform = 'translateY(100%)'
      setTimeout(() => closeRef.current(), 180)
    } else el.style.transform = ''
  }

  return (
    <>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class={`sheet ${cls ?? ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div class="sheet-handle" />
          <div class="sheet-header">
            <h3>{title}</h3>
            {actions}
            <button class="icon-btn" onClick={onClose} aria-label="关闭">
              <IconClose />
            </button>
          </div>
        </div>
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-footer">{footer}</div>}
      </div>
    </>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      class={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  )
}
