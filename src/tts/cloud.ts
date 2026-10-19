// 云端神经语音：Azure 语音服务 / OpenAI 兼容接口
// 合成好的音频用同一个 <audio> 连续播放，支持锁屏后台播放和倍速
import { mainAudio, silent, startAudioKeeper, stopAudioKeeper } from './audio'
import type { Engine, EngineCallbacks, EngineOptions, Segment, SegmentSource } from './engine'

export interface CloudProvider {
  readonly name: string
  synthesize(text: string, voice: string, lang: string): Promise<Blob>
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

async function httpError(res: Response, service: string): Promise<TtsError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 200)
  } catch {
    detail = ''
  }
  if (res.status === 401 || res.status === 403) return new TtsError(`${service}：密钥无效或没有权限（${res.status}）`)
  if (res.status === 429) return new TtsError(`${service}：请求太频繁或额度已用完，请稍后再试`, true)
  if (res.status >= 500) return new TtsError(`${service}：服务暂时不可用（${res.status}）`, true)
  return new TtsError(`${service}：请求失败（${res.status}）${detail ? ' ' + detail : ''}`)
}

function networkError(service: string, e: unknown): TtsError {
  if (e instanceof TtsError) return e
  return new TtsError(`${service}：无法连接，请检查网络或接口地址`, true)
}

/** 请求超时：网络切换（Wi-Fi ↔ 蜂窝）时请求可能一直挂着不返回 */
const REQUEST_TIMEOUT = 25_000

async function fetchWithTimeout(url: string, init: RequestInit, service: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    throw networkError(service, e)
  } finally {
    clearTimeout(timer)
  }
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function azureProvider(key: string, region: string): CloudProvider {
  const endpoint = `https://${region.trim()}.tts.speech.microsoft.com/cognitiveservices/v1`
  return {
    name: 'Azure',
    async synthesize(text, voice, lang) {
      const locale = voice.split('-').slice(0, 2).join('-') || lang || 'zh-CN'
      const body = xmlEscape(text).replace(/\n+/g, '<break time="350ms"/>')
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
        `<voice name="${xmlEscape(voice)}">${body}</voice></speak>`
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key.trim(),
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          },
          body: ssml,
        },
        'Azure',
      )
      if (!res.ok) throw await httpError(res, 'Azure')
      try {
        return await res.blob()
      } catch (e) {
        throw networkError('Azure', e)
      }
    },
  }
}

