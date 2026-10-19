// 每个声音实际的朗读速度（1 倍速时每分钟读多少字），用来估算章节时长、快进快退的字数。
// 云端语音每下载一段就知道这段的字数和音频时长，按实际速度慢慢校准（中文默认按 260 字/分钟估算，常常偏慢）
import { createStore } from '../store'

const KEY = 'tingshu.pace.v1'

function load(): Record<string, number> {
  try {
    return { ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return {}
  }
}

export const pace = createStore<Record<string, number>>(load())

pace.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(pace.get()))
  } catch {
    // 隐私模式下可能无法写入
  }
})

/** 记下一段音频：chars 个字读了 seconds 秒（1 倍速） */
export function recordPace(voice: string, chars: number, seconds: number) {
  if (!(seconds > 2) || chars < 10) return
  const cpm = (chars / seconds) * 60
  // 明显不对的数据（例如音频出错）不要
  if (cpm < 60 || cpm > 3000) return
  const old = pace.get()[voice]
  pace.set({ [voice]: old ? old * 0.8 + cpm * 0.2 : cpm })
}

/** 这个声音的实际朗读速度（还没测到返回 undefined） */
export function paceOf(voice: string): number | undefined {
  return pace.get()[voice]
}
