// 听书统计：每天、每本书听了多长时间（只记在这台设备上，完整备份时一起备份）
import { createStore } from './store'

export interface ListenStats {
  /** 日期（本地时间 2026-10-16）→ 秒 */
  days: Record<string, number>
  /** 书 id → 秒 */
  books: Record<string, number>
}

const KEY = 'tingshu.stats.v1'

function load(): ListenStats {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ListenStats> | null
    return { days: { ...saved?.days }, books: { ...saved?.books } }
  } catch {
    return { days: {}, books: {} }
  }
}

export const listenStats = createStore<ListenStats>(load())

listenStats.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(listenStats.get()))
  } catch {
    // 隐私模式下可能无法写入
  }
})

export function dayKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addListening(bookId: string | null, seconds: number, date = new Date()) {
  if (!(seconds > 0)) return
  const { days, books } = listenStats.get()
  const day = dayKey(date)
  listenStats.set({
    days: { ...days, [day]: (days[day] ?? 0) + seconds },
    books: bookId ? { ...books, [bookId]: (books[bookId] ?? 0) + seconds } : books,
  })
}

/** 合并备份里的统计（同一天、同一本书取较大的值，重复恢复不会翻倍） */
export function mergeStats(other: Partial<ListenStats> | undefined, bookId: (id: string) => string | undefined = id => id) {
  if (!other) return
  const { days, books } = listenStats.get()
  const nextDays = { ...days }
  for (const [d, s] of Object.entries(other.days ?? {})) nextDays[d] = Math.max(nextDays[d] ?? 0, s)
  const nextBooks = { ...books }
  for (const [id, s] of Object.entries(other.books ?? {})) {
    const local = bookId(id)
    if (local) nextBooks[local] = Math.max(nextBooks[local] ?? 0, s)
  }
  listenStats.set({ days: nextDays, books: nextBooks })
}

export interface StatsSummary {
  today: number
  week: number
  total: number
  /** 连续收听的天数（今天还没听时从昨天算起） */
  streak: number
  /** 最近 7 天，从早到晚 */
  last7: { day: string; label: string; seconds: number }[]
}

export function summarize(stats: ListenStats, now = new Date()): StatsSummary {
  const at = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    return { d, key: dayKey(d) }
  }
  const last7 = [6, 5, 4, 3, 2, 1, 0].map(offset => {
    const { d, key } = at(offset)
    return { day: key, label: offset === 0 ? '今天' : '日一二三四五六'[d.getDay()], seconds: stats.days[key] ?? 0 }
  })
  let streak = 0
  let offset = (stats.days[dayKey(now)] ?? 0) >= 60 ? 0 : 1
  while ((stats.days[at(offset).key] ?? 0) >= 60) {
    streak++
    offset++
  }
  return {
    today: stats.days[dayKey(now)] ?? 0,
    week: last7.reduce((sum, d) => sum + d.seconds, 0),
    total: Object.values(stats.days).reduce((sum, s) => sum + s, 0),
    streak,
    last7,
  }
}

/** "1 小时 5 分" "23 分钟" */
export function formatListen(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`
}

/**
 * 跟着播放状态计时：开始播放时记下时间，暂停、每 30 秒、页面隐藏时把听了的时间记下来。
 * 一次最多记 2 小时（防止设备休眠时间被算进去）。
 */
export function trackListening(store: { get(): { status: string; bookId: string | null }; subscribe(fn: () => void): () => void }) {
  let since: number | null = null
  let bookId: string | null = null
  const flush = () => {
    if (since == null) return
    const now = Date.now()
    addListening(bookId, Math.min(7200, (now - since) / 1000))
    since = now
  }
  const sync = () => {
    const { status, bookId: id } = store.get()
    const playing = status === 'playing'
    if (since != null && (!playing || id !== bookId)) {
      flush()
      since = null
    }
    if (playing && since == null) {
      since = Date.now()
      bookId = id
    }
  }
  store.subscribe(sync)
  setInterval(flush, 30_000)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', flush)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
}
