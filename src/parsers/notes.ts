// 脚注：页面下方的注释区（"〔1〕 民国《临县志》……"）和正文里的注释编号（"伤稼"〔7〕。"）
// 屏幕上照常显示，朗读时跳过

/** 注释开头的编号：〔1〕 [1] 【1】 (1) ① 注1 */
const NOTE_MARK = /^\s*(?:[〔［\[【(（{]\s*\d{1,3}\s*[〕］\]】)）}]|[①-⑳㉑-㉟]|注\s*[\d①-⑳:：])/
/** 只有字号比正文小时才算注释开头的编号：1. 1、 1民国…… * ¹ */
const LOOSE_MARK = /^\s*(?:\d{1,3}(?!\d)|[*＊※†‡]|[⁰¹²³⁴-⁹]+)/
/** 没有字号信息时只认这些（圆括号编号多半是正文里的列举） */
const STRONG_MARK = /^\s*(?:[〔［\[【]\s*(\d{1,3})\s*[〕］\]】)）]|([①-⑳]))/

export function isNoteStart(text: string, smaller = false): boolean {
  return NOTE_MARK.test(text) || (smaller && LOOSE_MARK.test(text))
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 正文里有没有引用这个注释（编号不在段首） */
function referenced(body: string[], mark: RegExpMatchArray): boolean {
  if (mark[2]) return body.some(p => p.slice(1).includes(mark[2]))
  const re = new RegExp(`\\S\\s*[〔［\\[【(（]\\s*${mark[1]}\\s*[〕］\\]】)）]`)
  return body.some(p => re.test(p))
}

/**
 * 没有位置信息时（云端识别）按文字分出页面最后的注释区：
 * 页尾连续几段以 〔1〕 [1] ① 开头（中间可以夹一段注释的换行），并且正文里引用了其中的编号。
 */
export function splitTrailingNotes(paragraphs: string[]): { body: string[]; notes: string[] } {
  const none = { body: paragraphs, notes: [] }
  let start = -1
  let plain = 0
  for (let i = paragraphs.length - 1; i >= 1; i--) {
    if (STRONG_MARK.test(paragraphs[i])) {
      start = i
      plain = 0
    } else if (++plain > 1) break
  }
  if (start < 1) return none
  const body = paragraphs.slice(0, start)
  const notes = paragraphs.slice(start)
  const marks = notes.map(p => p.match(STRONG_MARK)).filter((m): m is RegExpMatchArray => !!m)
  if (marks.length * 2 < notes.length || !marks.some(m => referenced(body, m))) return none
  return { body, notes }
}

/** 把脚注区的各行分成一条条注释（带编号的行开始新的一条），条与条之间空一行 */
export function notesToText(lines: string[]): string {
  let out = ''
  for (const line of lines) {
    if (out) out += isNoteStart(line, true) ? '\n\n' : '\n'
    out += line.trim()
  }
  return out
}

const BRACKET_REF = /(\S)\s*(?:[〔［\[【{]\s*\d{1,3}(?:\s*[-–,，、]\s*\d{1,3})*\s*[〕］\]】)）}]|[(（]\s*\d{1,3}\s*[〕］\]】])/g
const PAREN_REF = /([^\s(（：:；;，,、。])\s*[(（]\s*\d{1,3}\s*[)）](?=\s*(?:[，。、；：！？,.;:!?”"」』）)]|$))/g
const CIRCLED_REF = new RegExp(`([^\\s：:；;，,、。（(${CIRCLED}])[${CIRCLED}]`, 'g')
// 句子可能从上标开始（在"了。¹小草"的句号处分句）
const SUPERSCRIPT_REF = /(^|[^\sA-Za-z\d⁰¹²³⁴-⁹])[⁰¹²³⁴-⁹]+/g

/**
 * 朗读时去掉正文里的注释编号："伤稼"〔7〕。" → "伤稼"。"
 * 段首的编号、"：①……；②……"这类列举不动；圆括号的编号只在紧跟标点时去掉（"（1）农业"是列举）；
 * 识别时括号常认错一半（"[7）"），有一边是方括号就算。
 */
export function stripNoteRefs(text: string): string {
  return text.replace(BRACKET_REF, '$1').replace(PAREN_REF, '$1').replace(CIRCLED_REF, '$1').replace(SUPERSCRIPT_REF, '$1')
}
