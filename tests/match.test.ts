import { describe, expect, it } from 'vitest'
import { preferTextLayer, restoreFromLayer, similarity } from '../src/ocr/match'

// 《中國權貴的死亡遊戲》第 35 页：正文的文字层是对的，引文那种字体的文字层是乱码
const layer = [
  'ͳϲ࢕дᅳᐡ΍ֽॡĂ၆઼щˠࣶᄲĂࢋ׶ᓠႧֽ౦Ѫშ৔Ăࢋࢦྤफ़̏གྷᖼொঔγĄ!',
  '博訊的報導發出的時候，我在台灣的山區。仍對王立軍的避難抱著懷疑態度：如此戲劇性的描寫，似乎是從好萊塢的動作大片裡來的。',
  '即使周永康可以退休，他的權力基礎也被削弱了。周永康 ׹ϖ૵ੜЃޢᔘ̙႕˘࣎͡Ă؎࠷α̌ܫᏐ׎ 退休後還不滿一個月，習近平領導下的新班子就展開了調查。',
]
const ocr = [
  '王立軍在領館出來時，對國安人員說，要和薄熙來魚死網破，重要資料已經轉移海外。',
  '博訊的報導發出的時侯，我在台灣的山區。仍對王立軍的避難抱著懷疑態度：如此戲劇性的描寫，似乎是從好萊塢的動作大片裡來的。',
  '即使周永康可以退休，他的權力基礎也被削弱了。周永康在十八大上退下來後還不滿一個月，習近平領導下的新班子就展開了調查。',
]

describe('prefer the PDF text layer where it is right', () => {
  it('uses the original text for paragraphs that match', () => {
    const out = preferTextLayer(ocr, layer)
    expect(out[1]).toBe(layer[1])
  })
  it('keeps the recognized text where the layer is garbage, even a short run inside a paragraph', () => {
    const out = preferTextLayer(ocr, layer)
    expect(out[0]).toBe(ocr[0])
    // 文字层里乱码前后的正文仍用原文，乱码本身不出现
    expect(out[2]).not.toMatch(/[ϖ૵ੜЃ]/)
    expect(out[2]).toContain('退休後還不滿一個月，習近平領導下的新班子就展開了調查。')
  })
  it('similarity', () => {
    expect(similarity(ocr[1], layer[1])).toBeGreaterThan(0.9)
    expect(similarity(ocr[0], layer[0])).toBeLessThan(0.1)
  })
})

describe('restore recognized text from the text layer character by character', () => {
  // 原书第 35 页：绕着照片排的窄栏，文字层分成两段，中间还夹着图片说明的乱码；识别结果合成一段，认错了几个字
  const layer = [
    '蒙古族也好，漢族也罷，王立軍確是在蒙古傳統中成長起來的。',
    '十幾歲的時候，他曾入選過内蒙古少年拳撃隊，武藝高強。1977 年高中畢業後，他被分配到内蒙古自治區阿爾山林業局天池林場，一年以後參了軍。ͳϲ࢕༊˯ᛨ΃ܑ̖ԼჍҋ̎ߏᄋΟ據他童年的一位小夥伴說，王立軍一直夢想當一名軍官。',
  ].join('\n')
  const ocr =
    '蒙古族也好，漢族也罷，王立軍確是在蒙古傳統中成長起來的。十幾歲的時候，他會入選過内蒙古少年拳擊隊，武藝高強197年高中畢業後，他被分配到内蒙古自治區阿爾山林業局天池林場，一年以後參了軍。據他童年心的一位小夥伴說，王立軍一直夢想當一名軍官。'
  it('fixes the misread characters and keeps no garbage', () => {
    expect(restoreFromLayer(ocr, layer)).toBe(
      '蒙古族也好，漢族也罷，王立軍確是在蒙古傳統中成長起來的。十幾歲的時候，他曾入選過内蒙古少年拳撃隊，武藝高強。1977 年高中畢業後，他被分配到内蒙古自治區阿爾山林業局天池林場，一年以後參了軍。據他童年的一位小夥伴說，王立軍一直夢想當一名軍官。',
    )
  })
  it('leaves text that is not in the layer alone', () => {
    const quote = '王立軍現在就好像被惡鬼纏身了一般，當兩名官員出現在他辦公室，向他宣布他將不再擔任公安局長。'
    expect(restoreFromLayer(quote, layer)).toBe(quote)
  })
})

describe('recognized paragraph spanning two text-layer paragraphs (p. 195)', () => {
  const layer = [
    '案組，不聲不響地調査了對薄一波的指控。在那個年代，即使“四人幫”被逮捕了，很多“文革”支持者還在掌權，任何毛做出的政治決定，要想翻案，阻力相當大。',
    '幸好胡耀邦獲得了權威領導人鄧小平的支持一在多年政治迫害之後，鄧逐漸出頭，成為中國歷史上一個重要人物。',
  ]
  const ocr =
    '案組，不聲不響地調查了對薄一波的指控。在那個年代即使“四人幫”被逮捕了，很多“文革”支持者還在掌權，任何毛做出的政治決定，要想翻案阻力相當大。幸好胡耀邦獲得了權威領導人鄧小平的支持一在多年政治迫害之後鄧逐漸出頭，成爲中國歷史上個重要人物。'
  it('keeps everything and restores both parts from the layer', () => {
    expect(preferTextLayer([ocr], layer)).toEqual([layer.join('')])
  })
})

describe('punctuation the recognizer missed at the end of a paragraph', () => {
  it('is restored from the layer', () => {
    const layer = '或者通過向海外媒體提供内部獨家新聞，讓自己的對手難堪。我收到的信息，不一定全是可靠的——\n其中有很多蓄意加工的成份'
    expect(restoreFromLayer('或者通過向海外媒體提供内部獨家新聞，讓自己的對手難堪。我收到的信息，不一定全是可靠的', layer)).toBe(
      '或者通過向海外媒體提供内部獨家新聞，讓自己的對手難堪。我收到的信息，不一定全是可靠的——',
    )
  })
})
