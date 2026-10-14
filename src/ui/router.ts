// 基于 hash 的简易路由：#/、#/book/<id>、#/settings
import { useEffect, useState } from 'preact/hooks'

export type Route = { name: 'library' } | { name: 'reader'; id: string } | { name: 'settings' }

export function parseHash(hash = location.hash): Route {
  const path = hash.replace(/^#\/?/, '')
  const [first, second] = path.split('/')
  if (first === 'book' && second) return { name: 'reader', id: decodeURIComponent(second) }
  if (first === 'settings') return { name: 'settings' }
  return { name: 'library' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(hash: string, replace = false) {
  if (replace) {
    history.replaceState(history.state, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    history.pushState({ app: true }, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

/** 返回上一页；如果是直接打开的深层链接，则回到书架 */
export function goBack() {
  if (history.state?.app) history.back()
  else navigate('#/', true)
}
