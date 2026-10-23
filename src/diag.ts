// 播放诊断记录：锁屏按钮、音频事件，存在本机，设置里可以查看、复制（真机上排查锁屏问题用）
const KEY = 'tingshu.diag.v1'
const LIMIT = 120

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as string[]
  } catch {
    return []
  }
}

let entries: string[] | null = null

export function diag(message: string) {
  entries ??= load()
  const d = new Date()
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? ' [后台]' : ''
  entries.push(`${time}${hidden} ${message}`)
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // 存不下就算了
  }
}

export function diagEntries(): string[] {
  entries ??= load()
  return entries.slice()
}

export function clearDiag() {
  entries = []
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略
  }
}
