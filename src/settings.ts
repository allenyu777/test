// 用户设置（保存在 localStorage）
import { createStore } from './store'

export type EngineId = 'system' | 'azure' | 'openai'

export interface VoiceChoice {
  engine: EngineId
  id: string
  name?: string
  lang?: string
}

export type Theme = 'auto' | 'light' | 'sepia' | 'green' | 'dark'
export type FontFamily = 'sans' | 'serif' | 'kai'

export interface Settings {
  /** 新书默认语速 */
  rate: number
  /** 各语言默认使用的声音（zh / en / ja …） */
  voices: Record<string, VoiceChoice>
  azure: { key: string; region: string }
  openai: { baseUrl: string; key: string; model: string; instructions: string; transcribeModel: string; visionModel: string }
  theme: Theme
  fontSize: number
  lineHeight: number
  font: FontFamily
  /** 朗读时自动滚动跟随 */
  follow: boolean
  /** 朗读时保持屏幕常亮 */
  keepAwake: boolean
  /** 系统语音朗读时播放静音音频，争取锁屏后继续 */
  keepAlive: boolean
  /** 语音笔记转文字的服务 */
  transcribe: 'off' | 'azure' | 'openai'
  /** 写完笔记后自动继续播放 */
  resumeAfterNote: boolean
  sort: 'recent' | 'added' | 'title' | 'progress'
  libraryView: 'grid' | 'list'
  /** 语速调节记忆到每本书 */
  perBookRate: boolean
  /** 朗读脚注和正文里的注释编号（关闭时只显示，不朗读） */
  readNotes: boolean
  /** 朗读目录页、版权页、图表说明和表格（关闭时只显示，不朗读） */
  readExtras: boolean
  /** 后退、快进按钮一次跳过的秒数 */
  skipBack: number
  skipForward: number
}

export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  voices: {},
  azure: { key: '', region: 'eastasia' },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    key: '',
    model: 'gpt-4o-mini-tts',
    instructions: '用自然、平稳、富有感情的有声书旁白语气朗读，语速适中，停顿自然。',
    transcribeModel: 'gpt-4o-mini-transcribe',
    visionModel: 'gpt-4o-mini',
  },
  theme: 'auto',
  fontSize: 19,
  lineHeight: 1.85,
  font: 'sans',
  follow: true,
  keepAwake: true,
  keepAlive: true,
  transcribe: 'off',
  resumeAfterNote: true,
  sort: 'recent',
  libraryView: 'grid',
  perBookRate: true,
  readNotes: false,
  readExtras: false,
  skipBack: 10,
  skipForward: 15,
}

const KEY = 'tingshu.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      azure: { ...DEFAULT_SETTINGS.azure, ...saved.azure },
      openai: { ...DEFAULT_SETTINGS.openai, ...saved.openai },
      voices: { ...saved.voices },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const settings = createStore<Settings>(load())

settings.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()))
  } catch {
    // 隐私模式下可能无法写入
  }
})

export function updateSettings(patch: Partial<Settings>) {
  settings.set(patch)
}

export function engineReady(engine: EngineId, s: Settings = settings.get()): boolean {
  if (engine === 'azure') return !!(s.azure.key && s.azure.region)
  if (engine === 'openai') return !!(s.openai.key || !/api\.openai\.com/.test(s.openai.baseUrl)) && !!s.openai.baseUrl
  return typeof speechSynthesis !== 'undefined'
}
