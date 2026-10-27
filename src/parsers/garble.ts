// 识别"乱码"文字层：PDF 字体缺少正确的字符映射时，提取出的文字是一堆无关符号

/** 正常书籍里会出现的字符范围 */
function expected(c: number): boolean {
  if (c >= 0x20 && c <= 0x7e) return true
  if (c >= 0xa0 && c <= 0x17f) return true // 拉丁字母（含重音）
  if (c >= 0x370 && c <= 0x4ff) return true // 希腊、西里尔
  if (c >= 0x1e00 && c <= 0x1eff) return true // 越南文等
  if (c >= 0x2000 && c <= 0x206f) return true // 常用标点
  if (c >= 0x2e80 && c <= 0x9fff) return true // 中日文字与标点、注音、假名
  if (c >= 0xac00 && c <= 0xd7af) return true // 韩文
  if (c >= 0xf900 && c <= 0xfaff) return true // 兼容汉字
  if (c >= 0xfe30 && c <= 0xfe4f) return true // 竖排标点
  if (c >= 0xff00 && c <= 0xffef) return true // 全角字符
  if (c >= 0x20000 && c <= 0x3134f) return true // 扩展汉字
  return false
}

/** 异常字符所占比例（不计空白） */
export function garbleRatio(text: string): number {
  let total = 0
  let bad = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    total++
    if (!expected(ch.codePointAt(0)!)) bad++
  }
  return total ? bad / total : 0
}

/** 一段文字是否像乱码 */
export function isGarbled(text: string): boolean {
  const nonSpace = text.replace(/\s+/g, '').length
  return nonSpace >= 20 && garbleRatio(text) >= 0.15
}

const TRAD = '國們這個來為說時會對於過發後裡經麼學現當沒動還進樣開從實無與長機點體電話問題頭關業東書車見間聽讀寫買賣門風飛馬魚鳥龍劉陳張楊趙黃鄭謝韓馮鄧蕭權貴遊黨禍歲歷義華麗號應該總歡錢'
const SIMP = '国们这个来为说时会对于过发后里经么学现当没动还进样开从实无与长机点体电话问题头关业东书车见间听读写买卖门风飞马鱼鸟龙刘陈张杨赵黄郑谢韩冯邓萧权贵游党祸岁历义华丽号应该总欢钱'
const TRAD_SET = new Set(TRAD)
const SIMP_SET = new Set(SIMP)

/** 根据可读的文字（书名、标题、正常页面）猜测识别语言 */
export function guessOcrLang(text: string): 'chi_sim' | 'chi_tra' | 'eng' {
  let trad = 0
  let simp = 0
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    if (TRAD_SET.has(ch)) trad++
    else if (SIMP_SET.has(ch)) simp++
    const c = ch.codePointAt(0)!
    if (c >= 0x4e00 && c <= 0x9fff) cjk++
    else if (/[A-Za-z]/.test(ch)) latin++
  }
  if (!cjk && latin > 20) return 'eng'
  return trad > simp ? 'chi_tra' : 'chi_sim'
}

// 只在一种字体里出现的常用字：繁体书里混进一串简体字（或反过来），多半是 PDF 的字符映射错了
const SIMP_ONLY = new Set(
  '们这个为说时会对过发经么现没动还进样开从实无长机点体电话问题头关业东书车见间听读写买卖门风飞马鱼鸟龙刘陈张杨赵郑谢韩冯邓权贵党岁历义华丽号应该总欢钱极讯报导领馆护证续际处标准众观认识议论语谈让许设试详请谁调负财责败货质购费贴贸资赏赖赛赞赠赢赶运远违连迟适选递逻遗邮邻释针钟钢铁银锁错键镇闪闭闯闲闹闻阁阅队阳阴阵阶陆险随隐难雾须项顺顾顿颁频题颜额饭饮饱饰驱驶驻驾验骑鲁鲜鸡鸣鸭麦齐齿',
)
const TRAD_ONLY = new Set(
  '們這個為說時會對過發經麼現沒動還進樣開從實無長機點體電話問題頭關業東書車見間聽讀寫買賣門風飛馬魚鳥龍劉陳張楊趙鄭謝韓馮鄧權貴黨歲歷義華麗號應該總歡錢極訊報導領館護證續際處標準眾觀認識議論語談讓許設試詳請誰調負財責敗貨質購費貼貿資賞賴賽贊贈贏趕運遠違連遲適選遞邏遺郵鄰釋針鐘鋼鐵銀鎖錯鍵鎮閃閉闖閒鬧聞閣閱隊陽陰陣階陸險隨隱難霧須項順顧頓頒頻題顏額飯飲飽飾驅駛駐駕驗騎魯鮮雞鳴鴨麥齊齒',
)

/** 繁简混杂：一段以繁体（简体）为主的文字里夹着好几个只有简体（繁体）才用的字 */
export function mixedScript(text: string): boolean {
  let simp = 0
  let trad = 0
  for (const ch of text) {
    if (SIMP_ONLY.has(ch)) simp++
    else if (TRAD_ONLY.has(ch)) trad++
  }
  const [major, minor] = trad >= simp ? [trad, simp] : [simp, trad]
  return minor >= 3 && minor >= major * 0.08
}

/**
 * PDF 一页的文字层是否不可信（应该改为按图片识别）：
 * 整页乱码比例高；某一行几乎全是怪符号（换了字体的引文、小字常这样）；或者繁简混杂（字符映射错了）
 */
export function textLayerBroken(text: string): boolean {
  if (isGarbled(text)) return true
  const cjk = cjkShare(text) >= 0.3
  for (const line of text.split('\n')) {
    if (line.replace(/\s+/g, '').length < 6) continue
    if (garbleRatio(line) >= 0.3 || (cjk && oddShare(line) >= 0.3)) return true
  }
  // 长段落中间夹着一小截乱码（坏字体的几个字），比例不高，但正常的中文里不会连着出现这种字符
  if (cjk && oddRun(text) >= 3) return true
  return mixedScript(text)
}

const isCjk = (c: number) => (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x3134f)

/** 中文字符所占比例（不计空白） */
export function cjkShare(text: string): number {
  let total = 0
  let cjk = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    total++
    if (isCjk(ch.codePointAt(0)!)) cjk++
  }
  return total ? cjk / total : 0
}

/** 中文书里不该出现的字符：带音调的拉丁字母、希腊、西里尔字母、各种符号 */
const isOdd = (c: number) =>
  !(c < 0x80 || isCjk(c) || (c >= 0x2000 && c <= 0x206f) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef) || c === 0xb7)

function oddShare(line: string): number {
  let total = 0
  let odd = 0
  for (const ch of line) {
    if (/\s/.test(ch)) continue
    total++
    if (isOdd(ch.codePointAt(0)!)) odd++
  }
  return total ? odd / total : 0
}

/** 连续出现的不该出现的字符最多有几个（不计空白） */
function oddRun(text: string): number {
  let run = 0
  let best = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    run = isOdd(ch.codePointAt(0)!) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/** 中文书里不该出现的字符个数（段落里夹着一小截乱码时，比例不高，但个数说明问题） */
export function oddCount(text: string): number {
  let n = 0
  for (const ch of text) if (!/\s/.test(ch) && isOdd(ch.codePointAt(0)!)) n++
  return n
}
