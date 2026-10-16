// 从纯文本段落中识别章节标题（TXT、无目录的 PDF/MOBI 等）

const NUM = '[0-9０-９零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+'
const ZH_VOLUME = new RegExp(`^(?:正文\\s*)?(?:第\\s*${NUM}\\s*[卷部篇集册]|卷\\s*${NUM}|[上中下]\\s*[卷部篇册])`)
const ZH_CHAPTER = new RegExp(`^(?:正文\\s*)?第\\s*${NUM}\\s*[章节回话幕節話]`)
const ZH_SPECIAL = /^(?:序章|序言|序|楔子|引子|前言|引言|自序|代序|后记|後記|尾声|尾聲|终章|終章|番外|跋|附录|附錄|内容简介|作品简介|简介|簡介|作者的话|写在前面)(?:[\s\u3000:：、.．·—\-]|$|[一二三四五六七八九十0-9])/
const EN_VOLUME = /^(?:part|book|volume|vol\.)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third)\b/i
const EN_CHAPTER = /^(?:chapter|chap\.)\s+([0-9]+|[ivxlcdm]+|[a-z-]+)\b|^(?:prologue|epilogue|preface|foreword|introduction|afterword|appendix|acknowledgements?)\s*[:.]?\s*$/i
const SEPARATOR = /^[\s\u3000:：、.．·—\-]/
const SENTENCE_END = /[。！？；…”」!?]$/

export interface ChapterHit {
  index: number
  level: number
}

/** 标题标记之后的文字是否像标题（而不是"第三节课上，老师说……"这种正文） */
function looksLikeTitleRest(rest: string): boolean {
  if (!rest) return true
  if (SENTENCE_END.test(rest)) return false
  if (SEPARATOR.test(rest)) return true
  return rest.length <= 20 && !/[，。！？；,!?]/.test(rest)
}

/** 判断一行文字是否像章节标题；返回层级（0 卷 / 1 章），不是则返回 -1 */
export function chapterLevel(line: string): number {
  const text = line.trim()
  if (!text || text.length > 50) return -1
  let m = text.match(ZH_VOLUME)
  if (m && looksLikeTitleRest(text.slice(m[0].length))) return 0
  m = text.match(ZH_CHAPTER)
  if (m && looksLikeTitleRest(text.slice(m[0].length))) return 1
  if (text.length <= 30 && ZH_SPECIAL.test(text) && !SENTENCE_END.test(text)) return 1
  if (text.length <= 80 && !/[.!?]["'”’]?$/.test(text.replace(/^(chapter|chap|vol)\.?/i, ''))) {
    if (EN_VOLUME.test(text)) return 0
    if (EN_CHAPTER.test(text)) return 1
  }
  return -1
}

/**
 * 在段落列表中找出章节标题。
 * 会过滤掉书前目录页那种连续堆在一起的标题。
 */
export function detectChapters(blocks: string[], skip?: Set<number>): ChapterHit[] {
  const hits: ChapterHit[] = []
  for (let i = 0; i < blocks.length; i++) {
    // 目录页、脚注里的"第X章"不算
    if (skip?.has(i)) continue
    const level = chapterLevel(blocks[i])
    if (level >= 0) hits.push({ index: i, level })
  }
  if (hits.length < 2) return []

  // 连续 3 个以上紧挨着的标题，多半是书前的目录页，整段丢弃
  const keep: ChapterHit[] = []
  let runStart = 0
  for (let i = 1; i <= hits.length; i++) {
    if (i < hits.length && hits[i].index === hits[i - 1].index + 1) continue
    const run = hits.slice(runStart, i)
    if (run.length < 3) keep.push(...run)
    runStart = i
  }
  if (keep.length < 2) return []
  // 只有卷没有章，或者只有章时，层级统一从 0 开始
  const minLevel = Math.min(...keep.map(h => h.level))
  return keep.map(h => ({ index: h.index, level: h.level - minLevel }))
}
