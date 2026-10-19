// 在页面图片里找脚注线：正文和脚注之间那条靠左的短横线

export interface RuleLine {
  y: number
  x0: number
  x1: number
}

interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

const DARK = 150
const MAX_THICKNESS = 8
const MARGIN = 4

/**
 * 找出图片里单独的一条短横线（长度是页宽的 8%～50%，不超过几个像素粗，上下左右都是空白）。
 * img 是页面的一部分，从页面的 offsetY 行开始；返回的坐标是整页的坐标。
 */
export function findRuleLines(img: Pixels, offsetY: number, pageWidth: number): RuleLine[] {
  const { data, width, height } = img
  const minLen = pageWidth * 0.08
  const maxLen = pageWidth * 0.5
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < DARK
  }
  const darkCount = (y: number, x0: number, x1: number) => {
    let n = 0
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) if (dark(x, y)) n++
    return n
  }

  // 每一行里最长的一段横线（允许中间断开一两个像素）
  const runs: ({ x0: number; x1: number } | null)[] = []
  for (let y = 0; y < height; y++) {
    let best: { x0: number; x1: number } | null = null
    let start = -1
    let gap = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && dark(x, y)) {
        if (start < 0) start = x
        gap = 0
      } else if (start >= 0 && (++gap > 2 || x === width)) {
        const end = x - gap + 1
        if (end - start >= minLen && (!best || end - start > best.x1 - best.x0)) best = { x0: start, x1: end }
        start = -1
        gap = 0
      }
    }
    runs.push(best && best.x1 - best.x0 <= maxLen ? best : null)
  }

  const out: RuleLine[] = []
  for (let y = 0; y < height; y++) {
    const run = runs[y]
    if (!run) continue
    // 线的粗细：连续几行都有位置差不多的横线
    const top = y
    let end = y
    while (end + 1 < height && runs[end + 1] && Math.abs(runs[end + 1]!.x0 - run.x0) < 6) end++
    y = end
    const above = top - MARGIN
    const below = end + MARGIN
    if (end - top + 1 > MAX_THICKNESS || above < 0 || below >= height) continue
    const len = run.x1 - run.x0
    const middle = Math.round((top + end) / 2)
    // 同一行里线外面基本没有别的字（不是一行文字里的破折号、下划线）
    if (darkCount(middle, 0, width) - len > len * 0.2) continue
    // 线的上方、下方是空白
    if (darkCount(above, run.x0, run.x1) > len * 0.1 || darkCount(below, run.x0, run.x1) > len * 0.1) continue
    out.push({ y: offsetY + middle, x0: run.x0, x1: run.x1 })
  }
  return out
}

/**
 * 找出图片里的长横线（表格的边框、三线表的横线）：长度超过页宽的 45%，不超过几个像素粗。
 * 返回每条线的中线位置（整页坐标）。
 */
export function findTableLines(img: Pixels, offsetY: number, pageWidth: number): RuleLine[] {
  const { data, width, height } = img
  const minLen = pageWidth * 0.45
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < DARK
  }
  // 每一行里最长的一段横线（扫描的线常有断开，允许中间断开几个像素）
  const runs: ({ x0: number; x1: number } | null)[] = []
  for (let y = 0; y < height; y++) {
    let best: { x0: number; x1: number } | null = null
    let start = -1
    let gap = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && dark(x, y)) {
        if (start < 0) start = x
        gap = 0
      } else if (start >= 0 && (++gap > 4 || x === width)) {
        const end = x - gap + 1
        if (end - start >= minLen && (!best || end - start > best.x1 - best.x0)) best = { x0: start, x1: end }
        start = -1
        gap = 0
      }
    }
    runs.push(best)
  }
  const out: RuleLine[] = []
  for (let y = 0; y < height; y++) {
    const run = runs[y]
    if (!run) continue
    let end = y
    while (end + 1 < height && runs[end + 1]) end++
    const top = y
    y = end
    // 太粗的是色块、图片，不是线
    if (end - top + 1 > MAX_THICKNESS * 1.5) continue
    out.push({ y: offsetY + Math.round((top + end) / 2), x0: run.x0, x1: run.x1 })
  }
  return out
}
