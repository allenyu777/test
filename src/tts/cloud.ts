// 云端神经语音：Azure 语音服务 / OpenAI 兼容接口
// 合成好的音频用同一个 <audio> 连续播放，支持锁屏后台播放和倍速
import { mainAudio, silent } from './audio'
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
  private currentUrl: string | null = null
  /** 当前片段的音频是否已经放进 <audio>（下一段还在下载时为 false） */
  private attached = false
  private cache = new Map<string, Promise<Blob>>()

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
      this.fillGap()
    }, 400)
    let blob: Blob
    try {
      blob = await item.blob
    } catch (e) {
      clearTimeout(slow)
      if (gen !== this.gen) return
      this.stopGap()
      this.callbacks?.onLoading?.(false)
      this.active = false
      this.callbacks?.onError(e instanceof Error ? e.message : String(e))
      return
    }
    clearTimeout(slow)
    if (gen !== this.gen) return
    this.callbacks?.onLoading?.(false)

    const audio = mainAudio()
    audio.loop = false
    const url = URL.createObjectURL(blob)
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl)
    this.currentUrl = url
    const rate = this.options?.rate ?? 1
    audio.onended = () => gen === this.gen && this.playNext(gen)
    audio.ontimeupdate = () => this.track(gen, item.segment)
    audio.onerror = () => gen === this.gen && this.playNext(gen)
    audio.onpause = () => {
      if (gen === this.gen && !this.userPaused && !audio.ended && this.active) this.callbacks?.onPausedExternally?.()
    }
    audio.src = url
    this.attached = true
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
    if (this.userPaused) return
    try {
      await audio.play()
      audio.playbackRate = rate
    } catch (e) {
      if (gen !== this.gen) return
      const name = (e as DOMException)?.name
      if (name === 'AbortError') return
      this.active = false
      this.callbacks?.onError(name === 'NotAllowedError' ? '浏览器阻止了自动播放，请再点一次播放' : '音频播放失败')
    }
  }

  /**
   * 下一段还在下载时先播放静音：锁屏后如果什么都没在播放，iOS 会把页面挂起，下载完也不会接着读
   */
  private fillGap() {
    if (this.userPaused) return
    const audio = mainAudio()
    audio.onended = null
    audio.ontimeupdate = null
    audio.onerror = null
    audio.onpause = null
    audio.loop = true
    audio.src = silent()
    audio.play().catch(() => {})
  }

  private stopGap() {
    const audio = mainAudio()
    if (!audio.loop) return
    audio.loop = false
    audio.pause()
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

  stop() {
    this.gen++
    this.active = false
    this.pending = []
    const audio = mainAudio()
    audio.onended = null
    audio.ontimeupdate = null
    audio.onerror = null
    audio.onpause = null
    audio.loop = false
    audio.pause()
  }

  pause() {
    if (!this.active) return false
    this.userPaused = true
    mainAudio().pause()
    return true
  }

  resume() {
    const audio = mainAudio()
    // <audio> 被别处（如设置页试听）占用过，或当前片段已经播完，就不能原地继续
    if (!this.active || !this.currentUrl) return false
    if (this.attached && audio.src !== this.currentUrl) return false
    this.userPaused = false
    // 下一段还在下载：下载完成后 playNext 会自动开始播放
    if (!this.attached) return true
    audio.playbackRate = this.options?.rate ?? 1
    const gen = this.gen
    audio.play().catch((e: unknown) => {
      if (gen !== this.gen || (e as DOMException)?.name === 'AbortError') return
      this.active = false
      this.callbacks?.onError('音频播放失败，请重试')
    })
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
