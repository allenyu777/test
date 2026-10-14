// 实时听写（浏览器自带的语音识别，iOS Safari 使用系统听写服务）

interface RecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionCtor = new () => RecognitionLike

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function dictationSupported(): boolean {
  return typeof window !== 'undefined' && !!ctor()
}

export function recognitionLang(lang: string): string {
  if (lang.includes('-')) return lang
  return ({ zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', ru: 'ru-RU' } as Record<string, string>)[lang] ?? 'zh-CN'
}

export class Dictation {
  private rec: RecognitionLike | null = null
  private finalText = ''
  private stopped = false

  /**
   * onText(已确认文字, 临时文字)；onEnd(错误信息)
   */
  start(lang: string, onText: (finalText: string, interim: string) => void, onEnd: (error?: string) => void) {
    const C = ctor()
    if (!C) {
      onEnd('当前浏览器不支持语音识别，可以用键盘上的麦克风按钮听写')
      return
    }
    this.finalText = ''
    this.stopped = false
    const rec = new C()
    rec.lang = recognitionLang(lang)
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = e => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) this.finalText += r[0].transcript
        else interim += r[0].transcript
      }
      onText(this.finalText, interim)
    }
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      const map: Record<string, string> = {
        'not-allowed': '没有麦克风或语音识别权限',
        'service-not-allowed': '语音识别服务不可用（请在系统设置中开启听写/Siri）',
        network: '语音识别需要网络连接',
        'audio-capture': '无法使用麦克风',
      }
      this.stopped = true
      onEnd(map[e.error] ?? `语音识别出错：${e.error}`)
    }
    rec.onend = () => {
      if (!this.stopped) onEnd()
      this.rec = null
    }
    this.rec = rec
    rec.start()
  }

  stop() {
    this.rec?.stop()
  }

  abort() {
    this.stopped = true
    this.rec?.abort()
    this.rec = null
  }
}
