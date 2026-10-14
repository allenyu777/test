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
