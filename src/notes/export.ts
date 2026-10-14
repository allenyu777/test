// 读书笔记导出：Markdown / 纯文本 / 带录音的 ZIP
import { strToU8, zipSync } from 'fflate'
import { getAudio, type BookMeta, type Note } from '../db'
import { audioExtension } from './recorder'

export type ExportFormat = 'md' | 'txt' | 'zip'

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(ts: number, withTime = true): string {
  const d = new Date(ts)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 80) || '读书笔记'
}

interface ExportOptions {
  /** 录音文件在压缩包中的路径（用于 Markdown 链接） */
  audioPaths?: Map<string, string>
}

function quoteLines(text: string, prefix: string) {
  return text
    .split('\n')
    .map(line => prefix + line)
    .join('\n')
}

export function bookNotesMarkdown(book: BookMeta, notes: Note[], options: ExportOptions = {}): string {
  const lines: string[] = []
  lines.push(`# 《${book.title}》读书笔记`)
  const meta = [book.author && `作者：${book.author}`, `共 ${notes.length} 条笔记`, `导出于 ${formatDate(Date.now())}`]
  lines.push('', meta.filter(Boolean).join(' · '))
  let chapter: string | null = null
  for (const n of notes) {
    if (n.chapter !== chapter) {
      chapter = n.chapter
      lines.push('', `## ${chapter || '正文'}`)
    }
    lines.push('', quoteLines(n.quote, '> '))
    if (n.text.trim()) lines.push('', n.text.trim())
    const extra: string[] = [formatDate(n.createdAt)]
    if (n.audioId) {
      const path = options.audioPaths?.get(n.audioId)
      const label = `语音笔记 ${formatClock(n.audioDuration ?? 0)}`
      extra.push(path ? `[${label}](${encodeURI(path)})` : label)
    }
    lines.push('', `*${extra.join(' · ')}*`)
  }
  return lines.join('\n') + '\n'
}

export function bookNotesText(book: BookMeta, notes: Note[]): string {
  const lines: string[] = []
  lines.push(`《${book.title}》读书笔记`)
  if (book.author) lines.push(`作者：${book.author}`)
  lines.push(`共 ${notes.length} 条笔记，导出于 ${formatDate(Date.now())}`, '')
  let chapter: string | null = null
  for (const n of notes) {
    if (n.chapter !== chapter) {
      chapter = n.chapter
      lines.push('', `【${chapter || '正文'}】`, '')
    }
    lines.push(`「${n.quote}」`)
    if (n.text.trim()) lines.push(n.text.trim())
    const extra = [formatDate(n.createdAt)]
    if (n.audioId) extra.push(`语音笔记 ${formatClock(n.audioDuration ?? 0)}`)
    lines.push(`—— ${extra.join(' · ')}`, '')
  }
  return lines.join('\n') + '\n'
}

/** 生成导出文件；books 为空时导出全部书 */
export async function buildNotesFile(
  entries: { book: BookMeta; notes: Note[] }[],
  format: ExportFormat,
): Promise<File> {
  const list = entries.filter(e => e.notes.length)
  if (!list.length) throw new Error('还没有笔记可以导出')
  const stamp = formatDate(Date.now(), false)
  const baseName = list.length === 1 ? `${safeFileName(list[0].book.title)}-读书笔记` : `全部读书笔记`

  if (format === 'txt') {
    const text = list.map(e => bookNotesText(e.book, e.notes)).join('\n\n')
    return new File([text], `${baseName}-${stamp}.txt`, { type: 'text/plain;charset=utf-8' })
  }
  if (format === 'md') {
    const text = list.map(e => bookNotesMarkdown(e.book, e.notes)).join('\n\n---\n\n')
    return new File([text], `${baseName}-${stamp}.md`, { type: 'text/markdown;charset=utf-8' })
  }

  // ZIP：每本书一个 Markdown 文件 + 录音文件夹
  const files: Record<string, Uint8Array> = {}
  for (const { book, notes } of list) {
    const audioPaths = new Map<string, string>()
    const folder = safeFileName(book.title)
    let i = 0
    for (const n of notes) {
      if (!n.audioId) continue
      const rec = await getAudio(n.audioId)
      if (!rec) continue
      i++
      const path = `录音/${folder}-${String(i).padStart(3, '0')}.${audioExtension(rec.type)}`
      files[path] = new Uint8Array(rec.data)
      audioPaths.set(n.audioId, path)
    }
    files[`${folder}-读书笔记.md`] = strToU8(bookNotesMarkdown(book, notes, { audioPaths }))
  }
  const zip = zipSync(files, { level: 0 })
  return new File([zip as Uint8Array<ArrayBuffer>], `${baseName}-${stamp}.zip`, { type: 'application/zip' })
}

/** 用系统分享（可存到"文件"、备忘录、微信等），不支持时直接下载。须在点击事件中调用 */
export async function shareFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
    }
  }
  downloadFile(file)
  return 'downloaded'
}

export function downloadFile(file: Blob & { name?: string }, name = file.name ?? 'download') {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
