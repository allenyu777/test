// 朗读引擎的公共接口
import type { Pos } from '../core/book'

export interface SegmentSentence {
  pos: Pos
  text: string
}

/** 一次交给引擎朗读的片段：系统语音为一句，云端语音为若干句 */
export interface Segment {
  sentences: SegmentSentence[]
  text: string
}

export interface SegmentSource {
  next(): Segment | null
}

export interface EngineCallbacks {
  /** 开始朗读某一句 */
  onSentence(pos: Pos): void
  /** 所有片段读完 */
  onFinished(): void
  onError(message: string): void
  /** 网络语音加载中 */
  onLoading?(loading: boolean): void
  /** 被系统打断（来电、拔耳机、锁屏控件暂停等） */
  onPausedExternally?(): void
  /** 在锁屏控件、耳机上点了继续播放（系统直接让音频继续，不经过页面） */
  onResumedExternally?(): void
  /** 暂停太久，音频已经真正停下（锁屏控件可以关掉了） */
  onSuspended?(): void
}

export interface EngineOptions {
  voiceId: string
  lang: string
  rate: number
}

export interface Engine {
  readonly kind: 'system' | 'cloud'
  /** 单个片段最多多少字 */
  readonly maxChars: number
  start(source: SegmentSource, options: EngineOptions, callbacks: EngineCallbacks): void
  stop(): void
  /** 支持原地暂停/继续（云端音频）；返回 false 表示需要重新 start */
  pause(): boolean
  resume(): boolean
  setRate(rate: number): boolean
  isActive(): boolean
}