/** 拉取 Azure 当前区域可用的全部声音 */
export async function fetchAzureVoices(key: string, region: string) {
  const res = await fetch(`https://${region.trim()}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': key.trim() },
  })
  if (!res.ok) throw await httpError(res, 'Azure')
  const list = (await res.json()) as { ShortName: string; LocalName: string; Locale: string; Gender: string }[]
  return list
}

export interface OpenAIConfig {
  baseUrl: string
  key: string
  model: string
  instructions: string
}

export function openaiProvider(cfg: OpenAIConfig): CloudProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  return {
    name: 'OpenAI',
    async synthesize(text, voice) {
      const payload: Record<string, unknown> = { model: cfg.model, voice, input: text, response_format: 'mp3' }
      if (cfg.instructions && /gpt-4o/i.test(cfg.model)) payload.instructions = cfg.instructions
      const res = await fetchWithTimeout(
        `${base}/audio/speech`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.key ? { Authorization: `Bearer ${cfg.key.trim()}` } : {}),
          },
          body: JSON.stringify(payload),
        },
        'OpenAI',
      )
      if (!res.ok) throw await httpError(res, 'OpenAI')
      try {
        return await res.blob()
      } catch (e) {
        throw networkError('OpenAI', e)
      }
    },
  }
}

const PREFETCH = 4
const CACHE_SIZE = 40
/** 网络出错后每次重试前等待的时间；断网时先等网络恢复 */
const RETRY_DELAYS = [1500, 3000, 5000, 8000, 12000]

/** 暂停后用静音占着音频的最长时间（之后真正停下、关掉锁屏控件，省电） */
const SOFT_PAUSE_MS = 5 * 60_000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 断网时等网络恢复（最多 max 毫秒） */
function waitOnline(max: number): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('online', done)
      resolve()
    }
    const timer = setTimeout(done, max)
    window.addEventListener('online', done)
  })
}

/** 句子在音频中所占的大致时长权重 */
function weight(text: string): number {
  let w = 1.5
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c >= 0x2e80) w += 1
    else if (/[A-Za-z0-9]/.test(ch)) w += 0.32
    else if (/[,.;:!?，。；：！？、]/.test(ch)) w += 0.8
  }
  return w
}

export class CloudEngine implements Engine {
  readonly kind = 'cloud'
  private gen = 0
  private pending: { segment: Segment; blob: Promise<Blob> }[] = []
  private source: SegmentSource | null = null
  private options: EngineOptions | null = null
  private callbacks: EngineCallbacks | null = null
  private exhausted = false
  private active = false
  private userPaused = false
  private lastIndex = -1
  /** 当前这一段的音频 */
  private current: { url: string; segment: Segment } | null = null
  /** 暂停时这一段播到的秒数（继续时从这里接着播） */
  private parkedTime: number | null = null
  private softTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前片段的音频是否已经放进 <audio>（下一段还在下载时为 false） */
  private attached = false
  private cache = new Map<string, Promise<Blob>>()
  /** 检查"应该在播放"时音频是不是真的在播放 */
  private watchdog: ReturnType<typeof setInterval> | null = null
  private stuck = 0
  private lastTime = -1

  constructor(
    private provider: CloudProvider,
    readonly maxChars = 220,
  ) {}

  start(source: SegmentSource, options: EngineOptions, callbacks: EngineCallbacks) {
    this.stop()
    this.source = source
    this.options = options
    this.callbacks = callbacks
    this.exhausted = false
    this.active = true
    this.userPaused = false
    const gen = this.gen
    this.prefetch()
    this.playNext(gen)
    this.stuck = 0
    this.watchdog = setInterval(() => this.ensurePlaying(), 1000)
  }

  /**
   * 应该在播放却没有声音时（iOS 在后台、锁屏时可能拒绝或打断播放），重新让音频播放；
   * 试了几次还不行，就把状态改成暂停，界面显示"播放"按钮，点一下就能继续（不会出现显示在播放、其实没声音）
   */
  ensurePlaying() {
    if (!this.active || this.userPaused) return
    const audio = mainAudio()
    // 正在下载下一段，也没有播放静音：等下载完成
    if (!this.attached && !audio.loop) return
    if (audio.ended) return
    const moving = !audio.paused && audio.currentTime !== this.lastTime
    this.lastTime = audio.currentTime
    // 正在播放、只是在缓冲：不算停住
    if (moving || (!audio.paused && audio.readyState < 2)) {
      this.stuck = 0
      return
    }
    this.stuck++
    const gen = this.gen
    if (this.stuck <= 2) {
      // 停住了：暂停一下再播放（和手动点暂停、播放的效果一样）
      if (!audio.paused) audio.pause()
      audio.play().catch(() => {})
    } else if (gen === this.gen) {
      this.stuck = 0
      this.userPaused = true
      audio.pause()
      this.callbacks?.onPausedExternally?.()
    }
  }

  private fetchSegment(segment: Segment): Promise<Blob> {
    const opts = this.options!
    const key = `${opts.voiceId}|${segment.text}`
    let p = this.cache.get(key)
    if (!p) {
      // 网络问题（断网、超时、服务繁忙）多试几次，不要一出错就暂停
      p = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await this.provider.synthesize(segment.text, opts.voiceId, opts.lang)
          } catch (e) {
            if ((e instanceof TtsError && !e.retryable) || attempt >= RETRY_DELAYS.length) throw e
            await waitOnline(60_000)
            await sleep(RETRY_DELAYS[attempt])
          }
        }
      })()
      p.catch(() => this.cache.delete(key))
      this.cache.set(key, p)
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }

  private prefetch() {
    while (this.pending.length < PREFETCH && !this.exhausted && this.source) {
      const segment = this.source.next()
      if (!segment) {
        this.exhausted = true
        break
      }
      this.pending.push({ segment, blob: this.fetchSegment(segment) })
    }
  }

  private async playNext(gen: number) {
    if (gen !== this.gen) return
    const item = this.pending.shift()
    if (item) this.attached = false
    if (!item) {
      if (this.exhausted) {
        this.active = false
        this.callbacks?.onFinished()
      }
      return
    }
    this.prefetch()
    this.lastIndex = 0
    this.callbacks?.onSentence(item.segment.sentences[0].pos)
    const slow = setTimeout(() => {
      if (gen !== this.gen) return
      this.callbacks?.onLoading?.(true)
      if (!this.userPaused) this.playSilence()
    }, 400)
    let blob: Blob
    try {
      blob = await item.blob
    } catch (e) {
      clearTimeout(slow)
      if (gen !== this.gen) return
      this.stopSilence()
      this.callbacks?.onLoading?.(false)
      this.active = false
      this.callbacks?.onError(e instanceof Error ? e.message : String(e))
      return
    }
    clearTimeout(slow)
    if (gen !== this.gen) return
    this.callbacks?.onLoading?.(false)

    const url = URL.createObjectURL(blob)
    if (this.current) URL.revokeObjectURL(this.current.url)
    this.current = { url, segment: item.segment }
    // 暂停期间下载好的：记下来，继续时从头播放这一段
    if (this.userPaused) {
      this.parkedTime = 0
      return
    }
    this.attachSpeech(gen, 0)
  }

  /** 把当前这一段的音频放进 <audio> 并从 time 秒开始播放 */
  private attachSpeech(gen: number, time: number) {
    const current = this.current
    if (!current) return
    const audio = mainAudio()
    const rate = this.options?.rate ?? 1
    audio.loop = false
    audio.onended = () => gen === this.gen && this.playNext(gen)
    audio.ontimeupdate = () => this.track(gen, current.segment)
    audio.onerror = () => gen === this.gen && this.playNext(gen)
    this.listenExternal(gen)
    audio.src = current.url
    this.attached = true
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
    if (time === 0) {
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (gen === this.gen && audio.src === current.url && isFinite(audio.duration)) {
            this.callbacks?.onTiming?.(current.segment.text.replace(/\s+/g, '').length, audio.duration)
          }
        },
        { once: true },
      )
    }
    if (time > 0) {
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (gen === this.gen && audio.src === current.url) audio.currentTime = time
        },
        { once: true },
      )
    }
    audio
      .play()
      .then(() => {
        audio.playbackRate = rate
      })
      .catch((e: unknown) => {
        if (gen !== this.gen) return
        const name = (e as DOMException)?.name
        if (name === 'AbortError') return
        this.active = false
        this.callbacks?.onError(name === 'NotAllowedError' ? '浏览器阻止了自动播放，请再点一次播放' : '音频播放失败')
      })
  }

  /**
   * 下一段还在下载时播放循环的静音：锁屏后如果什么都没在播放，iOS 会把页面挂起，下载完也不会接着读
   */
  private playSilence() {
    const audio = mainAudio()
    audio.onended = null
    audio.ontimeupdate = null
    audio.onerror = null
    this.listenExternal(this.gen)
    audio.loop = true
    if (!audio.src.startsWith(silent())) audio.src = silent()
    if (audio.paused) audio.play().catch(() => {})
  }

  private stopSilence() {
    const audio = mainAudio()
    if (!audio.loop) return
    audio.loop = false
    audio.pause()
  }

  /**
   * 锁屏控件、耳机、来电让音频暂停或继续时同步播放状态。
   * 换音频地址时也可能触发 pause 事件，那时已经接着在播放（audio.paused 为 false），不算暂停
   */
  private listenExternal(gen: number) {
    const audio = mainAudio()
    audio.onpause = () => {
      if (gen !== this.gen || !this.active || audio.ended || !audio.paused || this.userPaused) return
      this.userPaused = true
      if (this.attached && this.current) {
        this.parkedTime = audio.currentTime
        this.attached = false
      }
      this.callbacks?.onPausedExternally?.()
    }
    audio.onplay = () => {
      if (gen !== this.gen || !this.active || !this.userPaused) return
      this.userPaused = false
      this.parkedTime = null
      this.attached = !audio.loop
      this.callbacks?.onResumedExternally?.()
    }
  }

  private track(gen: number, segment: Segment) {
    const audio = mainAudio()
    if (gen !== this.gen || !audio.duration || !isFinite(audio.duration)) return
    const sentences = segment.sentences
    if (sentences.length < 2) return
    const weights = sentences.map(s => weight(s.text))
    const total = weights.reduce((a, b) => a + b, 0)
    const target = (audio.currentTime / audio.duration) * total
    let acc = 0
    let index = sentences.length - 1
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i]
      if (acc > target) {
        index = i
        break
      }
    }
    if (index !== this.lastIndex) {
      this.lastIndex = index
      this.callbacks?.onSentence(sentences[index].pos)
    }
  }

  private clearSoftPause() {
    if (this.softTimer) clearTimeout(this.softTimer)
    this.softTimer = null
  }

  stop() {
    this.gen++
    this.active = false
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.clearSoftPause()
    this.parkedTime = null
    this.pending = []
    const audio = mainAudio()
    audio.onended = null
    audio.ontimeupdate = null
    audio.onerror = null
    audio.onpause = null
    audio.onplay = null
    audio.loop = false
    audio.pause()
  }

  /**
   * 暂停：记下这一段播到哪里，<audio> 真正暂停（锁屏控件显示"播放"按钮），
   * 用听不见的 Web Audio 让页面保持活跃，锁屏上点播放能马上继续（见 startAudioKeeper）
   */
  pause() {
    if (!this.active) return false
    const audio = mainAudio()
    this.userPaused = true
    if (this.attached && this.current) {
      this.parkedTime = audio.currentTime
      this.attached = false
    }
    audio.onpause = null
    audio.onplay = null
    audio.loop = false
    audio.pause()
    startAudioKeeper()
    this.clearSoftPause()
    this.softTimer = setTimeout(() => {
      this.softTimer = null
      if (!this.userPaused) return
      // 真正停下：卸掉音频，iOS 会把锁屏上的播放控件收起来；继续时 resume 会把这一段重新放回去
      const audio = mainAudio()
      audio.loop = false
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      stopAudioKeeper()
      this.callbacks?.onSuspended?.()
    }, SOFT_PAUSE_MS)
    return true
  }

  resume() {
    if (!this.active) return false
    this.clearSoftPause()
    this.userPaused = false
    this.stuck = 0
    this.lastTime = -1
    // 从暂停的位置接着播放
    if (this.current && this.parkedTime != null) {
      const time = this.parkedTime
      this.parkedTime = null
      this.attachSpeech(this.gen, time)
      return true
    }
    // 下一段还在下载：先播放静音，下载完成后 playNext 会自动开始播放
    if (!this.attached) {
      this.playSilence()
      return true
    }
    const audio = mainAudio()
    if (audio.paused) audio.play().catch(() => {})
    return true
  }

  setRate(rate: number) {
    if (this.options) this.options.rate = rate
    const audio = mainAudio()
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
    return true
  }

  isActive() {
    return this.active
  }
}
