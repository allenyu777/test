// 全书搜索：不区分大小写、全角半角

export interface SearchHit {
  /** 段落序号 */
  b: number
  /** 匹配在段落里的起止位置 */
  start: number
  end: number
}

/** 逐字转换（长度不变，位置可以直接对应回原文）：大写转小写，全角字母数字转半角 */
function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    let c = code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : ch
    const lower = c.toLowerCase()
    if (lower.length === c.length) c = lower
    out += c
  }
  return out
}

/** 在全书里找 query，最多返回 limit 处（按顺序） */
export function searchBook(blocks: string[], query: string, limit = 300): SearchHit[] {
  const q = fold(query.trim())
  if (!q) return []
  const hits: SearchHit[] = []
  for (let b = 0; b < blocks.length && hits.length < limit; b++) {
    const text = fold(blocks[b])
    let i = text.indexOf(q)
    while (i >= 0 && hits.length < limit) {
      hits.push({ b, start: i, end: i + q.length })
      i = text.indexOf(q, i + q.length)
    }
  }
  return hits
}

/** 结果里显示的一小段上下文：匹配前后各一些字 */
export function snippet(text: string, hit: SearchHit, before = 16, after = 36): { pre: string; match: string; post: string } {
  const from = Math.max(0, hit.start - before)
  const to = Math.min(text.length, hit.end + after)
  return {
    pre: (from > 0 ? '…' : '') + text.slice(from, hit.start),
    match: text.slice(hit.start, hit.end),
    post: text.slice(hit.end, to) + (to < text.length ? '…' : ''),
  }
}
