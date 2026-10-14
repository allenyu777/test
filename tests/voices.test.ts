import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/settings'
import { SystemEngine } from '../src/tts/system'
import { autoVoiceOptions, findSystemVoice, resolveVoice, systemVoiceOptions } from '../src/tts/voices'

// iPhone 给网页的只有自带的基础声音
const VOICES = [
  { name: 'Tingting', lang: 'zh-CN', voiceURI: 'com.apple.voice.compact.zh-CN.Tingting', localService: true, default: true },
  { name: 'Meijia', lang: 'zh-TW', voiceURI: 'com.apple.voice.compact.zh-TW.Meijia', localService: true, default: true },
  { name: 'Sinji', lang: 'zh-HK', voiceURI: 'com.apple.voice.compact.zh-HK.Sinji', localService: true, default: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true, default: true },
]
const spoken: { text: string; lang: string; voice: unknown }[] = []
const g = globalThis as any

beforeAll(() => {
  g.speechSynthesis = {
    speaking: false,
    pending: false,
    getVoices: () => VOICES,
    speak(u: any) {
      spoken.push({ text: u.text, lang: u.lang, voice: u.voice })
    },
    cancel() {},
    addEventListener() {},
  }
  g.SpeechSynthesisUtterance = class {
    text: string
    lang = ''
    voice: unknown = null
    rate = 1
    pitch = 1
    constructor(text: string) {
      this.text = text
    }
  }
})
afterAll(() => {
  delete g.speechSynthesis
  delete g.SpeechSynthesisUtterance
})

describe('follow-system voice', () => {
  it('offers one option per locale of the book language, main locale first', () => {
    expect(autoVoiceOptions('zh').map(v => v.id)).toEqual(['auto:zh-CN', 'auto:zh-HK', 'auto:zh-TW'])
    expect(autoVoiceOptions('en').map(v => v.lang)).toEqual(['en-US'])
    expect(systemVoiceOptions('zh')).toHaveLength(3)
  })
  it('is kept as the chosen voice and never matched to a listed voice', () => {
    const choice = { engine: 'system' as const, id: 'auto:zh-CN', lang: 'zh-CN' }
    expect(resolveVoice(choice, 'zh', DEFAULT_SETTINGS)).toBe(choice)
    expect(findSystemVoice('auto:zh-CN')).toBeUndefined()
  })
  it('speaks with only the language set so iOS picks the voice', () => {
    const engine = new SystemEngine()
    let done = false
    const source = { next: () => (done ? null : ((done = true), { sentences: [{ pos: { b: 0, o: 0 }, text: '你好。' }], text: '你好。' })) }
    engine.start(source, { voiceId: 'auto:zh-CN', lang: 'zh-CN', rate: 1 }, {
      onSentence() {},
      onFinished() {},
      onError() {},
    })
    expect(spoken.at(-1)).toEqual({ text: '你好。', lang: 'zh-CN', voice: null })
    engine.stop()
  })
})
