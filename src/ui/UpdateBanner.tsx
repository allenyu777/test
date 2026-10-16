import { useStore } from '../store'
import { appUpdate } from '../update'

/** 有新版本时一直显示的「更新」按钮，点了才更新 */
export function UpdateBanner() {
  const apply = useStore(appUpdate, s => s.apply)
  if (!apply) return null
  return (
    <button class="update-pill" onClick={apply}>
      <span class="update-dot" />
      新版本 · 点击更新
    </button>
  )
}
