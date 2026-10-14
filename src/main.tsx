import { render } from 'preact'
import './polyfills'
import './styles.css'
import { App } from './app'
import { requestPersistence } from './db'
import { refreshLibrary } from './library'
import { toast } from './ui/toast'

let notifyUpdate: ((apply: () => void) => void) | null = null
let pendingUpdate: (() => void) | null = null

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker
    .register('./sw.js')
    .then(reg => {
      const offer = (worker: ServiceWorker | null) => {
        if (!worker || !navigator.serviceWorker.controller) return
        const apply = () => worker.postMessage('skipWaiting')
        if (notifyUpdate) notifyUpdate(apply)
        else pendingUpdate = apply
      }
      if (reg.waiting) offer(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offer(worker)
        })
      })
      // 每次回到前台检查一次更新
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    })
    .catch(() => {})
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    location.reload()
  })
}

render(
  <App
    onUpdate={cb => {
      notifyUpdate = cb
      if (pendingUpdate) cb(pendingUpdate)
    }}
  />,
  document.getElementById('app')!,
)

refreshLibrary().catch(e => {
  console.error(e)
  toast('无法打开本地数据库：' + (e instanceof Error ? e.message : String(e)), 'error', { duration: 0 })
})
registerServiceWorker()
// 已添加到主屏幕时申请持久化存储
if (window.matchMedia?.('(display-mode: standalone)').matches) requestPersistence()
