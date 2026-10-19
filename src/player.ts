// 播放控制：把书、朗读引擎、进度保存、锁屏控件、定时关闭串起来
import { Book, type Pos } from './core/book'
import { paceOf, recordPace } from './tts/pace'
import { trackListening } from './stats'
import { charsForSeconds, cjkRatio, estimateSeconds, isSpeakable, speechText } from './core/text'
import * as db from './db'
import type { BookMeta, ChapterMark } from './db'
import { coverUrl, library, patchBookLocal, updateBookMeta } from './library'
import { ocrRunner } from './ocr/runner'
import { settings, updateSettings, type VoiceChoice } from './settings'
import { createStore } from './store'
import { primeAudio, setPlaybackSession, setWakeLock, startAudioKeeper, startKeepAlive, stopAudioKeeper, stopKeepAlive } from './tts/audio'
import { CloudEngine, azureProvider, openaiProvider } from './tts/cloud'
import type { Engine, EngineCallbacks, Segment, SegmentSource } from './tts/engine'
import { SystemEngine } from './tts/system'
import { loadSystemVoices, resolveVoice } from './tts/voices'
import { toast } from './ui/toast'

export type PlayStatus = 'idle' | 'playing' | 'paused'

export interface SleepTimer {
  mode: 'off' | 'minutes' | 'chapter'
  endsAt?: number
  minutes?: number
}

export interface PlayerState {
  bookId: string | null
  status: PlayStatus
  loading: boolean
  pos: Pos
  rate: number
  voice: VoiceChoice
  sleep: SleepTimer
  percent: number
  chapter: string
}

// 在一章里往回移动后，原来读到的位置先保留这么久：点错了马上点回来，还能接着原来的地方读
const HOLD_MS = 90_000

