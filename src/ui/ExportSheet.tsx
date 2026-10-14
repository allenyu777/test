import { useEffect, useState } from 'preact/hooks'
import * as db from '../db'
import type { BookMeta } from '../db'
import { buildNotesFile, copyText, downloadFile, shareFile, type ExportFormat } from '../notes/export'
import { library } from '../library'
import { IconCopy, IconDownload, IconNotes, IconShare } from './icons'
import { Sheet } from './Sheet'
import { toast } from './toast'

/** 文件已生成：分享 / 下载 / 复制 */
export function ExportReady({ file }: { file: File }) {
  const isText = /\.(md|txt)$/.test(file.name)
  // 提前读出文字：iOS 只允许在点击的同一时刻写剪贴板
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (isText) file.text().then(setText)
  }, [file])
  return (
    <div>
      <div class="hint" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <IconNotes size={28} />
        <div style={{ minWidth: 0 }}>
          <b style={{ wordBreak: 'break-all' }}>{file.name}</b>
          <div>{(file.size / 1024).toFixed(1)} KB · 可存到「文件」、备忘录，或发送到微信等</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          class="btn primary block"
          onClick={async () => {
            const r = await shareFile(file)
            if (r === 'downloaded') toast('已下载')
          }}
        >
          <IconShare size={18} /> 分享 / 存储到文件
        </button>
        <button class="btn block" onClick={() => downloadFile(file)}>
          <IconDownload size={18} /> 下载
        </button>
        {isText && (
          <button
            class="btn block"
            disabled={text === null}
            onClick={() =>
              copyText(text ?? '').then(ok => toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'success' : 'error'))
            }
          >
            <IconCopy size={18} /> 复制全部文字
          </button>
        )}
      </div>
    </div>
  )
}

/** 选择导出范围和格式 */
export function ExportSheet({ book, onClose }: { book?: BookMeta | null; onClose: () => void }) {
  const [scope, setScope] = useState<'book' | 'all'>(book ? 'book' : 'all')
  const [format, setFormat] = useState<ExportFormat>('md')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const build = async () => {
    setBusy(true)
    try {
      let entries: { book: BookMeta; notes: db.Note[] }[]
      if (scope === 'book' && book) entries = [{ book, notes: await db.listNotes(book.id) }]
      else {
        const all = await db.listAllNotes()
        const books = library.get().books.length ? library.get().books : await db.listBooks()
        entries = books
          .map(b => ({
            book: b,
            notes: all.filter(n => n.bookId === b.id).sort((x, y) => x.b - y.b || x.o - y.o),
          }))
          .filter(e => e.notes.length)
      }
      setFile(await buildNotesFile(entries, format))
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="导出读书笔记" onClose={onClose}>
      {file ? (
        <ExportReady file={file} />
      ) : (
        <>
          {book && (
            <div class="field">
              <span class="label">范围</span>
              <div class="seg">
                <button class={scope === 'book' ? 'active' : ''} onClick={() => setScope('book')}>
                  本书
                </button>
                <button class={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
                  全部书籍
                </button>
              </div>
            </div>
          )}
          <div class="field">
            <span class="label">格式</span>
            <div class="option-list">
              {(
                [
                  ['md', 'Markdown（.md）', '适合 Obsidian、Notion、印象笔记等'],
                  ['txt', '纯文本（.txt）', '任何地方都能打开'],
                  ['zip', '压缩包（.zip）', 'Markdown + 语音笔记录音文件'],
                ] as const
              ).map(([key, title, desc]) => (
                <button key={key} class="option" style={{ minHeight: '60px' }} onClick={() => setFormat(key)}>
                  <div>
                    <div>{title}</div>
                    <div class="muted small">{desc}</div>
                  </div>
                  {format === key && <span class="check">✓</span>}
                </button>
              ))}
            </div>
          </div>
          <button class="btn primary block" onClick={build} disabled={busy}>
            {busy ? <div class="spinner" /> : '生成文件'}
          </button>
        </>
      )}
    </Sheet>
  )
}
