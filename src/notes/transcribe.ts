// 把录音转成文字：Azure 语音识别 或 OpenAI 兼容的 /audio/transcriptions
import { settings } from '../settings'
import { audioExtension } from './recorder'
import { recognitionLang } from './dictation'

export function transcriptionAvailable(): boolean {
  const s = settings.get()
  if (s.transcribe === 'azure') return !!(s.azure.key && s.azure.region)
  if (s.transcribe === 'openai') return !!s.openai.baseUrl && !!(s.openai.key || !/api\.openai\.com/.test(s.openai.baseUrl))
  return false
}

/** 解码任意格式的录音，重采样为 16kHz 单声道 */
async function toPcm16k(blob: Blob): Promise<Float32Array> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const length = Math.ceil(decoded.duration * 16000)
    const offline = new OfflineAudioContext(1, Math.max(1, length), 16000)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  } finally {
    ctx.close().catch(() => {})
  }
}

export function encodeWav16(samples: Float32Array, sampleRate = 16000): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

async function azureTranscribe(blob: Blob, lang: string): Promise<string> {
  const { key, region } = settings.get().azure
  const pcm = await toPcm16k(blob)
  // 短语音接口每次最多 60 秒，分段识别
  const chunk = 16000 * 50
  const parts: string[] = []
  for (let i = 0; i < pcm.length; i += chunk) {
    const wav = encodeWav16(pcm.subarray(i, i + chunk))
    const url = `https://${region.trim()}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${recognitionLang(lang)}&format=simple`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key.trim(),
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: wav,
    })
    if (!res.ok) throw new Error(`Azure 识别失败（${res.status}）`)
    const json = (await res.json()) as { RecognitionStatus: string; DisplayText?: string }
    if (json.DisplayText) parts.push(json.DisplayText)
  }
  return parts.join('')
}

async function openaiTranscribe(blob: Blob, lang: string): Promise<string> {
  const o = settings.get().openai
  const form = new FormData()
  form.append('file', blob, `note.${audioExtension(blob.type)}`)
  form.append('model', o.transcribeModel || 'whisper-1')
  const short = lang.split('-')[0]
  if (short) form.append('language', short)
  form.append('response_format', 'json')
  const res = await fetch(`${o.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: o.key ? { Authorization: `Bearer ${o.key.trim()}` } : {},
    body: form,
  })
  if (!res.ok) throw new Error(`转写失败（${res.status}）`)
  const json = (await res.json()) as { text?: string }
  return json.text?.trim() ?? ''
}

export async function transcribe(blob: Blob, lang: string): Promise<string> {
  const mode = settings.get().transcribe
  if (mode === 'azure') return azureTranscribe(blob, lang)
  if (mode === 'openai') return openaiTranscribe(blob, lang)
  throw new Error('没有配置语音转文字服务')
}
