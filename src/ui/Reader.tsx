import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Book, Pos } from '../core/book'
import * as db from '../db'
import type { BookMeta, Note } from '../db'
import { library, loadBook } from '../library'
import { ocrRunner } from '../ocr/runner'
import { isGarbled } from '../parsers/garble'
import { copyText } from '../notes/export'
import { player } from '../player'
import { settings } from '../settings'
import { useStore } from '../store'
import { ExportSheet } from './ExportSheet'
import { IconChevronLeft, IconChevronRight, IconCopy, IconList, IconLocate, IconMic, IconNotes, IconPen, IconPlay, IconType } from './icons'
import { NoteEditor, NotesSheet } from './Notes'
import { PlayerBar, type ToolSheet } from './PlayerBar'
import { DisplaySheet, SpeedSheet, TimerSheet, TocSheet, VoiceSheet } from './ReaderSheets'
import { goBack } from './router'
import { toast } from './toast'

type SheetState =
  | { type: 'toc' | 'notes' | 'display' | 'export' | ToolSheet }
  | { type: 'note'; pos: Pos; note?: Note | null; voice?: boolean }
  | null

interface PopoverState {
  pos: Pos
  x: number
  top: number
  bottom: number
}

const FONT_STACKS: Record<string, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  serif: "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', Georgia, serif",
  kai: "'Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKai', 'Songti SC', serif",
}

