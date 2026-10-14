// 声音列表：系统语音、Azure 神经语音、OpenAI 兼容接口
import { baseLang } from '../core/text'
import type { EngineId, Settings, VoiceChoice } from '../settings'
import { engineReady } from '../settings'

export type Quality = 'premium' | 'enhanced' | 'standard' | 'novelty'

export interface VoiceOption {
  engine: EngineId
  id: string
  name: string
  lang: string
  quality: Quality
  desc?: string
}

const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Junior|Ralph|Fred|Kathy|Princess|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i

export function voiceQuality(v: SpeechSynthesisVoice): Quality {
  const s = `${v.name} ${v.voiceURI}`
  if (/eloquence|speech\.synthesis\.voice/i.test(v.voiceURI) || NOVELTY.test(v.name)) return 'novelty'
  if (/premium|高级|高級|优质|優質|natural|neural|siri/i.test(s)) return 'premium'
  if (/enhanced|增强|增強|加强|google|online/i.test(s)) return 'enhanced'
  return 'standard'
}

export function cleanVoiceName(name: string): string {
  return name
    .replace(/\s*[(（](enhanced|premium|增强|增強|高级|高級|优质|優質)[)）]\s*/gi, '')
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s+Online\s*\(Natural\)/i, '')
    .trim()
}

let displayNames: Intl.DisplayNames | null = null
export function langLabel(lang: string): string {
  const l = lang.replace('_', '-')
  const special: Record<string, string> = {
    'zh-CN': '普通话（中国大陆）',
    'zh-TW': '国语（台湾）',
    'zh-HK': '粤语（香港）',
    'yue-HK': '粤语（香港）',
    'en-US': '英语（美国）',
    'en-GB': '英语（英国）',
    'en-AU': '英语（澳大利亚）',
    'en-IN': '英语（印度）',
    'ja-JP': '日语',
  }
  if (special[l]) return special[l]
  try {
    displayNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'language' })
    return displayNames.of(l) ?? l
  } catch {
    return l
  }
}

let cachedVoices: SpeechSynthesisVoice[] = []
const voiceListeners = new Set<() => void>()

/** 系统声音列表变化时通知（例如刚在系统设置里下载了新声音） */
export function onVoicesChanged(fn: () => void): () => void {
  voiceListeners.add(fn)
  return () => {
    voiceListeners.delete(fn)
  }
}

if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoices = speechSynthesis.getVoices()
    voiceListeners.forEach(fn => fn())
  })
}

/** 获取系统语音（iOS/Chrome 需要等待 voiceschanged） */
export function loadSystemVoices(timeout = 2500): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length) {
    cachedVoices = now
    return Promise.resolve(now)
  }
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      cachedVoices = speechSynthesis.getVoices()
      resolve(cachedVoices)
    }
    speechSynthesis.addEventListener?.('voiceschanged', finish, { once: true })
    const started = Date.now()
    const poll = () => {
      if (done) return
      if (speechSynthesis.getVoices().length || Date.now() - started > timeout) finish()
      else setTimeout(poll, 150)
    }
    poll()
  })
}

export function systemVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return []
  const v = speechSynthesis.getVoices()
  if (v.length) cachedVoices = v
  return cachedVoices
}

export function findSystemVoice(id: string): SpeechSynthesisVoice | undefined {
  if (isAutoVoice(id)) return undefined
  return systemVoices().find(v => v.voiceURI === id || v.name === id)
}

/**
 * "跟随系统设置"：不指定具体声音，只告诉系统用哪种语言读，由系统自己挑声音。
 * iPhone 只把自带的基础声音列给网页（防止设备指纹追踪），在「朗读内容」里另外下载的声音不会出现在列表里；
 * 不指定声音时，部分 iOS 版本会用「朗读内容」里为这种语言选中的声音，有可能用上下载的高品质声音。
 */
const AUTO_PREFIX = 'auto:'

export function isAutoVoice(id: string | undefined): boolean {
  return !!id && id.startsWith(AUTO_PREFIX)
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function autoVoiceName(): string {
  return isIOS() ? '跟随 iPhone 设置' : '跟随系统设置'
}

const MAIN_LOCALE: Record<string, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }

/** 这本书语言的每个地区（普通话、台湾国语、粤语…）各一个"跟随系统设置"选项 */
export function autoVoiceOptions(lang?: string): VoiceOption[] {
  const base = baseLang(lang)
  if (!base) return []
  const locales = new Set<string>()
  for (const v of systemVoices()) {
    if (baseLang(v.lang) === base || (base === 'zh' && /^yue/i.test(v.lang))) locales.add(v.lang.replace('_', '-'))
  }
  const main = MAIN_LOCALE[base] ?? base
  locales.add(main)
  return [...locales]
    .sort((a, b) => Number(b === main) - Number(a === main) || a.localeCompare(b))
    .map(locale => ({
      engine: 'system' as const,
      id: AUTO_PREFIX + locale,
      name: autoVoiceName(),
      lang: locale,
      quality: 'standard' as const,
      desc: '实验',
    }))
}

const QUALITY_RANK: Record<Quality, number> = { premium: 3, enhanced: 2, standard: 1, novelty: -5 }

