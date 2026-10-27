// 识别出的文字和 PDF 自带的文字层对照：对得上的部分用文字层的原文（一字不差），
// 对不上的（文字层里是乱码）保留识别结果。
// 有的 PDF 只有某一种字体（例如引文、图片说明用的字体）编码是坏的：一页里正文仍然用原文，只有坏掉的部分用识别结果。
// 识别和文字层分段可能不一样（绕着图片排的窄栏、段落里夹着图片说明），所以逐字对齐，而不是整段比较。
import { oddCount, textLayerBroken } from '../parsers/garble'

function bigrams(text: string): Map<string, number> {
  const chars = [...text.replace(/\s+/g, '')]
  const out = new Map<string, number>()
  for (let i = 1; i < chars.length; i++) {
    const g = chars[i - 1] + chars[i]
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** 两段文字的相似度（字的二元组重合比例，0～1） */
export function similarity(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  let total = 0
  let common = 0
  for (const [g, n] of x) {
    total += n
    common += Math.min(n, y.get(g) ?? 0)
  }
  for (const n of y.values()) total += n
  return total ? (2 * common) / total : 0
}

const isOddText = (text: string) => oddCount(text) > 0

/** 去掉空白后的字，以及每个字在原文里的位置 */
function chars(text: string): { cs: string[]; at: number[] } {
  const cs: string[] = []
  const at: number[] = []
  let i = 0
  for (const ch of text) {
    if (!/\s/.test(ch)) {
      cs.push(ch)
      at.push(i)
    }
    i += ch.length
  }
  return { cs, at }
}

const MATCH = 2
const MISMATCH = -1
const GAP = -1

/**
 * 把识别出的一段在文字层里对齐（局部对齐），对得上的部分换成文字层的原文。
 * 两次对上的字之间：文字层这边没有乱码、长度也和识别结果差不多时用文字层（纠正认错的字、漏掉的标点），否则用识别结果。
 */
export function restoreFromLayer(recognized: string, layer: string): string {
  const a = chars(recognized)
  const b = chars(layer)
  const n = a.cs.length
  const m = b.cs.length
  if (n < 4 || !m || n * m > 1_500_000) return recognized
  // Smith-Waterman：H 为得分，D 为回溯方向（1 对角，2 上，3 左）
  const H = new Int32Array((n + 1) * (m + 1))
  const D = new Uint8Array((n + 1) * (m + 1))
  let best = 0
  let bi = 0
  let bj = 0
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const k = i * (m + 1) + j
      const diag = H[k - m - 2] + (a.cs[i - 1] === b.cs[j - 1] ? MATCH : MISMATCH)
      const up = H[k - m - 1] + GAP
      const left = H[k - 1] + GAP
      let h = 0
      let d = 0
      if (diag > h) (h = diag), (d = 1)
      if (up > h) (h = up), (d = 2)
      if (left > h) (h = left), (d = 3)
      H[k] = h
      D[k] = d
      if (h > best) (best = h), (bi = i), (bj = j)
    }
  }
  // 至少大约一半的字对得上，才算找到了对应的原文
  if (best < n * 0.8) return recognized
  // 回溯出对上的字（识别第 i 个字 ↔ 文字层第 j 个字）
  const pairs: [number, number][] = []
  let i = bi
  let j = bj
  while (i > 0 && j > 0) {
    const k = i * (m + 1) + j
    const d = D[k]
    if (!d) break
    if (d === 1) {
      if (a.cs[i - 1] === b.cs[j - 1]) pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (d === 2) i--
    else j--
  }
  pairs.reverse()
  if (pairs.length < 2) return recognized

  // 第 k 个字之后的位置
  const ocrEnd = (k: number) => a.at[k] + [...recognized.slice(a.at[k])][0].length
  const layerEnd = (k: number) => b.at[k] + [...layer.slice(b.at[k])][0].length
  let out = recognized.slice(0, a.at[pairs[0][0]])
  for (let k = 0; k < pairs.length; k++) {
    const [oi, li] = pairs[k]
    out += layer.slice(b.at[li], layerEnd(li))
    const next = pairs[k + 1]
    if (!next) {
      const rest = recognized.slice(ocrEnd(oi))
      // 识别漏掉了段尾的标点（行末的"——"、引号）：原文紧接着的标点补上
      const tail = rest.trim() ? '' : (layer.slice(layerEnd(li)).match(/^[——…“”「」『』〉》）)。，、；：！？.,;:!?'"]{1,3}/)?.[0] ?? '')
      out += tail + rest
      break
    }
    // 两次对上之间的部分（连同原文里的空格，例如"1977 年"）
    const og = next[0] - oi - 1
    const lg = next[1] - li - 1
    const layerGap = layer.slice(layerEnd(li), b.at[next[1]])
    if (lg <= og + 3 && !isOddText(layerGap)) out += layerGap.replace(/\n/g, '')
    else out += recognized.slice(ocrEnd(oi), a.at[next[0]])
  }
  return out
}

const SAME = 0.6

/** 识别出的每一段，换成文字层里的原文：整段对得上就整段换，否则逐字对齐 */
export function preferTextLayer(recognized: string[], layer: string[]): string[] {
  const good = layer.filter(p => p.replace(/\s+/g, '').length >= 4 && !textLayerBroken(p))
  const page = layer.join('\n')
  const used = new Set<number>()
  return recognized.map(p => {
    let best = -1
    let score = 0
    good.forEach((q, i) => {
      if (used.has(i)) return
      const s = similarity(p, q)
      if (s > score) {
        score = s
        best = i
      }
    })
    // 整段换成原文：两段长度要相近（识别把两段合成了一段时，换成其中一段会丢掉另一段的内容）
    const len = (t: string) => t.replace(/\s+/g, '').length
    const close = best >= 0 && Math.abs(len(good[best]) - len(p)) <= Math.max(3, len(p) * 0.1)
    if (best >= 0 && score >= SAME && close && oddCount(good[best]) <= oddCount(p) + 1) {
      used.add(best)
      return good[best]
    }
    return restoreFromLayer(p, page)
  })
}