export function Reader({ id }: { id: string }) {
  const [state, setState] = useState<{ meta: BookMeta; book: Book } | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let alive = true
    loadBook(id)
      .then(r => {
        if (!alive) return
        if (!r) {
          setMissing(true)
          return
        }
        player.open(r.meta, r.book)
        // 正在看的书优先识别
        if (r.meta.ocr && r.meta.ocr.status !== 'done') ocrRunner.prioritize(r.meta.id)
        setState(r)
      })
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
      player.saveNow()
    }
  }, [id])

  if (missing) {
    return (
      <div class="page">
        <div class="topbar">
          <button class="icon-btn" onClick={goBack} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
        <div class="empty">
          <h2>找不到这本书</h2>
          <p>它可能已经被删除了。</p>
        </div>
      </div>
    )
  }
  if (!state) {
    return (
      <div class="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div class="spinner" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }
  return <ReaderView key={id} meta={state.meta} book={state.book} />
}

// 注意：不要引入 preact/compat，它会把 onChange 改成 input 事件，导致拖动进度条时不停跳转
function SectionView({ book, index, notesMap }: { book: Book; index: number; notesMap: Map<string, Note[]> }) {
  const { start, end } = book.sections[index]
  const out = []
  for (let b = start; b < end; b++) {
    const text = book.blocks[b]
    const head = book.heads[b]
    const children: (string | preact.JSX.Element)[] = []
    let last = 0
    for (const s of book.sentences(b)) {
      if (s.o > last) children.push(text.slice(last, s.o))
      const n = notesMap.get(`${b}:${s.o}`)
      children.push(
        <span key={s.o} class={n ? 's has-note' : 's'} id={`s${b}-${s.o}`} data-b={b} data-o={s.o}>
          {text.slice(s.o, s.e)}
          {n && (
            <button class="note-mark" data-note={n[0].id} aria-label="查看笔记">
              <IconPen />
            </button>
          )}
        </span>,
      )
      last = s.e
    }
    if (last < text.length) children.push(text.slice(last))
    out.push(
      <p key={b} data-b={b} class={head ? `h h${head}` : book.isNote(b) ? 'fn' : undefined}>
        {children}
      </p>,
    )
  }
  return <>{out}</>
}

function ReaderView({ meta, book }: { meta: BookMeta; book: Book }) {
  const fontSize = useStore(settings, s => s.fontSize)
  const lineHeight = useStore(settings, s => s.lineHeight)
  const font = useStore(settings, s => s.font)
  const chapter = useStore(player.store, s => s.chapter)
  // 扫描版识别进度（识别出新页面时重新渲染正文）
  const ocr = useStore(library, s => s.books.find(b => b.id === meta.id)?.ocr ?? null)
  const ocrDone = ocr?.done ?? 0
  const [section, setSection] = useState(() => book.sectionIndex(player.state.pos.b))
  const [following, setFollowing] = useState(true)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [showLocate, setShowLocate] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef(section)
  sectionRef.current = section
  const followingRef = useRef(following)
  followingRef.current = following
  const pendingScroll = useRef<'center' | 'top' | null>('center')

  const reloadNotes = () => db.listNotes(meta.id).then(setNotes)
  useEffect(() => {
    reloadNotes()
  }, [meta.id])

  const notesMap = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const n of notes) {
      if (n.b >= book.blocks.length) continue
      const list = book.sentences(n.b)
      const o = list[book.sentenceIndex({ b: n.b, o: n.o })]?.o ?? 0
      const key = `${n.b}:${o}`
      map.set(key, [...(map.get(key) ?? []), n])
    }
    return map
  }, [notes, book])

  const barHeight = () => (document.querySelector('.player-bar') as HTMLElement | null)?.offsetHeight ?? 200
  const headerHeight = () => (document.querySelector('.reader-header') as HTMLElement | null)?.offsetHeight ?? 56

  const currentEl = () => {
    const { pos } = player.state
    return document.getElementById(`s${pos.b}-${pos.o}`)
  }

  /** 高亮当前句，并按需滚动 */
  const applyHighlight = (mode: 'follow' | 'center' | 'none') => {
    const el = currentEl()
    contentRef.current?.querySelectorAll('.s.cur').forEach(prev => prev !== el && prev.classList.remove('cur'))
    if (!el) return
    el.classList.add('cur')
    const rect = el.getBoundingClientRect()
    const top = headerHeight() + 16
    const bottom = window.innerHeight - barHeight() - 16
    const visibleHeight = bottom - top
    if (mode === 'center' || (mode === 'follow' && (rect.top < top || rect.bottom > bottom))) {
      const target = window.scrollY + rect.top - top - Math.max(0, (visibleHeight - rect.height) * (mode === 'center' ? 0.4 : 0.15))
      window.scrollTo({ top: Math.max(0, target), behavior: mode === 'center' ? 'auto' : 'smooth' })
    }
  }

  const updateLocate = () => {
    const { pos } = player.state
    if (book.sectionIndex(pos.b) !== sectionRef.current) {
      setShowLocate(true)
      return
    }
    const el = currentEl()
    if (!el) return setShowLocate(false)
    const r = el.getBoundingClientRect()
    setShowLocate(r.bottom < headerHeight() || r.top > window.innerHeight - barHeight())
  }

  // 跟随朗读位置：高亮、自动滚动、自动翻到下一章
  useEffect(() => {
    let lastKey = ''
    return player.store.subscribe(() => {
      const { pos, status } = player.state
      const key = `${pos.b}-${pos.o}`
      if (key === lastKey) return
      lastKey = key
      const auto = followingRef.current && settings.get().follow && status === 'playing'
      const target = book.sectionIndex(pos.b)
      if (target !== sectionRef.current) {
        if (auto) {
          pendingScroll.current = 'center'
          setSection(target)
        } else {
          // 不自动翻页时，清掉旧高亮，显示"回到朗读位置"
          applyHighlight('none')
          updateLocate()
        }
        return
      }
      applyHighlight(auto ? 'follow' : 'none')
      updateLocate()
    })
  }, [book])

  useLayoutEffect(() => {
    const mode = pendingScroll.current
    pendingScroll.current = null
    if (mode === 'center') applyHighlight('center')
    else {
      if (mode === 'top') window.scrollTo(0, 0)
      applyHighlight('none')
    }
    updateLocate()
  }, [section])

  // 识别出新页面后目录可能重新划分：继续显示原来那部分内容所在的分段
  const shownStart = useRef<number | null>(null)
  useEffect(() => {
    shownStart.current = book.sections[section]?.start ?? null
  }, [section])
  useEffect(() => {
    const start = shownStart.current
    if (start == null) return
    const target = book.sectionIndex(start)
    if (target !== sectionRef.current) setSection(target)
  }, [ocrDone])

  // 笔记变化会重绘句子，重新加上高亮
  useEffect(() => applyHighlight('none'), [notesMap])

  // 调整字号/行距/字体后，重新把朗读位置放回视野
  useLayoutEffect(() => {
    applyHighlight(followingRef.current && player.state.status === 'playing' ? 'center' : 'none')
    updateLocate()
  }, [fontSize, lineHeight, font])

  // 用户手动滚动时暂停跟随
  useEffect(() => {
    let raf = 0
    const onTouch = (e: Event) => {
      if (!(e.target as HTMLElement)?.closest?.('.reader-content')) return
      if (player.state.status === 'playing' && followingRef.current) setFollowing(false)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(updateLocate)
      setPopover(null)
    }
    window.addEventListener('touchmove', onTouch, { passive: true })
    window.addEventListener('wheel', onTouch, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('wheel', onTouch)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  // 点中的句子加个底色
  useEffect(() => {
    if (!popover) return
    const el = document.getElementById(`s${popover.pos.b}-${popover.pos.o}`)
    el?.classList.add('sel')
    return () => el?.classList.remove('sel')
  }, [popover])

  const locate = () => {
    setFollowing(true)
    const target = book.sectionIndex(player.state.pos.b)
    if (target !== section) {
      pendingScroll.current = 'center'
      setSection(target)
    } else applyHighlight('center')
    setShowLocate(false)
  }

  const jumpTo = (pos: Pos) => {
    const p = book.speakableFrom(pos) ?? book.clamp(pos)
    player.seek(p)
    setFollowing(true)
    setSheet(null)
    const target = book.sectionIndex(p.b)
    if (target !== sectionRef.current) {
      pendingScroll.current = 'center'
      setSection(target)
    } else requestAnimationFrame(() => applyHighlight('center'))
  }

  // 目录跳转：读过一部分的章节接着上次的位置读
  const jumpToChapter = (b: number, fromStart = false) => {
    const { pos, start, resumed } = player.chapterTarget(b, fromStart)
    jumpTo(pos)
    if (resumed) player.toastResumed(pos, () => jumpTo(start))
  }

  const goSection = (index: number) => {
    if (player.state.status === 'playing') setFollowing(false)
    pendingScroll.current = 'top'
    setSection(index)
  }

  const onContentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const mark = target.closest('.note-mark') as HTMLElement | null
    if (mark) {
      const n = notes.find(x => x.id === mark.dataset.note)
      if (n) setSheet({ type: 'note', pos: { b: n.b, o: n.o }, note: n })
      return
    }
    const span = target.closest('.s') as HTMLElement | null
    if (!span || popover) {
      setPopover(null)
      return
    }
    const rect = span.getBoundingClientRect()
    setPopover({ pos: { b: Number(span.dataset.b), o: Number(span.dataset.o) }, x: e.clientX, top: rect.top, bottom: rect.bottom })
  }

  const playFrom = (pos?: Pos) => {
    setFollowing(true)
    player.play(pos)
    if (!pos) requestAnimationFrame(() => {
      const target = book.sectionIndex(player.state.pos.b)
      if (target !== sectionRef.current) {
        pendingScroll.current = 'center'
        setSection(target)
      } else applyHighlight('follow')
    })
  }

  // 以前导入的乱码 PDF：提示删除后重新导入（新版会自动识别文字）
  const garbled = useMemo(() => {
    if (meta.format !== 'pdf' || meta.ocr) return false
    const range = book.sections[section]
    if (!range) return false
    return isGarbled(book.blocks.slice(range.start, Math.min(range.end, range.start + 40)).join('\n'))
  }, [book, section, meta])
  const sectionView = useMemo(
    () => (book.sections[section] ? <SectionView book={book} index={section} notesMap={notesMap} /> : null),
    [book, section, notesMap, ocrDone],
  )
  const sec = book.sections[section]
  const prevSec = section > 0 ? book.sections[section - 1] : null
  const nextSec = section < book.sections.length - 1 ? book.sections[section + 1] : null
  const cjk = meta.lang === 'zh' || meta.lang === 'ja'

  const popoverStyle = popover
    ? {
        left: `${Math.max(8, Math.min(window.innerWidth - 256, popover.x - 124))}px`,
        top: `${popover.top > headerHeight() + 80 ? popover.top - 66 : Math.min(popover.bottom + 8, window.innerHeight - barHeight() - 70)}px`,
      }
    : undefined

  return (
    <div class="reader">
      <header class="reader-header">
        <div class="reader-header-inner">
          <button class="icon-btn" onClick={goBack} aria-label="返回书架">
            <IconChevronLeft />
          </button>
          <div class="reader-heading">
            <div class="t">{meta.title}</div>
            <div class="c">{chapter || sec?.title}</div>
          </div>
          <button class="icon-btn" onClick={() => setSheet({ type: 'toc' })} aria-label="目录">
            <IconList />
          </button>
          <button class="icon-btn" onClick={() => setSheet({ type: 'notes' })} aria-label="笔记">
            <IconNotes />
          </button>
          <button class="icon-btn" onClick={() => setSheet({ type: 'display' })} aria-label="显示设置">
            <IconType />
          </button>
        </div>
      </header>

      <div
        ref={contentRef}
        class="reader-content"
        data-lang={cjk ? 'cjk' : 'en'}
        lang={meta.lang || undefined}
        style={{ '--font-size': `${fontSize}px`, '--line-height': String(lineHeight), '--reader-font': FONT_STACKS[font] } as Record<string, string>}
        onClick={onContentClick}
      >
        {garbled && (
          <div class="hint" style={{ textIndent: 0, fontFamily: 'var(--ui-font)' }}>
            <b>这本 PDF 的文字是乱码</b>
            <br />
            PDF 里的字体缺少正确的文字编码。请回到书架删除这本书，再重新导入：新版本会自动发现乱码，并按页面图片重新识别文字（繁体书选「繁体中文」）。
          </div>
        )}
        {prevSec && (
          <div class="section-nav">
            <button onClick={() => goSection(section - 1)}>
              <IconChevronLeft size={16} />
              <span>上一章 · {prevSec.title}</span>
            </button>
          </div>
        )}
        {sectionView}
        <div class="section-nav" style={{ marginTop: '32px' }}>
          {nextSec ? (
            <button onClick={() => goSection(section + 1)}>
              <span>下一章 · {nextSec.title}</span>
              <IconChevronRight size={16} />
            </button>
          ) : ocr && ocr.status !== 'done' ? null : (
            <span class="muted small">— 全书完 —</span>
          )}
        </div>
        {ocr && ocr.status !== 'done' && !nextSec && (
          <div class="hint" style={{ textAlign: 'center', textIndent: 0, fontFamily: 'var(--ui-font)' }}>
            {ocr.status === 'running'
              ? `正在识别第 ${Math.min(ocr.done + 1, ocr.pages)} / ${ocr.pages} 页…（需要 App 保持在前台）`
              : ocr.status === 'paused'
                ? `文字识别已暂停（${ocr.done}/${ocr.pages} 页）`
                : `文字识别出错：${ocr.error ?? ''}`}
            <div style={{ marginTop: '8px' }}>
              <button
                class="chip"
                onClick={e => {
                  e.stopPropagation()
                  if (ocr.status === 'running') ocrRunner.pause(meta.id)
                  else ocrRunner.resume(meta.id)
                }}
              >
                {ocr.status === 'running' ? '暂停识别' : '继续识别'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showLocate && (
        <button class="locate-fab" onClick={locate}>
          <IconLocate size={18} /> 回到朗读位置
        </button>
      )}

      {popover && (
        <div class="popover" style={popoverStyle}>
          <button
            onClick={() => {
              setPopover(null)
              playFrom(popover.pos)
            }}
          >
            <IconPlay size={18} />
            从这读
          </button>
          <button
            onClick={() => {
              setPopover(null)
              setSheet({ type: 'note', pos: popover.pos })
            }}
          >
            <IconPen size={18} />
            笔记
          </button>
          <button
            onClick={() => {
              setPopover(null)
              setSheet({ type: 'note', pos: popover.pos, voice: true })
            }}
          >
            <IconMic size={18} />
            语音
          </button>
          <button
            onClick={async () => {
              setPopover(null)
              const ok = await copyText(book.sentenceText(popover.pos))
              toast(ok ? '已复制' : '复制失败')
            }}
          >
            <IconCopy size={18} />
            复制
          </button>
        </div>
      )}

      <PlayerBar
        book={book}
        lang={meta.lang}
        onSheet={type => setSheet({ type })}
        onNote={voice => setSheet({ type: 'note', pos: player.state.pos, voice })}
        onPlayFrom={() => playFrom()}
      />

      {sheet?.type === 'toc' && <TocSheet book={book} onClose={() => setSheet(null)} onJump={jumpToChapter} />}
      {sheet?.type === 'notes' && (
        <NotesSheet
          book={book}
          meta={meta}
          notes={notes}
          onClose={() => setSheet(null)}
          onJump={jumpTo}
          onEdit={note => setSheet({ type: 'note', pos: { b: note.b, o: note.o }, note })}
          onExport={() => setSheet({ type: 'export' })}
        />
      )}
      {sheet?.type === 'display' && <DisplaySheet onClose={() => setSheet(null)} />}
      {sheet?.type === 'speed' && <SpeedSheet onClose={() => setSheet(null)} />}
      {sheet?.type === 'voice' && <VoiceSheet meta={meta} onClose={() => setSheet(null)} />}
      {sheet?.type === 'timer' && <TimerSheet onClose={() => setSheet(null)} />}
      {sheet?.type === 'export' && <ExportSheet book={meta} onClose={() => setSheet(null)} />}
      {sheet?.type === 'note' && (
        <NoteEditor
          book={book}
          meta={meta}
          pos={sheet.pos}
          note={sheet.note}
          autoRecord={sheet.voice}
          onClose={() => setSheet(null)}
          onSaved={() => reloadNotes()}
        />
      )}
    </div>
  )
}
