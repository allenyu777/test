// 只看不听的段落：书前的目录页、版权页、图表的标题和说明、表格里的数字。
// 屏幕上照常显示（灰色），朗读时跳过（设置里可以打开「朗读目录、版权页和图表」）
import { chapterLevel } from './chapters'

const TOC_TITLE = /^\s*(目\s*[录錄]|目\s*次|contents|table\s+of\s+contents)\s*$/i
/** 引导点加页码："第一章 光绪初年的灾荒图景……25""Preface ........ ix" */
const LEADER = /(?:[.．。·•…‥⋯_]\s?){3,}\s*[(（]?(?:\d{1,4}|[ivxlc]{1,6})[)）]?\s*$|(?:…|⋯){2,}\s*\d{1,4}\s*$/i
const LEADER_G = /(?:[.．。·•…‥⋯_]\s?){3,}\s*(?:\d{1,4}|[ivxlc]{1,6})(?![\d])|(?:…|⋯){2,}\s*\d{1,4}(?!\d)/gi
/** 目录条目的开头（没有引导点时，开头像标题、结尾是页码） */
const ENTRY_START =
  /^(?:第\s*[0-9０-９零〇一二两三四五六七八九十百千]+\s*[章节編编部篇卷回讲講]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+)*\s|附\s*录|后\s*记|後\s*記|前\s*言|序|导\s*论|導\s*論|绪\s*论|緒\s*論|结\s*语|結\s*語|参考文献|參考文獻|索\s*引|chapter|part|appendix|introduction|preface|epilogue|index|bibliography|notes)/i