/** 系统语音按语言过滤并按质量排序 */
export function systemVoiceOptions(lang?: string): VoiceOption[] {
  const base = baseLang(lang)
  return systemVoices()
    .filter(v => !base || baseLang(v.lang) === base || (base === 'zh' && /^yue/i.test(v.lang)))
    .map(v => ({
      engine: 'system' as const,
      id: v.voiceURI || v.name,
      name: cleanVoiceName(v.name),
      lang: v.lang,
      quality: voiceQuality(v),
      desc: v.localService === false ? '在线' : undefined,
    }))
    .sort(
      (a, b) =>
        QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] ||
        Number(/^zh-CN|^en-US/i.test(b.lang)) - Number(/^zh-CN|^en-US/i.test(a.lang)) ||
        a.lang.localeCompare(b.lang) ||
        a.name.localeCompare(b.name),
    )
}

/** Azure 精选声音（完整列表可在设置里联网获取） */
export const AZURE_VOICES: VoiceOption[] = [
  ['zh-CN-XiaoxiaoNeural', '晓晓', '女声 · 温暖亲切，适合大多数书'],
  ['zh-CN-YunxiNeural', '云希', '男声 · 阳光自然，适合小说'],
  ['zh-CN-YunjianNeural', '云健', '男声 · 浑厚有力'],
  ['zh-CN-XiaoyiNeural', '晓伊', '女声 · 活泼'],
  ['zh-CN-YunyangNeural', '云扬', '男声 · 新闻播音'],
  ['zh-CN-XiaochenNeural', '晓辰', '女声 · 轻松随和'],
  ['zh-CN-XiaohanNeural', '晓涵', '女声 · 温柔'],
  ['zh-CN-XiaomoNeural', '晓墨', '女声 · 知性'],
  ['zh-CN-XiaoqiuNeural', '晓秋', '女声 · 沉稳'],
  ['zh-CN-XiaoruiNeural', '晓睿', '女声 · 年长'],
  ['zh-CN-YunyeNeural', '云野', '男声 · 讲故事'],
  ['zh-CN-YunzeNeural', '云泽', '男声 · 年长'],
  ['zh-CN-YunfengNeural', '云枫', '男声 · 有个性'],
  ['zh-CN-XiaoxiaoMultilingualNeural', '晓晓（多语言）', '女声 · 中英混读'],
  ['zh-CN-liaoning-XiaobeiNeural', '晓北', '女声 · 东北话'],
  ['zh-CN-shaanxi-XiaoniNeural', '晓妮', '女声 · 陕西话'],
  ['zh-HK-HiuMaanNeural', '曉曼', '女声 · 粤语'],
  ['zh-TW-HsiaoChenNeural', '曉臻', '女声 · 台湾国语'],
  ['en-US-AvaMultilingualNeural', 'Ava', 'Female · expressive'],
  ['en-US-AndrewMultilingualNeural', 'Andrew', 'Male · warm'],
  ['en-US-EmmaMultilingualNeural', 'Emma', 'Female · friendly'],
  ['en-US-BrianMultilingualNeural', 'Brian', 'Male · casual'],
  ['en-US-JennyNeural', 'Jenny', 'Female'],
  ['en-US-GuyNeural', 'Guy', 'Male'],
  ['en-GB-SoniaNeural', 'Sonia', 'Female · British'],
  ['en-GB-RyanNeural', 'Ryan', 'Male · British'],
  ['ja-JP-NanamiNeural', '七海', '女声 · 日语'],
  ['ja-JP-KeitaNeural', '圭太', '男声 · 日语'],
].map(([id, name, desc]) => ({
  engine: 'azure' as const,
  id,
  name,
  lang: id.split('-').slice(0, 2).join('-'),
  quality: 'premium' as const,
  desc,
}))

export const OPENAI_VOICES: VoiceOption[] = [
  ['alloy', '中性 · 平稳'],
  ['nova', '女声 · 明亮'],
  ['shimmer', '女声 · 柔和'],
  ['coral', '女声 · 温暖'],
  ['sage', '女声 · 沉稳'],
  ['echo', '男声 · 清晰'],
  ['onyx', '男声 · 低沉'],
  ['ash', '男声 · 自然'],
  ['fable', '男声 · 英式讲述'],
  ['ballad', '男声 · 抒情'],
  ['verse', '男声 · 富有表现力'],
].map(([id, desc]) => ({ engine: 'openai' as const, id, name: id, lang: '', quality: 'premium' as const, desc }))

/** 为某本书选择声音：本书设置 > 该语言默认 > 质量最好的系统语音 */
export function resolveVoice(bookVoice: VoiceChoice | null | undefined, lang: string, s: Settings): VoiceChoice {
  const candidates = [bookVoice, s.voices[baseLang(lang)]].filter(Boolean) as VoiceChoice[]
  for (const c of candidates) {
    if (c.engine === 'system') {
      if (isAutoVoice(c.id) || findSystemVoice(c.id) || !systemVoices().length) return c
    } else if (engineReady(c.engine, s)) return c
  }
  const best = systemVoiceOptions(lang)[0]
  return best
    ? { engine: 'system', id: best.id, name: best.name, lang: best.lang }
    : { engine: 'system', id: '', name: '系统默认', lang }
}

export function voiceLabel(v: VoiceChoice): string {
  if (v.engine === 'azure') return AZURE_VOICES.find(x => x.id === v.id)?.name ?? v.name ?? v.id
  if (v.engine === 'openai') return v.name || v.id
  if (isAutoVoice(v.id)) return isIOS() ? 'iPhone 设置' : '系统设置'
  const sys = findSystemVoice(v.id)
  return sys ? cleanVoiceName(sys.name) : v.name || '系统默认'
}

export const ENGINE_LABELS: Record<EngineId, string> = {
  system: '系统语音',
  azure: 'Azure 神经语音',
  openai: 'OpenAI 兼容',
}
