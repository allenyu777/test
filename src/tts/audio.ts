// 共享的 <audio> 元素、iOS 播放解锁、静音保活、屏幕常亮

/** 生成一段 8-bit 单声道 WAV（静音或极轻的噪声） */
export function makeWav(seconds: number, sampleRate = 8000): Blob {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  str(36, 'data')
  v.setUint32(40, n, true)
  // 8-bit PCM 的静音是 128；加入 ±1 的抖动，避免系统判定为"无声音"而挂起
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128 + (i % 50 === 0 ? 1 : 0))
  return new Blob([buf], { type: 'audio/wav' })
}

let silentUrl: string | null = null
function silent(): string {
  if (!silentUrl) silentUrl = URL.createObjectURL(makeWav(1))
  return silentUrl
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
