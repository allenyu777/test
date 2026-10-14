// 录音（语音笔记）
export interface Recording {
  blob: Blob
  type: string
  duration: number
}

const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac']

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export class Recorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private ctx: AudioContext | null = null
  private raf = 0

  async start(onLevel?: (level: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported?.(t))
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = e => {
      if (e.data.size) this.chunks.push(e.data)
    }
    this.recorder.start(1000)
    this.startedAt = Date.now()
    if (onLevel) this.meter(onLevel)
  }

  /** 音量指示 */
  private meter(onLevel: (level: number) => void) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      const source = this.ctx.createMediaStreamSource(this.stream!)
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += (v - 128) ** 2
        onLevel(Math.min(1, Math.sqrt(sum / data.length) / 40))
        this.raf = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // 音量指示不是必须的
    }
  }

  get elapsed() {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0
  }

  stop(): Promise<Recording> {
    const recorder = this.recorder
    if (!recorder) return Promise.reject(new Error('没有在录音'))
    const duration = this.elapsed
    return new Promise(resolve => {
      recorder.onstop = () => {
        const type = recorder.mimeType || this.chunks[0]?.type || 'audio/mp4'
        const blob = new Blob(this.chunks, { type })
        this.cleanup()
        resolve({ blob, type, duration })
      }
      recorder.stop()
    })
  }

  cancel() {
    try {
      this.recorder?.stop()
    } catch {
      // 已停止
    }
    this.cleanup()
  }

  private cleanup() {
    cancelAnimationFrame(this.raf)
    this.ctx?.close().catch(() => {})
    this.ctx = null
    // 一定要关闭麦克风，否则 iOS 会一直显示录音状态、外放音量变小
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.recorder = null
    this.startedAt = 0
  }
}

export function audioExtension(type: string): string {
  if (/mp4|aac|m4a/.test(type)) return 'm4a'
  if (/webm/.test(type)) return 'webm'
  if (/ogg/.test(type)) return 'ogg'
  if (/wav/.test(type)) return 'wav'
  return 'audio'
}
