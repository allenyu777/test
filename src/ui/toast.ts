import { createStore } from '../store'

export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
}

export const toasts = createStore<{ items: ToastItem[] }>({ items: [] })

let seq = 0

export function toast(text: string, kind: ToastItem['kind'] = 'info', options: { duration?: number; action?: ToastItem['action'] } = {}) {
  const id = ++seq
  toasts.set(s => ({ items: [...s.items.filter(t => t.text !== text), { id, text, kind, action: options.action }].slice(-3) }))
  const duration = options.duration ?? (kind === 'error' ? 5000 : 2600)
  if (duration > 0) setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id: number) {
  toasts.set(s => ({ items: s.items.filter(t => t.id !== id) }))
}
