/* 由 vite.config.ts 在构建时生成 sw.js，请勿直接修改生成结果 */
const VERSION = '__VERSION__'
const CACHE = 'tingshu-' + VERSION
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
      .filter(key => key.startsWith('tingshu-') && key !== CACHE)
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
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request).then(response => {
      if (response.ok && /\/(pdfjs|tesseract)\//.test(url.pathname)) {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, copy))
      }
      return response
    })))
})
