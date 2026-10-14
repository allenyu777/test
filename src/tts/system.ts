// 系统语音（Web Speech API）：逐句朗读，提前排队几句，保证连贯
import type { Engine, EngineCallbacks, EngineOptions, Segment, SegmentSource } from './engine'
import { findSystemVoice } from './voices'

const LOOKAHEAD = 3

interface Queued {
  segment: Segment
  utterance: SpeechSynthesisUtterance
  started: boolean
}

export class SystemEngine implements Engine {
  readonly kind = 'system'
  readonly maxChars = 0
  private gen = 0
  private queue: Queued[] = []
  private source: SegmentSource | null = null
  private options: EngineOptions | null = null
  private callbacks: EngineCallbacks | null = null
  private exhausted = false
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private active = false
  private lookahead = LOOKAHEAD
  /** 连续合成失败的次数，避免声音坏掉时一路"跳读"到书末 */
  private failures = 0

  start(source: SegmentSource, options: EngineOptions, callbacks: EngineCallbacks) {
    const wasBusy = speechSynthesis.speaking || speechSynthesis.pending
    this.stop()
    const gen = this.gen
    this.source = source
    this.options = options
    this.callbacks = callbacks
    this.exhausted = false
    this.failures = 0
    this.active = true
    // Safari 在 cancel() 之后立刻 speak() 偶尔会被吞掉，稍等一下再开始
    if (wasBusy) setTimeout(() => gen === this.gen && this.fill(gen), 120)
    else this.fill(gen)
  }

  private fill(gen: number) {
    if (gen !== this.gen || !this.source || !this.options) return
    while (this.queue.length < this.lookahead && !this.exhausted) {
      const segment = this.source.next()
      if (!segment) {
        this.exhausted = true
        break
      }
      this.enqueue(gen, segment)
    }
    if (!this.queue.length && this.exhausted) this.finish(gen)
  }

  private enqueue(gen: number, segment: Segment) {
    const opts = this.options!
    const u = new SpeechSynthesisUtterance(segment.text)
    const voice = opts.voiceId ? findSystemVoice(opts.voiceId) : undefined
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    } else if (opts.lang) u.lang = opts.lang
    u.rate = opts.rate
    u.pitch = 1
    const item: Queued = { segment, utterance: u, started: false }
    u.onstart = () => {
      if (gen !== this.gen) return
      item.started = true
      this.failures = 0
      this.callbacks?.onSentence(segment.sentences[0].pos)
      this.armWatchdog(gen, segment)
    }
    u.onend = () => this.advance(gen, item)
    u.onerror = event => {
      if (gen !== this.gen) return
      const error = (event as SpeechSynthesisErrorEvent).error
      if (error === 'interrupted' || error === 'canceled') return
      if (error === 'not-allowed') {
        this.callbacks?.onError('浏览器阻止了自动朗读，请再点一次播放')
        this.stop()
        return
      }
      if (++this.failures >= 3) {
        this.callbacks?.onError(`当前声音无法朗读（${error}），请换一个声音`)
        this.stop()
        return
      }
      // 偶尔合成失败的句子跳过，继续往下读
      this.advance(gen, item)
    }
    this.queue.push(item)
    speechSynthesis.speak(u)
  }

  private advance(gen: number, item: Queued) {
    if (gen !== this.gen) return
    const idx = this.queue.indexOf(item)
    if (idx < 0) return
    // 有些浏览器会漏掉 onstart，补报一次位置
    if (!item.started) this.callbacks?.onSentence(item.segment.sentences[0].pos)
    this.queue.splice(0, idx + 1)
    this.clearWatchdog()
    this.fill(gen)
  }

  /** iOS 偶尔不触发 onend，超时后强制继续 */
  private armWatchdog(gen: number, segment: Segment) {
    this.clearWatchdog()
    const rate = this.options?.rate ?? 1
    const expected = (segment.text.length / 4) * 1000 / rate
    this.watchdog = setTimeout(() => {
      if (gen !== this.gen) return
      if (!speechSynthesis.speaking && !speechSynthesis.pending && this.queue.length) {
        const head = this.queue[0]
        this.restartFrom(gen, head)
      }
    }, expected * 3 + 6000)
  }

  private restartFrom(gen: number, head: Queued) {
    const rest = this.queue.map(q => q.segment)
    this.queue = []
    speechSynthesis.cancel()
    setTimeout(() => {
      if (gen !== this.gen) return
      // 已经开始读的那句视为读完，没开始的重新读
      for (const seg of rest.slice(head.started ? 1 : 0)) this.enqueue(gen, seg)
      this.fill(gen)
    }, 120)
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
  }

  private finish(gen: number) {
    if (gen !== this.gen) return
    this.active = false
    this.clearWatchdog()
    this.callbacks?.onFinished()
  }

  stop() {
    this.gen++
    this.active = false
    this.queue = []
    this.clearWatchdog()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  /**
   * 页面进入后台时一次性多排队一些句子：
   * iOS 挂起页面脚本后，系统朗读队列仍可能继续读下去
   */
  setLookahead(n: number) {
    this.lookahead = Math.max(1, n)
    if (this.active) this.fill(this.gen)
  }

  pause() {
    return false
  }

  resume() {
    return false
  }

  setRate() {
    return false
  }

  /** 正在朗读但系统语音已经停了（例如被切到后台后中断） */
  isStalled(): boolean {
    return this.active && !speechSynthesis.speaking && !speechSynthesis.pending
  }

  isActive() {
    return this.active
  }
}
