// 新版本：下载好以后一直提示，直到用户点「更新」
import { createStore } from './store'

export const appUpdate = createStore<{ apply: (() => void) | null }>({ apply: null })
