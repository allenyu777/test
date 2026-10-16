import { render } from 'preact'
import './polyfills'
import './styles.css'
import { App } from './app'
import { requestPersistence } from './db'
import { refreshLibrary } from './library'
import { ocrRunner } from './ocr/runner'
import { toast } from './ui/toast'
import { appUpdate } from './update'

// 只有用户点了"立即更新"才刷新页面（首次安装时 Service Worker 接管页面不应刷新）
let updateRequested = false

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker
    .register('./sw.js')
    .then(reg => {
      const offer = (worker: ServiceWorker | null) => {
        if (!worker || !navigator.serviceWorker.controller) return
        const apply = () => {
          updateRequested = true
          worker.postMessage('skipWaiting')
        }
        appUpdate.set({ apply })
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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return
    updateRequested = false
    location.reload()
  })
}

render(<App />, document.getElementById('app')!)

refreshLibrary()
  // 继续之前没识别完的扫描版 PDF
  .then(() => ocrRunner.resumeAll())
  .catch(e => {
    console.error(e)
    toast('无法打开本地数据库：' + (e instanceof Error ? e.message : String(e)), 'error', { duration: 0 })
  })
registerServiceWorker()
// 已添加到主屏幕时申请持久化存储
if (window.matchMedia?.('(display-mode: standalone)').matches) requestPersistence()
