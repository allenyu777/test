import { render } from 'preact'
import './polyfills'
import './styles.css'
import { App } from './app'
import { requestPersistence } from './db'
import { refreshLibrary } from './library'
import { ocrRunner } from './ocr/runner'
import { toast } from './ui/toast'

let notifyUpdate: ((apply: () => void) => void) | null = null
let pendingUpdate: (() => void) | null = null
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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return
    updateRequested = false
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

refreshLibrary()
  // 继续之前没识别完的扫描版 PDF
  .then(() => ocrRunner.resumeAll())
  .catch(e => {
    console.error(e)
    toast('无法打开本地数据库：' + (e instanceof Error ? e.message : String(e)), 'error', { duration: 0 })
  })
registerServiceWorker()
// 旧版本用 Tesseract 识别文字时缓存在本机的识别数据（现在改用 PaddleOCR），删掉腾出空间
try {
  indexedDB.deleteDatabase('keyval-store')
} catch {
  // 浏览器不允许时忽略
}
// 已添加到主屏幕时申请持久化存储
if (window.matchMedia?.('(display-mode: standalone)').matches) requestPersistence()
