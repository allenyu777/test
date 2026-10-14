import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Book } from '../core/book'
import type { BookMeta } from '../db'
import * as db from '../db'
import { importFiles, library, loadBook, removeBook, updateBookMeta } from '../library'
import { buildNotesFile } from '../notes/export'
import { ACCEPT, FORMAT_LABELS } from '../parsers'
import { createScannedBook, type ScanChoice } from '../ocr/importScanned'
import type { ScannedPdfError } from '../parsers/pdf'
import { ocrRunner } from '../ocr/runner'
import { player } from '../player'
import { settings, updateSettings } from '../settings'
import { useStore } from '../store'
import { Cover } from './Cover'
import { ScanSheet } from './ScanSheet'
import { ExportReady } from './ExportSheet'
import {
  IconBook,
  IconGear,
  IconGrid,
  IconHeadphones,
  IconMore,
  IconPause,
  IconPlay,
  IconPlus,
  IconRows,
  IconSearch,
  IconUpload,
} from './icons'
import { navigate } from './router'
import { Sheet } from './Sheet'
import { toast } from './toast'

function timeAgo(ts: number): string {
  if (!ts) return '未开始'
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function ocrLabel(meta: BookMeta): string | null {
  const ocr = meta.ocr
  if (!ocr || ocr.status === 'done') return null
  if (ocr.status === 'paused') return `识别已暂停 ${ocr.done}/${ocr.pages} 页`
  if (ocr.status === 'error') return '识别出错'
  return `识别中 ${ocr.done}/${ocr.pages} 页`
}

function percentLabel(meta: BookMeta) {
  const ocr = ocrLabel(meta)
  if (ocr) return ocr
  if (meta.finished) return '已读完'
  if (!meta.lastReadAt) return '未开始'
  return `${meta.percent < 10 ? meta.percent.toFixed(1) : Math.floor(meta.percent)}%`
}

export function Library() {
  const { books, loaded, importing } = useStore(library, s => s)
  const sort = useStore(settings, s => s.sort)
  const view = useStore(settings, s => s.libraryView)
  const playerBookId = useStore(player.store, s => s.bookId)
  const status = useStore(player.store, s => s.status)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<BookMeta | null>(null)
  const [dragging, setDragging] = useState(false)
  const [scanAsk, setScanAsk] = useState<{ file: File; scanned: ScannedPdfError; resolve: (c: ScanChoice | null) => void } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // 离开书架时，还在等待选择识别方式的导入按"取消"处理，避免导入一直卡住
  const mounted = useRef(true)
  const pendingScan = useRef<((choice: ScanChoice | null) => void) | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pendingScan.current?.(null)
      pendingScan.current = null
    }
  }, [])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = books.filter(b => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
    const by: Record<string, (a: BookMeta, b: BookMeta) => number> = {
      recent: (a, b) => (b.lastReadAt || b.addedAt / 1e3) - (a.lastReadAt || a.addedAt / 1e3),
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
      progress: (a, b) => b.percent - a.percent,
    }
    return [...list].sort(by[sort] ?? by.recent)
  }, [books, sort, query])

  // "继续收听"：正在播放的书，否则最近听过的书
  const hero = useMemo(() => {
    if (playerBookId) {
      const current = books.find(b => b.id === playerBookId)
      if (current) return current
    }
    return [...books].filter(b => b.lastReadAt && !b.finished).sort((a, b) => b.lastReadAt - a.lastReadAt)[0] ?? null
  }, [books, playerBookId])

  // 预先加载"继续收听"的书，这样点击播放时可以在同一次点击里立即出声（iOS 的要求）
  const heroBook = useRef<{ meta: BookMeta; book: Book } | null>(null)
  useEffect(() => {
    heroBook.current = null
    if (hero) loadBook(hero.id).then(r => (heroBook.current = r))
  }, [hero?.id])

  const onFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    try {
      const added = await importFiles(list, {
        // 扫描版 PDF：问用户用哪种方式识别文字
        onScanned: (file, scanned, setProgress) =>
          new Promise<ScanChoice | null>(resolve => {
            if (!mounted.current) return resolve(null)
            pendingScan.current = resolve
            setScanAsk({ file, scanned, resolve })
          }).then(choice => {
            pendingScan.current = null
            return choice ? createScannedBook(file, scanned, choice, setProgress) : null
          }),
      })
      if (added.length === 1) toast(`已导入《${added[0].title}》`, 'success')
      else if (added.length) toast(`已导入 ${added.length} 本书`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error', { duration: 8000 })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  // 桌面浏览器支持拖拽导入
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      onFiles(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const playHero = () => {
    if (!hero) return
    if (player.state.bookId === hero.id) {
      player.toggle()
      return
    }
    const loadedBook = heroBook.current
    if (loadedBook && loadedBook.meta.id === hero.id) {
      player.open(loadedBook.meta, loadedBook.book)
      player.play()
    } else navigate(`#/book/${hero.id}`)
  }

  const heroPlaying = hero && playerBookId === hero.id && status === 'playing'

  return (
    <div class="page">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        class="sr-only"
        onChange={e => onFiles((e.target as HTMLInputElement).files)}
      />
      <div class="topbar">
        <div class="spacer" />
        <button class="icon-btn" onClick={() => fileRef.current?.click()} aria-label="导入书籍">
          <IconPlus />
        </button>
        <button class="icon-btn" onClick={() => navigate('#/settings')} aria-label="设置">
          <IconGear />
        </button>
      </div>
      <h1 class="large-title">书架</h1>
      {books.length > 0 && <div class="muted small">共 {books.length} 本 · 点书本打开，点 ▶ 直接听</div>}

      {hero && (
        <div class="hero">
          <button onClick={() => navigate(`#/book/${hero.id}`)} aria-label={`打开《${hero.title}》`}>
            <Cover meta={hero} />
          </button>
          <div class="hero-body">
            <div class="hero-kicker">{heroPlaying ? '正在收听' : '继续收听'}</div>
            <button class="hero-title" style={{ textAlign: 'left' }} onClick={() => navigate(`#/book/${hero.id}`)}>
              {hero.title}
            </button>
            <div class="hero-chapter">{hero.chapter || hero.author}</div>
            <div class="hero-actions">
              <button class="play-fab" onClick={playHero} aria-label={heroPlaying ? '暂停' : '播放'}>
                {heroPlaying ? <IconPause size={24} /> : <IconPlay size={24} />}
              </button>
              <div style={{ flex: 1 }}>
                <div class="progress">
                  <i style={{ width: `${hero.percent}%` }} />
                </div>
                <div class="muted small" style={{ marginTop: '6px' }}>
                  {percentLabel(hero)} · {timeAgo(hero.lastReadAt)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {books.length > 0 && (
        <>
          {books.length > 8 && (
            <label class="search">
              <IconSearch size={18} />
              <input value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} placeholder="搜索书名或作者" />
            </label>
          )}
          <div class="toolbar">
            {(
              [
                ['recent', '最近收听'],
                ['added', '最近添加'],
                ['title', '书名'],
                ['progress', '进度'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} class={`chip ${sort === key ? 'active' : ''}`} onClick={() => updateSettings({ sort: key })}>
                {label}
              </button>
            ))}
            <div class="spacer" />
            <button
              class="icon-btn"
              onClick={() => updateSettings({ libraryView: view === 'grid' ? 'list' : 'grid' })}
              aria-label="切换视图"
            >
              {view === 'grid' ? <IconRows size={20} /> : <IconGrid size={20} />}
            </button>
          </div>
        </>
      )}

      {loaded && !books.length && <EmptyState onImport={() => fileRef.current?.click()} />}

      {view === 'grid' ? (
        <div class="grid">
          {sorted.map(b => (
            <div class="book-card" key={b.id}>
              <button onClick={() => navigate(`#/book/${b.id}`)} aria-label={`打开《${b.title}》`}>
                <Cover meta={b} playing={playerBookId === b.id && status === 'playing'} badge={b.finished ? '已读完' : undefined} />
              </button>
              <div class="progress" style={{ height: '3px' }}>
                <i style={{ width: `${b.percent}%` }} />
              </div>
              <button class="book-title" style={{ textAlign: 'left' }} onClick={() => navigate(`#/book/${b.id}`)}>
                {b.title}
              </button>
              <div class="book-sub">
                <span>{percentLabel(b)}</span>
                <button class="book-more" onClick={() => setMenu(b)} aria-label="更多操作">
                  <IconMore size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="list">
          {sorted.map(b => (
            <div class="list-row" key={b.id}>
              <button onClick={() => navigate(`#/book/${b.id}`)} aria-label={`打开《${b.title}》`}>
                <Cover meta={b} playing={playerBookId === b.id && status === 'playing'} />
              </button>
              <button class="list-row-body" style={{ textAlign: 'left' }} onClick={() => navigate(`#/book/${b.id}`)}>
                <div class="book-title">{b.title}</div>
                <div class="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[b.author, b.chapter].filter(Boolean).join(' · ') || b.format.toUpperCase()}
                </div>
                <div class="progress" style={{ marginTop: '4px' }}>
                  <i style={{ width: `${b.percent}%` }} />
                </div>
                <div class="book-sub">
                  <span>
                    {percentLabel(b)} · {timeAgo(b.lastReadAt)}
                  </span>
                </div>
              </button>
              <button class="icon-btn" onClick={() => setMenu(b)} aria-label="更多操作">
                <IconMore />
              </button>
            </div>
          ))}
        </div>
      )}

      {books.length > 0 && (
        <div style={{ marginTop: '28px', textAlign: 'center' }}>
          <button class="btn" onClick={() => fileRef.current?.click()}>
            <IconUpload size={18} /> 导入更多书籍
          </button>
          <div class="muted small" style={{ marginTop: '8px' }}>
            支持 {FORMAT_LABELS}
          </div>
        </div>
      )}

      <MiniPlayer />

      {menu && <BookMenu meta={menu} onClose={() => setMenu(null)} />}
      {scanAsk && (
        <ScanSheet
          name={scanAsk.file.name}
          pages={scanAsk.scanned.pages}
          reason={scanAsk.scanned.reason}
          langHint={scanAsk.scanned.langHint}
          onDone={choice => {
            scanAsk.resolve(choice)
            setScanAsk(null)
          }}
        />
      )}

      {importing && (
        <div class="import-overlay">
          <div class="import-card">
            <div class="spinner" />
            <div class="import-name">{importing.name}</div>
            <div class="muted small">
              {importing.total > 1 ? `第 ${importing.index + 1}/${importing.total} 本 · ` : ''}
              {importing.message}
            </div>
            <div class="progress" style={{ marginTop: '14px' }}>
              <i style={{ width: `${Math.round(importing.progress * 100)}%`, transition: 'width .2s' }} />
            </div>
          </div>
        </div>
      )}
      {dragging && <div class="dropzone">松开即可导入</div>}
    </div>
  )
}

function EmptyState({ onImport }: { onImport: () => void }) {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  return (
    <div class="empty">
      <div class="empty-art">
        <IconHeadphones size={48} />
      </div>
      <h2>把电子书变成有声书</h2>
      <p>导入 {FORMAT_LABELS} 等格式的电子书，选一个喜欢的声音，就能开始听了。</p>
      <button class="btn primary" onClick={onImport} style={{ marginTop: '8px' }}>
        <IconPlus size={18} /> 导入书籍
      </button>
      <div class="tips">
        {!standalone && (
          <>
            <b>先添加到主屏幕（推荐）</b>
            <ol>
              <li>在 Safari 中点底部的「分享」按钮</li>
              <li>选择「添加到主屏幕」</li>
              <li>以后从主屏幕图标打开，像 App 一样全屏使用，数据也更不容易被系统清理</li>
            </ol>
            <div style={{ height: '10px' }} />
          </>
        )}
        <b>让朗读更自然</b>
        <ol>
          <li>iPhone「设置 → 辅助功能 → 朗读内容 → 声音」中下载带「增强」「高级」标记的中文声音，下载后完全关闭本 App 再打开，在「声音」里选它（Siri 声音无法使用）</li>
          <li>或在本应用「设置」里填写 Azure / OpenAI 密钥，使用云端神经语音（最自然，可锁屏播放）</li>
        </ol>
      </div>
    </div>
  )
}

function MiniPlayer() {
  const bookId = useStore(player.store, s => s.bookId)
  const status = useStore(player.store, s => s.status)
  const chapter = useStore(player.store, s => s.chapter)
  const loading = useStore(player.store, s => s.loading)
  const meta = useStore(library, s => s.books.find(b => b.id === bookId) ?? null)
  if (!bookId || !meta || status === 'idle') return null
  return (
    <div class="mini-player">
      <button onClick={() => navigate(`#/book/${bookId}`)} aria-label="打开正在播放的书">
        <Cover meta={meta} />
      </button>
      <button class="mini-body" onClick={() => navigate(`#/book/${bookId}`)}>
        <div class="mini-title">{meta.title}</div>
        <div class="mini-sub">{chapter}</div>
      </button>
      <button class="play-fab" style={{ width: '44px', height: '44px' }} onClick={() => player.toggle()} aria-label="播放/暂停">
        {loading ? <div class="spinner" /> : status === 'playing' ? <IconPause size={20} /> : <IconPlay size={20} />}
      </button>
    </div>
  )
}

function BookMenu({ meta, onClose }: { meta: BookMeta; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'export'>('menu')
  const [title, setTitle] = useState(meta.title)
  const [author, setAuthor] = useState(meta.author)
  const [file, setFile] = useState<File | null>(null)

  const remove = async () => {
    if (!confirm(`确定删除《${meta.title}》吗？\n书籍、进度和笔记都会一起删除。`)) return
    if (player.state.bookId === meta.id) player.close()
    // 正在识别的话，停下并不再保存
    ocrRunner.cancel(meta.id)
    await removeBook(meta.id)
    toast('已删除')
    onClose()
  }

  const exportNotes = async (format: 'md' | 'txt' | 'zip') => {
    try {
      const notes = await db.listNotes(meta.id)
      setFile(await buildNotesFile([{ book: meta, notes }], format))
      setMode('export')
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败', 'error')
    }
  }

  if (mode === 'rename') {
    return (
      <Sheet
        title="编辑书籍信息"
        onClose={onClose}
        footer={
          <>
            <button class="btn" onClick={onClose}>
              取消
            </button>
            <button
              class="btn primary"
              onClick={async () => {
                await updateBookMeta(meta.id, { title: title.trim() || meta.title, author: author.trim() })
                if (player.meta?.id === meta.id) Object.assign(player.meta, { title, author })
                onClose()
              }}
            >
              保存
            </button>
          </>
        }
      >
        <div class="field">
          <label>书名</label>
          <input class="input" value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label>作者</label>
          <input class="input" value={author} onInput={e => setAuthor((e.target as HTMLInputElement).value)} />
        </div>
      </Sheet>
    )
  }

  if (mode === 'export' && file) {
    return (
      <Sheet title="导出笔记" onClose={onClose}>
        <ExportReady file={file} />
      </Sheet>
    )
  }

  const progressAction = meta.finished || meta.percent > 0
  const ocr = meta.ocr && meta.ocr.status !== 'done' ? meta.ocr : null
  return (
    <Sheet title={meta.title} onClose={onClose} class="action-sheet">
      <div class="muted small" style={{ marginBottom: '12px' }}>
        {[meta.author, meta.format.toUpperCase(), `${(meta.totalChars / 10000).toFixed(1)} 万字`].filter(Boolean).join(' · ')}
      </div>
      <div class="option-list">
        <button class="option" onClick={() => navigate(`#/book/${meta.id}`)}>
          <IconBook size={20} /> 打开
        </button>
        {ocr && (
          <button
            class="option"
            onClick={async () => {
              if (ocr.status === 'running') await ocrRunner.pause(meta.id)
              else await ocrRunner.resume(meta.id)
              onClose()
            }}
          >
            {ocr.status === 'running' ? '暂停文字识别' : '继续文字识别'}（{ocr.done}/{ocr.pages} 页）
          </button>
        )}
        <button class="option" onClick={() => setMode('rename')}>
          编辑书名和作者
        </button>
        <button class="option" onClick={() => exportNotes('md')}>
          导出笔记（Markdown）
        </button>
        <button class="option" onClick={() => exportNotes('txt')}>
          导出笔记（纯文本）
        </button>
        <button class="option" onClick={() => exportNotes('zip')}>
          导出笔记（含录音 ZIP）
        </button>
        {progressAction && (
          <button
            class="option"
            onClick={async () => {
              if (!confirm('把阅读进度重置到开头？')) return
              if (player.state.bookId === meta.id) player.seek({ b: 0, o: 0 }, false)
              await updateBookMeta(meta.id, { pos: { b: 0, o: 0 }, percent: 0, finished: false, lastReadAt: 0 })
              onClose()
            }}
          >
            从头开始
          </button>
        )}
        {!meta.finished && (
          <button
            class="option"
            onClick={async () => {
              await updateBookMeta(meta.id, { finished: true })
              onClose()
            }}
          >
            标记为已读完
          </button>
        )}
        <button class="option danger" onClick={remove}>
          删除这本书
        </button>
      </div>
    </Sheet>
  )
}