const END_PUNCT = /[。！？.!?；;…：:”"」』）)]$/

export interface BookSource extends SegmentSource {
  /** 最后交给引擎的一句及当时的长度（扫描版的下一页可能把这句话补完整） */
  readonly last: { pos: Pos; len: number } | null
}

/** 从某个位置开始，按引擎需要的长度切出朗读片段 */
export function createSource(book: Book, from: Pos, maxChars: number, stopAt: () => number | null): BookSource {
  let pos: Pos | null = book.speakableFrom(from)
  let first = true
  let last: BookSource['last'] = null
  return {
    get last() {
      return last
    },
    next(): Segment | null {
      const limitBlock = stopAt()
      if (!pos || (limitBlock != null && pos.b >= limitBlock)) return null
      const sentences: Segment['sentences'] = []
      let text = ''
      let prevBlock = -1
      const limit = maxChars <= 0 ? 0 : first ? Math.min(maxChars, 60) : maxChars
      while (pos && (limitBlock == null || pos.b < limitBlock)) {
        const raw = book.sentenceText(pos)
        const t = speechText(raw, book.skipNotes)
        if (sentences.length && (limit === 0 || text.length + t.length > limit)) break
        // 读不出来而跳过的句子（例如只有网址）也记下，续读时从它后面接着
        last = { pos, len: raw.length }
        if (t && isSpeakable(t)) {
          if (prevBlock >= 0 && pos.b !== prevBlock) {
            // 段落之间补一个停顿
            if (!END_PUNCT.test(text)) text += cjkRatio(text) > 0.3 ? '。' : '.'
            text += '\n'
          }
          text += t
          sentences.push({ pos, text: t })
          prevBlock = pos.b
        }
        pos = book.next(pos)
      }
      first = false
      return sentences.length ? { sentences, text } : null
    },
  }
}

class Player {
  readonly store = createStore<PlayerState>({
    bookId: null,
    status: 'idle',
    loading: false,
    pos: { b: 0, o: 0 },
    rate: 1,
    voice: { engine: 'system', id: '' },
    sleep: { mode: 'off' },
    percent: 0,
    chapter: '',
  })
  book: Book | null = null
  meta: BookMeta | null = null
  private engine: Engine | null = null
  private systemEngine: SystemEngine | null = null
  private cloudEngines = new Map<string, CloudEngine>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private sleepTimer: ReturnType<typeof setTimeout> | null = null
  /** "读完本章"定时：记下所在章节的某一段，章节的结尾随目录更新实时计算 */
  private chapterTimer: number | null = null
  /** 当前这次朗读的片段来源 */
  private source: BookSource | null = null
  /** 读到已识别内容的末尾，正在等待后面的页面 */
  private waitingOcr = false
  private saveWarned = false

  constructor() {
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', () => this.onVisibility())
    window.addEventListener('pagehide', () => this.saveNow())
    this.setupMediaSession()
    ocrRunner.onExtended(id => this.onBookExtended(id))
    trackListening(this.store)
    settings.subscribe(() => {
      if (!this.book) return
      this.book.skipNotes = !settings.get().readNotes
      this.book.skipQuiet = !settings.get().readExtras
    })
    loadSystemVoices().then(() => {
      // 语音列表加载后，重新确认当前书的声音
      if (this.meta && this.store.get().status === 'idle') {
        this.store.set({ voice: resolveVoice(this.meta.voice, this.meta.lang, settings.get()) })
      }
    })
  }

  get state() {
    return this.store.get()
  }

  /** 打开一本书（若正在播放别的书，会先停下并保存） */
  open(meta: BookMeta, book: Book) {
    if (this.meta?.id === meta.id && this.book === book) return
    if (this.meta) {
      this.stopEngine()
      this.saveNow()
    }
    this.clearSleep()
    this.waitingOcr = false
    this.source = null
    this.meta = meta
    this.book = book
    book.skipNotes = !settings.get().readNotes
    book.skipQuiet = !settings.get().readExtras
    const pos = book.clamp(meta.pos)
    const s = settings.get()
    const rate = (s.perBookRate && meta.rate) || s.rate
    this.rememberChapter(pos, meta.lastReadAt || Date.now())
    this.store.set({
      bookId: meta.id,
      status: 'idle',
      loading: false,
      pos,
      rate,
      voice: resolveVoice(meta.voice, meta.lang, s),
      percent: meta.finished ? 100 : this.percentOf(pos),
      chapter: book.chapterTitle(pos.b),
    })
    this.updateMetadata()
    // 正在听的书优先识别
    const ocr = this.liveOcr()
    if (ocr && ocr.status !== 'done') ocrRunner.prioritize(meta.id)
  }

  /** 外部（如恢复备份）更新了这本书的进度：同步到播放器，不触发保存 */
  reloadMeta(fresh: BookMeta) {
    if (!this.meta || !this.book || this.meta.id !== fresh.id) return
    if (this.engine?.isActive()) this.engine.stop()
    if (this.state.status === 'playing') this.setStatus('paused')
    Object.assign(this.meta, fresh)
    const pos = this.book.clamp(fresh.pos)
    this.store.set({
      pos,
      percent: fresh.finished ? 100 : this.percentOf(pos),
      chapter: this.book.chapterTitle(pos.b),
    })
    this.updateMetadata()
  }

  /** 卸下当前的书（例如书被删除时） */
  close() {
    this.engine?.stop()
    stopAudioKeeper()
    this.engine = null
    this.clearSleep()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.meta = null
    this.book = null
    this.store.set({ bookId: null, status: 'idle', loading: false })
    setWakeLock(false)
    stopKeepAlive()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
    }
  }

  /** 必须在用户点击的同步调用栈中调用，iOS 才允许出声 */
  play(from?: Pos) {
    if (!this.book || !this.meta) return
    const s = this.state
    // 云端语音：暂停时让页面保持活跃要用 Web Audio，在点击里启动（已经在运行时什么都不做）
    if (s.voice.engine !== 'system') startAudioKeeper()
    // 云端音频暂停后原地继续
    if (!from && s.status === 'paused' && this.engine?.resume()) {
      this.setStatus('playing')
      // 暂停太久时锁屏控件已经收起，重新显示
      this.updateMetadata()
      return
    }
    // 云端语音要先异步下载，提前在点击里解锁 <audio>；系统语音会在本次点击中同步开始朗读
    if (s.voice.engine !== 'system') primeAudio()
    this.startEngine(from ?? s.pos)
  }

  pause() {
    this.waitingOcr = false
    if (this.state.status !== 'playing') return
    if (!this.engine?.pause()) this.engine?.stop()
    this.setStatus('paused')
    this.saveNow()
  }

  toggle() {
    if (this.state.status === 'playing') this.pause()
    else this.play()
  }

  /** 跳到某个位置；正在播放时从新位置继续读 */
  seek(pos: Pos, autoplay = this.state.status === 'playing') {
    if (!this.book) return
    const p = this.book.clamp(pos)
    this.setPos(p)
    if (autoplay) this.startEngine(p)
    else if (this.engine?.isActive()) {
      this.engine.stop()
      if (this.state.status === 'playing') this.setStatus('paused')
    }
    this.saveNow()
  }

  /** 后退 / 快进若干秒（按当前语速估算字数，跳到那一句） */
  skipSeconds(seconds: number) {
    const book = this.book
    if (!book || !this.meta) return
    const chars = charsForSeconds(Math.abs(seconds), this.meta.lang, this.state.rate, this.paceCpm()) * Math.sign(seconds)
    const p = book.skipChars(this.state.pos, chars)
    if (p) this.seek(p)
  }

  /** 设置里的后退 / 快进秒数 */
  skipBy(direction: 1 | -1) {
    const s = settings.get()
    this.skipSeconds(direction > 0 ? s.skipForward : -s.skipBack)
  }

  skip(direction: 1 | -1) {
    if (!this.book) return
    const p = direction > 0 ? this.book.next(this.state.pos) : this.book.prev(this.state.pos)
    if (p) this.seek(p)
  }

  /** 跳过正在读的这一段，从下一段开始 */
  skipParagraph() {
    if (!this.book) return
    const p = this.book.next({ b: this.state.pos.b, o: Number.MAX_SAFE_INTEGER })
    if (p) this.seek(p)
  }

  /** 上一章 / 下一章（按目录） */
  skipChapter(direction: 1 | -1) {
    const book = this.book
    if (!book) return
    const { pos } = this.state
    const toc = [...book.toc].sort((a, b) => a.b - b.b)
    let target: number | null = null
    if (direction > 0) {
      target = toc.find(t => t.b > pos.b)?.b ?? null
    } else {
      const range = book.chapterRange(pos.b)
      // 本章开头附近再点"上一章"才回到上一章
      const nearStart = book.charsBetween(range.start, pos.b) + pos.o < 40
      if (!nearStart) target = range.start
      else target = [...toc].reverse().find(t => t.b < range.start)?.b ?? 0
    }
    if (target == null) {
      toast('已经是最后一章')
      return
    }
    // 回到本章开头就从头读（可以一键回到刚才的位置）；换到别的章节时，读过一部分的接着上次的位置读
    if (target === book.chapterRange(pos.b).start) {
      const back = this.chapterResume(target)
      this.seek(book.speakableFrom({ b: target, o: 0 }) ?? { b: target, o: 0 })
      if (back) toast('从本章开头读', 'info', { duration: 5000, action: { label: '回到刚才的位置', run: () => this.seek(back) } })
      return
    }
    const { pos: p, resumed, start } = this.chapterTarget(target)
    this.seek(p)
    if (resumed) this.toastResumed(p, () => this.seek(start))
  }

  /** 这一章上次读到的位置；没读过、离开头很近或已经读完返回 null */
  chapterResume(b: number): Pos | null {
    const book = this.book
    const marks = this.meta?.chapterPos
    if (!book || !marks || !book.blocks.length) return null
    const range = book.chapterRange(Math.min(b, book.blocks.length - 1))
    const best = this.chapterMark(range)?.[1]
    if (!best) return null
    const pos = book.clamp(best)
    if (book.charsBetween(range.start, pos.b) + pos.o < 30) return null
    // 已经读到本章最后一句
    const next = book.next(pos)
    if (!next || next.b >= range.end) return null
    return pos
  }

  /** 跳到某一章的位置：读过一部分就从上次的位置接着读，fromStart 时从头读 */
  chapterTarget(b: number, fromStart = false): { pos: Pos; start: Pos; resumed: boolean } {
    const book = this.book!
    const start = book.speakableFrom({ b, o: 0 }) ?? book.clamp({ b, o: 0 })
    const resume = fromStart ? null : this.chapterResume(b)
    return resume ? { pos: resume, start, resumed: true } : { pos: start, start, resumed: false }
  }

  /** 位置在本章中的进度百分比 */
  chapterPercent(pos: Pos): number {
    const book = this.book
    if (!book) return 0
    const range = book.chapterRange(pos.b)
    const total = Math.max(1, book.charsBetween(range.start, range.end))
    return Math.min(100, ((book.charsBetween(range.start, pos.b) + pos.o) / total) * 100)
  }

  /** 提示"接着上次的位置读"，可以一键改为从头读 */
  toastResumed(pos: Pos, fromStart: () => void) {
    toast(`接着本章上次的位置读（已读 ${Math.floor(this.chapterPercent(pos))}%）`, 'info', {
      duration: 5000,
      action: { label: '从头读', run: fromStart },
    })
  }

  /** 某一章范围内记下的位置（扫描版目录重建后可能留在旧的键下，取最新的） */
  private chapterMark(range: { start: number; end: number }): [string, ChapterMark] | null {
    let best: [string, ChapterMark] | null = null
    for (const [key, m] of Object.entries(this.meta?.chapterPos ?? {})) {
      if (m.b >= range.start && m.b < range.end && (!best || m.t > best[1].t)) best = [key, m]
    }
    return best
  }

  /**
   * 记下当前位置所在章节读到哪里（每章只留一个位置）。
   * 位置往回移动时（点错章节后连续读进了这一章、"上一章"回到本章开头等），原来读到的位置先保留一会儿，
   * 这期间点回这一章还能接着原来的地方读；真的往回重听，过一会儿位置就跟上来了。
   */
  private rememberChapter(pos: Pos, at = Date.now()) {
    const book = this.book
    const meta = this.meta
    if (!book || !meta || !book.blocks.length) return
    const range = book.chapterRange(Math.min(pos.b, book.blocks.length - 1))
    const marks = (meta.chapterPos ??= {})
    const found = this.chapterMark(range)
    for (const [key, m] of Object.entries(marks)) {
      if (m.b >= range.start && m.b < range.end && key !== String(range.start)) delete marks[key]
    }
    const mark = found?.[1]
    if (mark && book.charOffset(pos) < book.charOffset(book.clamp(mark))) {
      if (mark.h == null) {
        marks[range.start] = { ...mark, h: at }
        return
      }
      if (at - mark.h < HOLD_MS) {
        marks[range.start] = mark
        return
      }
    }
    marks[range.start] = { b: pos.b, o: pos.o, t: at }
  }

  /** 清除各章节记下的位置（"从头开始"时） */
  clearChapterMarks(bookId: string) {
    if (this.meta?.id === bookId) this.meta.chapterPos = {}
  }

  setRate(rate: number) {
    const r = Math.round(Math.min(3, Math.max(0.5, rate)) * 100) / 100
    this.store.set({ rate: r })
    if (this.meta) {
      if (settings.get().perBookRate) {
        this.meta.rate = r
        patchBookLocal(this.meta.id, { rate: r })
        db.updateBook(this.meta.id, { rate: r })
      }
    }
    updateSettings({ rate: r })
    this.updatePositionState()
    const applied = this.engine?.isActive() ? this.engine.setRate(r) : false
    if (this.state.status === 'playing' && !applied) this.startEngine(this.state.pos)
  }

  setVoice(voice: VoiceChoice) {
    this.store.set({ voice })
    if (this.meta) {
      this.meta.voice = voice
      patchBookLocal(this.meta.id, { voice })
      db.updateBook(this.meta.id, { voice })
      const lang = this.meta.lang || 'zh'
      updateSettings({ voices: { ...settings.get().voices, [lang]: voice } })
    }
    if (this.state.status === 'playing') {
      // 从系统语音换到云端语音时，要在这次点击里先解锁 <audio>
      if (voice.engine !== 'system') primeAudio()
      this.startEngine(this.state.pos)
    } else if (this.engine?.isActive()) {
      this.engine.stop()
      if (this.state.status === 'paused') this.setStatus('paused')
    }
  }

  /** 设置/取消定时关闭 */
  setSleep(mode: SleepTimer['mode'], minutes = 0) {
    this.clearSleep()
    if (mode === 'minutes' && minutes > 0) {
      const endsAt = Date.now() + minutes * 60000
      this.store.set({ sleep: { mode, minutes, endsAt } })
      this.sleepTimer = setTimeout(() => this.sleepNow(), minutes * 60000)
    } else if (mode === 'chapter' && this.book) {
      this.chapterTimer = this.state.pos.b
      this.store.set({ sleep: { mode } })
    } else this.store.set({ sleep: { mode: 'off' } })
  }

  private clearSleep() {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    this.chapterTimer = null
    this.store.set({ sleep: { mode: 'off' } })
  }

  /**
   * "读完本章"在哪一段停下。
   * 扫描版的这一章还没识别完（章节结尾就是已识别内容的末尾）时还不知道，返回 null。
   */
  private stopBlock(): number | null {
    const book = this.book
    if (this.chapterTimer == null || !book) return null
    const { end } = book.chapterRange(Math.min(this.chapterTimer, book.blocks.length - 1))
    const ocr = this.liveOcr()
    if (end >= book.blocks.length && ocr && ocr.status !== 'done') return null
    return end
  }

  private sleepNow() {
    this.clearSleep()
    if (this.state.status === 'playing') {
      this.pause()
      toast('定时结束，已暂停')
    }
  }

  private getEngine(): Engine {
    const voice = this.state.voice
    const s = settings.get()
    if (voice.engine === 'azure' && s.azure.key) {
      const key = `azure|${s.azure.key}|${s.azure.region}`
      let e = this.cloudEngines.get(key)
      if (!e) {
        e = new CloudEngine(azureProvider(s.azure.key, s.azure.region), 260)
        this.cloudEngines.set(key, e)
      }
      return e
    }
    if (voice.engine === 'openai' && s.openai.baseUrl) {
      const o = s.openai
      const key = `openai|${o.baseUrl}|${o.key}|${o.model}|${o.instructions}`
      let e = this.cloudEngines.get(key)
      if (!e) {
        e = new CloudEngine(openaiProvider(o), 300)
        this.cloudEngines.set(key, e)
      }
      return e
    }
    this.systemEngine ??= new SystemEngine()
    return this.systemEngine
  }

  private startEngine(from: Pos) {
    const book = this.book
    const meta = this.meta
    if (!book || !meta) return
    const start = book.speakableFrom(from)
    if (!start) {
      const ocr = this.liveOcr()
      toast(ocr && ocr.status !== 'done' ? '这一页之后的内容还在识别中，请稍候' : '已经读到全书结尾')
      this.setStatus(ocr && ocr.status !== 'done' ? 'paused' : 'idle')
      return
    }
    this.waitingOcr = false
    const engine = this.getEngine()
    if (this.engine && this.engine !== engine) this.engine.stop()
    this.engine = engine
    this.syncMediaHandlers()
    setPlaybackSession()
    // "读完本章"始终指向开始朗读位置所在的章节（往前或往后跳章都会重新计算）
    if (this.chapterTimer != null) this.chapterTimer = start.b
    const source = createSource(book, start, engine.maxChars, () => this.stopBlock())
    this.source = source
    const voice = this.state.voice
    const callbacks: EngineCallbacks = {
      onSentence: pos => this.onSentence(engine, pos),
      onFinished: () => this.onFinished(engine),
      onError: message => {
        if (this.engine !== engine) return
        this.setStatus('paused')
        this.store.set({ loading: false })
        toast(message, 'error')
      },
      onLoading: loading => this.engine === engine && this.store.set({ loading }),
      onPausedExternally: () => {
        if (this.engine === engine && this.state.status === 'playing') {
          this.setStatus('paused')
          this.saveNow()
        }
      },
      onResumedExternally: () => {
        if (this.engine === engine && this.state.status !== 'playing') this.setStatus('playing')
      },
      onTiming: (chars, seconds) => recordPace(voiceKey(voice), chars, seconds),
      onSuspended: () => {
        if (this.engine === engine && this.state.status !== 'playing') this.closeNowPlaying()
      },
    }
    this.setPos(start)
    this.setStatus('playing')
    // 等待识别时显示的加载状态，换成引擎自己的
    this.store.set({ loading: false })
    engine.start(source, { voiceId: voice.id, lang: voice.lang || meta.lang, rate: this.state.rate }, callbacks)
    if (!meta.lastReadAt || Date.now() - meta.lastReadAt > 60000) this.saveNow()
  }

  private stopEngine() {
    this.engine?.stop()
    if (this.state.status === 'playing') this.setStatus('paused')
  }

  private onSentence(engine: Engine, pos: Pos) {
    if (this.engine !== engine) return
    const stop = this.stopBlock()
    if (stop != null && pos.b >= stop) {
      this.sleepNow()
      return
    }
    // 连续朗读进入了下一章：上一章读完了，以后再点它从头读
    const book = this.book
    if (book && this.meta?.chapterPos) {
      const prev = book.chapterRange(this.state.pos.b)
      if (pos.b >= prev.end && book.chapterRange(pos.b).start === prev.end) {
        for (const [key, m] of Object.entries(this.meta.chapterPos)) if (m.b >= prev.start && m.b < prev.end) delete this.meta.chapterPos[key]
      }
    }
    const sleep = this.state.sleep
    if (sleep.mode === 'minutes' && sleep.endsAt && Date.now() >= sleep.endsAt) {
      this.sleepNow()
      return
    }
    this.setPos(pos)
    this.scheduleSave()
  }

  /**
   * 这次朗读结束后接着读的位置（引擎只报告每个片段的第一句，所以以交给引擎的最后一句为准）。
   * 扫描版的下一页可能把最后一句话补完整（跨页的句子），这时从这句话开头重读。
   */
  private continuePos(): Pos | null {
    const book = this.book
    const last = this.source?.last
    if (!book || !last) return null
    if (book.sentenceText(last.pos).length > last.len) return last.pos
    return book.next(last.pos)
  }

  /** 扫描版正在识别的书，最新的识别状态 */
  private liveOcr() {
    const id = this.meta?.id
    return (id && library.get().books.find(b => b.id === id)?.ocr) || this.meta?.ocr || null
  }

  private onFinished(engine: Engine) {
    if (this.engine !== engine) return
    // 朗读期间可能又识别出了新的页面
    const next = this.continuePos()
    if (this.chapterTimer != null) {
      const stop = this.stopBlock()
      if (stop != null && (!next || next.b >= stop)) {
        this.clearSleep()
        this.setStatus('paused')
        toast('本章已读完，定时关闭')
        this.saveNow()
        return
      }
    }
    if (next) {
      this.startEngine(next)
      return
    }
    // 扫描版还没识别完：等后面的页面识别出来再接着读
    const ocr = this.liveOcr()
    if (ocr && ocr.status !== 'done') {
      this.saveNow()
      if (ocr.status === 'running') {
        this.waitingOcr = true
        this.store.set({ loading: true })
        if (this.meta) ocrRunner.prioritize(this.meta.id)
        toast('后面的页面还在识别，识别好后会自动接着读')
      } else {
        this.setStatus('paused')
        toast(ocr.status === 'paused' ? '文字识别已暂停，继续识别后才能往下读' : `文字识别出错：${ocr.error ?? ''}`, 'error')
      }
      return
    }
    this.finishBook()
  }

  /** 识别出新页面：更新进度显示；如果正在等待，就从新内容接着读 */
  private onBookExtended(id: string) {
    if (!this.meta || this.meta.id !== id || !this.book) return
    const ocr = this.liveOcr()
    this.meta.ocr = ocr
    // 总页数里识别好的比例变了，进度百分比和章节名跟着更新
    if (!this.meta.finished) this.setPos(this.state.pos)
    if (!this.waitingOcr) return
    if (this.state.status !== 'playing') {
      this.waitingOcr = false
      return
    }
    const next = this.continuePos()
    if (next) {
      this.waitingOcr = false
      const stop = this.stopBlock()
      if (stop != null && next.b >= stop) {
        this.clearSleep()
        this.setStatus('paused')
        toast('本章已读完，定时关闭')
        this.saveNow()
        return
      }
      this.startEngine(next)
    } else if (!ocr || ocr.status === 'done') {
      this.waitingOcr = false
      this.finishBook()
    } else if (ocr.status !== 'running') {
      this.waitingOcr = false
      this.setStatus('paused')
      toast(ocr.status === 'paused' ? '文字识别已暂停' : `文字识别出错：${ocr.error ?? ''}`, 'error')
    }
  }

  /**
   * 标记已读完 / 移回在读（书架分组用）。
   * 只有这里、读到全书结尾、"从头开始"会改变这个标记；之后再听其中的章节，书仍然留在"已读完"
   */
  async setFinished(id: string, finished: boolean) {
    if (this.meta?.id === id) this.meta.finished = finished
    await updateBookMeta(id, { finished })
  }

  private finishBook() {
    this.setStatus('idle')
    // 读完时进度记为 100%，之后再保存也不会把"已读完"改回去
    this.store.set({ percent: 100 })
    this.saveNow()
    if (this.meta) {
      this.meta.finished = true
      patchBookLocal(this.meta.id, { finished: true })
      db.updateBook(this.meta.id, { finished: true })
    }
    toast('全书已经读完 🎉', 'success')
  }

  private setPos(pos: Pos) {
    const book = this.book
    if (!book) return
    const chapter = book.chapterTitle(pos.b)
    const changedChapter = chapter !== this.state.chapter
    this.rememberChapter(pos)
    this.store.set({ pos, percent: this.percentOf(pos), chapter })
    if (changedChapter) this.updateMetadata()
    this.updatePositionState()
  }

  /** 当前声音实际的朗读速度（1 倍速每分钟字数；还没测到时为 undefined，按语言估算） */
  paceCpm(): number | undefined {
    return paceOf(voiceKey(this.state.voice))
  }

  /** 本章（目录里的一项，例如"第二节"）的估计总时长和已读时长（秒），锁屏进度条按它显示 */
  chapterTime(pos = this.state.pos): { duration: number; position: number; start: number; end: number } | null {
    const book = this.book
    if (!book || !this.meta) return null
    const { start, end } = book.chapterRange(pos.b)
    const total = book.charsBetween(start, end)
    const done = Math.min(total, book.charsBetween(start, pos.b) + pos.o)
    const lang = this.meta.lang
    const rate = this.state.rate
    const cpm = this.paceCpm()
    return { duration: estimateSeconds(total, lang, rate, cpm), position: estimateSeconds(done, lang, rate, cpm), start, end }
  }

  /**
   * 告诉系统本章的总时长和当前位置：锁屏和控制中心显示整章的进度，
   * 而不是正在播放的那一小段音频（云端语音一段只有一两句）
   */
  private updatePositionState() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession as MediaSession & { setPositionState?: (state?: MediaPositionState) => void }
    const t = this.chapterTime()
    if (!ms.setPositionState || !t) return
    const duration = Math.max(1, t.duration)
    try {
      ms.setPositionState({ duration, position: Math.min(t.position, duration), playbackRate: 1 })
    } catch {
      // 旧系统不支持
    }
  }

  /** 锁屏进度条拖到本章的某个时间 */
  private seekToTime(seconds: number) {
    const book = this.book
    const t = this.chapterTime()
    if (!book || !t || !t.duration) return
    const total = book.charsBetween(t.start, t.end)
    const target = book.cum[t.start] + Math.min(1, Math.max(0, seconds / t.duration)) * total
    this.seek(book.posAtChar(Math.min(target, book.cum[t.end] - 1)))
  }

  /** 进度百分比；扫描版还没识别完时按已识别页数占总页数的比例折算 */
  private percentOf(pos: Pos): number {
    const book = this.book
    if (!book) return 0
    const percent = book.percent(pos)
    const ocr = this.liveOcr()
    if (!ocr || ocr.status === 'done' || !ocr.pages) return percent
    return (percent * Math.min(ocr.done, ocr.pages)) / ocr.pages
  }

  private setStatus(status: PlayStatus) {
    this.store.set({ status, ...(status !== 'playing' ? { loading: false } : {}) })
    const s = settings.get()
    const playing = status === 'playing'
    setWakeLock(playing && s.keepAwake)
    if (playing && this.state.voice.engine === 'system' && s.keepAlive) startKeepAlive()
    else stopKeepAlive()
    // 读完、出错等真正停下时，不再需要让页面保持活跃（云端语音暂停时引擎仍在，保持 5 分钟）
    if (!playing && !this.engine?.isActive()) stopAudioKeeper()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : status === 'paused' ? 'paused' : 'none'
      this.updatePositionState()
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 2000)
  }

  /** 立即保存当前进度 */
  saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const meta = this.meta
    const book = this.book
    if (!meta || !book) return
    const { pos, percent, chapter } = this.state
    const patch: Partial<BookMeta> = { pos, percent, chapter, lastReadAt: Date.now(), chapterPos: { ...meta.chapterPos } }
    Object.assign(meta, patch)
    patchBookLocal(meta.id, patch)
    db.updateBook(meta.id, patch).catch(() => {
      // 只提示一次，避免刷屏
      if (this.saveWarned) return
      this.saveWarned = true
      toast('阅读进度保存失败，请关闭后重新打开应用', 'error', { duration: 8000 })
    })
  }

  private onVisibility() {
    const engine = this.engine
    if (document.visibilityState === 'hidden') {
      this.saveNow()
      // 进入后台：系统语音一次排队更多句子
      if (engine instanceof SystemEngine && this.state.status === 'playing') engine.setLookahead(150)
    } else {
      if (engine instanceof SystemEngine) {
        engine.setLookahead(3)
        // 回到前台时如果朗读已经中断，从当前句继续
        if (this.state.status === 'playing' && engine.isStalled()) this.startEngine(this.state.pos)
      }
      setPlaybackSession()
      // 云端语音：回到前台时马上检查是不是真的在播放
      if (engine instanceof CloudEngine && this.state.status === 'playing') engine.ensurePlaying()
    }
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    this.syncMediaHandlers()
    const handlers: [MediaSessionAction, () => void][] = [
      ['previoustrack', () => this.skip(-1)],
      ['nexttrack', () => this.skip(1)],
      ['seekbackward', () => this.skipBy(-1)],
      ['seekforward', () => this.skipBy(1)],
    ]
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn)
      } catch {
        // 不支持的操作
      }
    }
    try {
      ms.setActionHandler('seekto', details => {
        if (details.seekTime != null) this.seekToTime(details.seekTime)
      })
    } catch {
      // 不支持拖动进度条
    }
  }

  /**
   * 锁屏控件、耳机的播放 / 暂停。云端语音暂停时会用静音占着音频（见 CloudEngine.pause），页面不会被挂起，
   * 这里的代码能马上执行。锁屏上显示的按钮可能和实际状态不一致，所以按"切换"处理
   */
  private syncMediaHandlers() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const actions: [MediaSessionAction, () => void][] = [
      ['play', () => this.state.status !== 'playing' && this.play()],
      ['pause', () => (this.state.status === 'playing' ? this.pause() : this.play())],
      ['stop', () => this.pause()],
    ]
    for (const [action, fn] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, fn)
      } catch {
        // 不支持的操作
      }
    }
  }

  /** 暂停太久：收起锁屏和控制中心里的播放控件（再播放时 updateMetadata 会重新显示） */
  private closeNowPlaying() {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      ;(navigator.mediaSession as MediaSession & { setPositionState?: (s?: MediaPositionState) => void }).setPositionState?.()
    } catch {
      // 忽略
    }
  }

  private updateMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !this.meta) return
    const cover = coverUrl(this.meta)
    const artwork = cover
      ? [{ src: cover, sizes: '320x480', type: this.meta.coverType || 'image/jpeg' }]
      : [{ src: new URL('icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }]
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.state.chapter || this.meta.title,
        artist: this.meta.author || '听书',
        album: this.meta.title,
        artwork,
      })
    } catch {
      // 忽略
    }
  }
}

/** 声音的标识（引擎 + 声音名），朗读速度按它分别记录 */
function voiceKey(voice: { engine: string; id: string }): string {
  return `${voice.engine}:${voice.id}`
}

export const player = new Player()
