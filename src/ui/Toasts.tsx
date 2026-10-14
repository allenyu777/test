import { useStore } from '../store'
import { dismissToast, toasts } from './toast'

export function Toasts() {
  const items = useStore(toasts, s => s.items)
  return (
    <div class="toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.id} class={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={e => {
                e.stopPropagation()
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
