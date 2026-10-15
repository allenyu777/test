/* 由 vite.config.ts 在构建时生成 sw.js，请勿直接修改生成结果 */
const VERSION = '__VERSION__'
const CACHE = 'tingshu-' + VERSION
// 按需下载的大文件（PDF 字形表、文字识别模型和运行文件）按类别单独缓存：应用更新时只要这一类文件没变就不用重新下载
const ASSET_CACHES = __ASSET_CACHES__
const ASSETS = __ASSETS__

self.addEventListener('install', event => {
  // 绕过浏览器 HTTP 缓存，避免把旧的 index.html 和新的资源文件存在一起
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith('tingshu-') && key !== CACHE && !Object.values(ASSET_CACHES).includes(key))
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // 只处理本站资源；朗读接口等跨域请求直接走网络
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./', { cacheName: CACHE }).then(cached => cached || fetch(request)))
    return
  }
  // 预缓存里有就直接用；没有的（PDF 字形表、文字识别文件）首次联网获取后缓存起来
  const path = url.pathname
  const group = /\/pdfjs\//.test(path) ? 'pdfjs' : /\/paddle\//.test(path) ? 'paddle' : /\/tesseract\//.test(path) ? 'tesseract' : path.endsWith('.wasm') ? 'wasm' : null
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request).then(response => {
      if (response.ok && group) {
        // 大文件要等整个下载完才能存进缓存，用 waitUntil 让 Service Worker 等它存完
        const copy = response.clone()
        event.waitUntil(caches.open(ASSET_CACHES[group]).then(cache => cache.put(request, copy)).catch(() => {}))
      }
      return response
    })))
})
