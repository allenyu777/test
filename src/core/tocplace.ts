// 目录项定位到标题所在的那一段。
// PDF 书签只记了页码：一页上同时有"第三章"和它的"第一节"时，两个目录项都会指到页首，
// 章的开头几段就被算进了"第一节"。这里在目录项附近找和标题一样的段落（识别时可能错几个字），把目录项挪过去
import type { TocEntry } from './book'

/** 往后最多找多少段（大约一两页） */
const WINDOW = 40

const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

/** 两段文字共有字符的比例（以较长的一段为准，避免短段落碰巧都包含在标题里） */
function similarity(a: string, b: string): number {
  const pool = [...b]
  let hit = 0
  for (const ch of a) {
    const i = pool.indexOf(ch)
    if (i >= 0) {
      hit++
      pool.splice(i, 1)
    }
  }
  return hit / Math.max(a.length, b.length)
}

/** 这一段是不是这个标题（允许空格、标点不同，识别时错一两个字） */
export function isTitleBlock(block: string, title: string): boolean {
  const a = norm(block)
  const t = norm(title)
  if (!a || !t) return false
  if (a === t) return true
  if (t.length < 4 || a.length > t.length + 4) return false
  return similarity(a, t) >= 0.8
}

/**
 * 把每个目录项挪到它的标题段落（找不到就留在原处，但不早于前一个目录项）。
 * 返回新的目录和找到了标题的段落序号（可以按标题样式显示）
 */
export function placeToc(blocks: string[], toc: TocEntry[]): { toc: TocEntry[]; titled: Map<number, number> } {
  const out: TocEntry[] = []
  const titled = new Map<number, number>()
  let floor = 0
  for (const entry of toc) {
    const from = Math.min(Math.max(entry.b, floor), Math.max(0, blocks.length - 1))
    let b = -1
    for (let i = from; i < Math.min(blocks.length, from + WINDOW); i++) {
      if (isTitleBlock(blocks[i], entry.title)) {
        b = i
        break
      }
    }
    if (b >= 0) {
      titled.set(b, entry.level)
      floor = b + 1
    } else {
      b = from
      floor = b
    }
    out.push(b === entry.b ? entry : { ...entry, b })
  }
  return { toc: out, titled }
}
