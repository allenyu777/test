import { useEffect } from 'preact/hooks'
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

export function App() {
  const route = useRoute()
  useTheme()
  useEffect(() => {
    if (route.name !== 'reader') window.scrollTo(0, 0)
  }, [route.name])

  return (
    <>
      {route.name === 'library' && <Library />}
      {route.name === 'reader' && <Reader id={route.id} />}
      {route.name === 'settings' && <SettingsPage />}
      <Toasts />
    </>
  )
}
