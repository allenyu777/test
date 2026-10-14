import { useEffect, useState } from 'preact/hooks'
import { settings } from './settings'
import { useStore } from './store'
import { Library } from './ui/Library'
import { Reader } from './ui/Reader'
import { useRoute } from './ui/router'
import { SettingsPage } from './ui/Settings'
import { Toasts } from './ui/Toasts'

const THEME_COLORS: Record<string, string> = {
  light: '#f7f5f0',
  sepia: '#f3e9d2',
  green: '#dcebd3',
  dark: '#121212',
}

function useTheme() {
  const theme = useStore(settings, s => s.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    metas.forEach(m => {
      if (theme === 'auto') {
        m.content = m.media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light
      } else m.content = THEME_COLORS[theme]
    })
  }, [theme])
}

export function App({ onUpdate }: { onUpdate: (cb: (apply: () => void) => void) => void }) {
  const route = useRoute()
  const [update, setUpdate] = useState<(() => void) | null>(null)
  useTheme()
  useEffect(() => onUpdate(apply => setUpdate(() => apply)), [])
  useEffect(() => {
    if (route.name !== 'reader') window.scrollTo(0, 0)
  }, [route.name])

  return (
    <>
      {route.name === 'library' && <Library />}
      {route.name === 'reader' && <Reader id={route.id} />}
      {route.name === 'settings' && <SettingsPage />}
      <Toasts />
      {update && (
        <div class="toasts" style={{ top: 'auto', bottom: 'calc(var(--safe-bottom) + 90px)' }}>
          <div class="toast" onClick={update}>
            <span>新版本已就绪</span>
            <button>立即更新</button>
          </div>
        </div>
      )}
    </>
  )
}
