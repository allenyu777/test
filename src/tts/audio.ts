// 共享的 <audio> 元素、iOS 播放解锁、静音保活、屏幕常亮

/** 生成一段完全无声的 16-bit 单声道 WAV（所有采样都是 0，任何音量下都听不到） */
export function makeWav(seconds: number, sampleRate = 8000): Blob {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const bytes = n * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + bytes, true)
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
  v.setUint32(40, bytes, true)
  // 采样数据保持为 0：真正的静音（iOS 不会因为没有声音而停止播放）
  return new Blob([buf], { type: 'audio/wav' })
}

let silentUrl: string | null = null
export function silent(): string {
  if (!silentUrl) silentUrl = URL.createObjectURL(makeWav(5))
  return silentUrl
}

/**
 * 告诉 iOS 这是媒体播放（Safari 的 navigator.audioSession，iOS 17 起支持）：
 * 锁屏、静音开关、其它 App 的声音都按播放器的方式处理
 */
export function setPlaybackSession() {
  const session = (typeof navigator !== 'undefined' ? (navigator as Navigator & { audioSession?: { type: string } }).audioSession : undefined)
  if (!session || session.type === 'playback') return
  try {
    session.type = 'playback'
  } catch {
    // 不支持
  }
}

/**
 * 暂停时让页面保持活跃（Web Audio 播放一个听不见的极低音：20 Hz、-80 dB）。
 * iOS 上的网页应用暂停一会儿后系统会收回音频，锁屏控件上点播放就没有反应了；
 * 以前用 <audio> 播放静音占着音频，但那样锁屏控件会一直显示"正在播放"。
 * Web Audio 不会出现在锁屏控件上，所以 <audio> 可以真正暂停，锁屏按钮显示正确。
 * 要在用户点击时先启动（iOS 不允许在后台启动声音）
 */
type AudioContextCtor = typeof AudioContext
let keeperCtx: AudioContext | null = null
let keeperOsc: OscillatorNode | null = null

export function startAudioKeeper() {
  try {
    const Ctor = (window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined
    if (!Ctor) return
    keeperCtx ??= new Ctor()
    if (keeperCtx.state !== 'running') keeperCtx.resume().catch(() => {})
    if (!keeperOsc) {
      const osc = keeperCtx.createOscillator()
      const gain = keeperCtx.createGain()
      osc.frequency.value = 20
      gain.gain.value = 0.0001
      osc.connect(gain).connect(keeperCtx.destination)
      osc.start()
      keeperOsc = osc
    }
  } catch {
    // 不支持 Web Audio
  }
}

export function stopAudioKeeper() {
  try {
    keeperOsc?.stop()
    keeperOsc?.disconnect()
  } catch {
    // 已经停了
  }
  keeperOsc = null
  keeperCtx?.suspend().catch(() => {})
}

let main: HTMLAudioElement | null = null

/** 云端语音使用的播放器（全程复用同一个元素，iOS 才允许后台连续播放） */
export function mainAudio(): HTMLAudioElement {
  if (!main) {
    main = new Audio()
    main.preload = 'auto'
    main.setAttribute('playsinline', '')
    ;(main as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true
  }
  return main
}

/** 在用户点击的同步调用栈里调用，解锁 iOS 的自动播放限制 */
export function primeAudio() {
  const a = mainAudio()
  if (!a.paused) return
  a.onended = null
  a.src = silent()
  a.play().catch(() => {})
}

/** 解锁 speechSynthesis（iOS 要求首次朗读在用户手势中发起） */
export function primeSpeech() {
  if (typeof speechSynthesis === 'undefined') return
  if (speechSynthesis.speaking || speechSynthesis.pending) return
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  speechSynthesis.speak(u)
}

let keeper: HTMLAudioElement | null = null

/** 播放循环静音音频：让锁屏/后台时页面保持活跃，并显示锁屏播放控件 */
export function startKeepAlive() {
  if (!keeper) {
    keeper = new Audio()
    keeper.loop = true
    keeper.setAttribute('playsinline', '')
    keeper.src = silent()
  }
  if (keeper.paused) keeper.play().catch(() => {})
}

export function stopKeepAlive() {
  keeper?.pause()
}

type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean }
let wakeLock: WakeLockSentinelLike | null = null
// 需要常亮的原因（朗读、文字识别），任意一个存在就保持常亮
const wakeReasons = new Set<string>()

async function syncWakeLock() {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }
  try {
    if (wakeReasons.size && nav.wakeLock && (!wakeLock || wakeLock.released)) {
      wakeLock = await nav.wakeLock.request('screen')
    } else if (!wakeReasons.size && wakeLock) {
      const lock = wakeLock
      wakeLock = null
      await lock.release()
    }
  } catch {
    wakeLock = null
  }
}

export function setWakeLock(on: boolean, reason = 'playback') {
  if (on) wakeReasons.add(reason)
  else wakeReasons.delete(reason)
  return syncWakeLock()
}

// 页面重新可见时恢复常亮（系统会在切到后台时自动释放）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeReasons.size) syncWakeLock()
  })
}