const TRAILING_PAGE = /\s[(（]?\d{1,4}[)）]?\s*$|[^\d\s(（][(（]?\d{1,3}[)）]?\s*$/

/** 版权页才有的内容 */
const COPYRIGHT = [
  /ISBN[\s:：-]*[\dXx][\dXx\s-]{8,}/i,
  /图书在版编目|圖書在版編目|CIP\s*数据|CIP\s*數據/i,
  /版权所有|版權所有|侵权必究|侵權必究|翻印必究/,
  /all rights reserved/i,
  /copyright\s*(?:©|\(c\)|\d{4})/i,
  /library of congress/i,
  /开\s*本[:：\s]|開\s*本[:：\s]/,
  /印\s*张[:：\s]|印\s*張[:：\s]/,
  /定\s*价[:：\s]|定\s*價[:：\s]/,
  /责任编辑|責任編輯|策划编辑|封面设计|封面設計|责任印制/,
  /出版发行|出版發行|出\s*版\s*者[:：]|发\s*行[:：]/,
  /\d{4}\s*年\s*\d{1,2}\s*月第\s*\d+\s*版|印\s*次[:：\s]|版\s*次[:：\s]/,
  /printed in|first (?:published|edition)/i,
]

/** 图表标题："图 1-2 光绪三年粮价""表3.1""Figure 2: …" */
const CAPTION =
  /^\s*(?:图|圖|插图|插圖|附图|附圖|表|附表|地图|地圖|fig\.?|figure|plate|photo|table|chart|map)\s*[0-9０-９一二三四五六七八九十]+(?:\s*[-—–.．·:：]\s*[0-9０-９]+)*(?=[\s:：、.．㐀-鿿A-Za-z]|$)/i
/** 表格下面的出处说明 */
const SOURCE = /^\s*(?:资料来源|資料來源|数据来源|數據來源|来源|來源|说明|說明|注|source|sources|note)\s*[:：]/i
const NUMBER_TOKEN = /^[(（]?[-+−—–]?\d[\d,，.．%‰]*[)）]?$|^[-—–]+$/

function isTocEntry(t: string): boolean {
  if (t.length > 300) return false
  if (LEADER.test(t)) return true
  // 识别时几行目录被拼成了一段
  if ((t.match(LEADER_G)?.length ?? 0) >= 2) return true
  return t.length <= 60 && ENTRY_START.test(t) && TRAILING_PAGE.test(t)
}

/** 目录页上不带页码的条目（EPUB 的目录页）：短，不是句子 */
const plainEntry = (t: string) => t.length <= 40 && !/[。！？!?；;]/.test(t) && !/[，,].*[，,]/.test(t)

function copyrightHits(t: string): number {
  if (t.length > 800) return 0
  return COPYRIGHT.filter(re => re.test(t)).length
}

/** 表格的一行：大部分是数字 */
function isTableRow(t: string): boolean {
  if (t.length > 300) return false
  const tokens = t.split(/[\s　|｜]+/).filter(Boolean)
  const numbers = tokens.filter(x => NUMBER_TOKEN.test(x)).length
  // 正文里数字两边常有空格（"2012 年 1 月 23 日"），按空格切开数字也很多；表格的一行汉字很少（只有行标题）
  const cjk = (t.match(/[\u3400-\u9fff]/g) ?? []).length
  return numbers >= 4 && numbers >= tokens.length * 0.5 && cjk <= numbers * 4
}

function isCaption(t: string): boolean {
  return t.length <= 60 && CAPTION.test(t) && !/[。！？!?]/.test(t) && !/[.．]$/.test(t)
}

/** 目录条目的标题部分（去掉引导点和页码），用来发现目录后面重复出现的正文标题 */
const entryKey = (t: string) =>
  t
    .replace(/(?:[.．。·•…‥⋯_]\s?)+\s*[(（]?(?:\d{1,4}|[ivxlc]{1,6})?[)）]?\s*$/i, '')
    .replace(/\s+[(（]?\d{1,4}[)）]?\s*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase()

/**
 * 找出只看不听的段落，返回从小到大的序号。
 * skip：已经不朗读的段落（脚注），判断"相邻"时跳过它们。
 */
export function findQuietBlocks(blocks: string[], skip: Iterable<number> = []): number[] {
  const skipped = new Set(skip)
  const quiet = new Set<number>()
  // 跳过脚注后的段落顺序
  const order: number[] = []
  for (let i = 0; i < blocks.length; i++) if (!skipped.has(i)) order.push(i)
  const text = (k: number) => blocks[order[k]].trim()

  // 目录页：标题"目录"后面的条目，或者连续两条以上带页码的条目
  for (let k = 0; k < order.length; k++) {
    const titled = TOC_TITLE.test(text(k))
    let end = titled ? k + 1 : k
    // 目录之后正文开始：条目的标题又出现了一次
    const seen = new Set<string>()
    const fresh = (t: string) => {
      const key = entryKey(t)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }
    if (titled) {
      while (end < order.length && (isTocEntry(text(end)) || plainEntry(text(end))) && fresh(text(end))) end++
      if (end - k - 1 >= 2) {
        for (let j = k; j < end; j++) quiet.add(order[j])
        k = end - 1
        continue
      }
      end = k
      seen.clear()
    }
    while (end < order.length && isTocEntry(text(end)) && fresh(text(end))) end++
    if (end - k >= 2) for (let j = k; j < end; j++) quiet.add(order[j])
    if (end > k) k = end - 1
  }

  // 版权页：相邻几段里出现两种以上版权页才有的内容（ISBN、定价、责任编辑……），连同中间和紧挨着的短段落
  const hits = order.map((_, k) => copyrightHits(text(k)))
  for (let k = 0; k < order.length; k++) {
    if (!hits[k]) continue
    let end = k
    let total = hits[k]
    for (let j = k + 1; j < order.length && j - end <= 4; j++) {
      if (hits[j]) {
        total += hits[j]
        end = j
      }
    }
    if (total >= 2) {
      let start = k
      while (start > 0 && k - start < 3 && text(start - 1).length <= 80 && !TOC_TITLE.test(text(start - 1)) && chapterLevel(text(start - 1)) < 0)
        start--
      let stop = end
      while (stop + 1 < order.length && stop - end < 3 && text(stop + 1).length <= 80 && copyrightTail(text(stop + 1))) stop++
      for (let j = start; j <= stop; j++) quiet.add(order[j])
    }
    k = end
  }

  // 图表：标题、表格里的数字行、下面的资料来源
  for (let k = 0; k < order.length; k++) {
    const t = text(k)
    if (isCaption(t) || isTableRow(t)) {
      quiet.add(order[k])
      // 标题下面紧跟的数字行和出处
      let j = k + 1
      while (j < order.length && (isTableRow(text(j)) || (SOURCE.test(text(j)) && text(j).length <= 200))) quiet.add(order[j++])
      k = j - 1
    }
  }
  return [...quiet].sort((a, b) => a - b)
}

/** 版权页最后常见的零碎信息（字数、印数、网址、电话） */
function copyrightTail(t: string): boolean {
  return /字\s*数|字\s*數|印\s*数|印\s*數|网\s*址|網\s*址|电\s*话|電\s*話|邮\s*编|郵\s*編|http|www\.|[\d]{4,}/i.test(t)
}
