// 播放控制：把书、朗读引擎、进度保存、锁屏控件、定时关闭串起来
import { Book, type Pos } from './core/book'
import { cjkRatio, isSpeakable, speechText } from './core/text'
import * as db from './db'
import type { BookMeta } from './db'
import { coverUrl, library, patchBookLocal } from './library'
import { ocrRunner } from './ocr/runner'
import { settings, updateSettings, type VoiceChoice } from './settings'
import { createStore } from './store'
import { primeAudio, setWakeLock, startKeepAlive, stopKeepAlive } from './tts/audio'
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

const END_PUNCT = /[。！？.!?；;…：:”"」』）)]$/

/** 从某个位置开始，按引擎需要的长度切出朗读片段 */
export function createSource(book: Book, from: Pos, maxChars: number, stopAt: () => number | null): SegmentSource {
  let pos: Pos | null = book.speakableFrom(from)
  let first = true
  return {
    next(): Segment | null {
      const limitBlock = stopAt()
      if (!pos || (limitBlock != null && pos.b >= limitBlock)) return null
      const sentences: Segment['sentences'] = []
      let text = ''
      let prevBlock = -1
      const limit = maxChars <= 0 ? 0 : first ? Math.min(maxChars, 60) : maxChars
      while (pos && (limitBlock == null || pos.b < limitBlock)) {
        const t = speechText(book.sentenceText(pos))
        if (sentences.length && (limit === 0 || text.length + t.length > limit)) break
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
  private stopAt: number | null = null
  /** 读到已识别内容的末尾，正在等待后面的页面 */
  private waitingOcr = false
  private saveWarned = false

  constructor() {
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', () => this.onVisibility())
    window.addEventListener('pagehide', () => this.saveNow())
    this.setupMediaSession()
    ocrRunner.onExtended(id => this.onBookExtended(id))
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
    this.meta = meta
    this.book = book
    const pos = book.clamp(meta.pos)
    const s = settings.get()
    const rate = (s.perBookRate && meta.rate) || s.rate
    this.store.set({
      bookId: meta.id,
      status: 'idle',
      loading: false,
      pos,
      rate,
      voice: resolveVoice(meta.voice, meta.lang, s),
      percent: meta.finished ? 100 : book.percent(pos),
      chapter: book.chapterTitle(pos.b),
    })
    this.updateMetadata()
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
      percent: fresh.finished ? 100 : this.book.percent(pos),
      chapter: this.book.chapterTitle(pos.b),
    })
    this.updateMetadata()
  }

  /** 卸下当前的书（例如书被删除时） */
  close() {
    this.engine?.stop()
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
    // 云端音频暂停后原地继续
    if (!from && s.status === 'paused' && this.engine?.resume()) {
      this.setStatus('playing')
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

  skip(direction: 1 | -1) {
    if (!this.book) return
    const p = direction > 0 ? this.book.next(this.state.pos) : this.book.prev(this.state.pos)
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
    const p = book.speakableFrom({ b: target, o: 0 }) ?? { b: target, o: 0 }
    this.seek(p)
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
      this.stopAt = this.book.chapterRange(this.state.pos.b).end
      this.store.set({ sleep: { mode } })
    } else this.store.set({ sleep: { mode: 'off' } })
  }

  private clearSleep() {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    this.stopAt = null
    this.store.set({ sleep: { mode: 'off' } })
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
    // "读完本章"始终指向开始朗读位置所在的章节（往前或往后跳章都会重新计算）
    if (this.stopAt != null) this.stopAt = book.chapterRange(start.b).end
    const source = createSource(book, start, engine.maxChars, () => this.stopAt)
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
    }
    this.setPos(start)
    this.setStatus('playing')
    engine.start(source, { voiceId: voice.id, lang: voice.lang || meta.lang, rate: this.state.rate }, callbacks)
    if (!meta.lastReadAt || Date.now() - meta.lastReadAt > 60000) this.saveNow()
  }

  private stopEngine() {
    this.engine?.stop()
    if (this.state.status === 'playing') this.setStatus('paused')
  }

  private onSentence(engine: Engine, pos: Pos) {
    if (this.engine !== engine) return
    if (this.stopAt != null && pos.b >= this.stopAt) {
      this.sleepNow()
      return
    }
    const sleep = this.state.sleep
    if (sleep.mode === 'minutes' && sleep.endsAt && Date.now() >= sleep.endsAt) {
      this.sleepNow()
      return
    }
    this.setPos(pos)
    this.scheduleSave()
  }

  /** 扫描版正在识别的书，最新的识别状态 */
  private liveOcr() {
    const id = this.meta?.id
    return (id && library.get().books.find(b => b.id === id)?.ocr) || this.meta?.ocr || null
  }

  private onFinished(engine: Engine) {
    if (this.engine !== engine) return
    if (this.stopAt != null) {
      this.clearSleep()
      this.setStatus('paused')
      toast('本章已读完，定时关闭')
      this.saveNow()
      return
    }
    // 扫描版还没识别完：等后面的页面识别出来再接着读
    const ocr = this.liveOcr()
    if (ocr && ocr.status !== 'done') {
      this.saveNow()
      if (ocr.status === 'running') {
        this.waitingOcr = true
        this.store.set({ loading: true })
        toast('后面的页面还在识别，识别好后会自动接着读')
      } else {
        this.setStatus('paused')
        toast(ocr.status === 'paused' ? '文字识别已暂停，继续识别后才能往下读' : `文字识别出错：${ocr.error ?? ''}`, 'error')
      }
      return
    }
    this.finishBook()
  }

  /** 识别出新页面：如果正在等待，就从新内容接着读 */
  private onBookExtended(id: string) {
    if (!this.meta || this.meta.id !== id || !this.book) return
    const ocr = this.liveOcr()
    this.meta.ocr = ocr
    if (!this.waitingOcr) return
    if (this.state.status !== 'playing') {
      this.waitingOcr = false
      return
    }
    const next = this.book.next(this.state.pos)
    if (next) {
      this.waitingOcr = false
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
    this.store.set({ pos, percent: book.percent(pos), chapter })
    if (changedChapter) this.updateMetadata()
  }

  private setStatus(status: PlayStatus) {
    this.store.set({ status, ...(status !== 'playing' ? { loading: false } : {}) })
    const s = settings.get()
    const playing = status === 'playing'
    setWakeLock(playing && s.keepAwake)
    if (playing && this.state.voice.engine === 'system' && s.keepAlive) startKeepAlive()
    else stopKeepAlive()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : status === 'paused' ? 'paused' : 'none'
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
    const patch: Partial<BookMeta> = { pos, percent, chapter, lastReadAt: Date.now() }
    if (meta.finished && percent < 99) patch.finished = false
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
    }
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => this.play()],
      ['pause', () => this.pause()],
      ['stop', () => this.pause()],
      ['previoustrack', () => this.skip(-1)],
      ['nexttrack', () => this.skip(1)],
      ['seekbackward', () => this.skip(-1)],
      ['seekforward', () => this.skip(1)],
    ]
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn)
      } catch {
        // 不支持的操作
      }
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

export const player = new Player()
