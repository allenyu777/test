import { describe, expect, it } from 'vitest'
import { mixedScript, textLayerBroken } from '../src/parsers/garble'

// 用户截图里，这本繁体 PDF 文字层取出来的内容
const SYMBOLS = '我的網站發出王立軍被解職消息的兩個小時之後，管轄著3千萬市民的重慶市政府新聞辦公室官方微博發出了一則簡短消息：\nﺝ≣ξ‘sĂтc≣TЉΓĭJ≣ξщH\nHЎăⅈ3≣ĂƏЧξ\\HƃυƇd—ⅼyĄ!\n稍晚，重慶市政府公眾信息網刊登了《重慶市人民政府辦公廳關於市政府領導分工的通知》。'
const SWAPPED =
  '的報薄發的時候，到在的「區。獨寸算的避抑蓄懷疑態度：如螺性的指，似是符好基塢的動作人程來的。我赞得其值人多票法解的疑：是什麼大素，命一個全威聞的公制長到候國館去动求護？威斯怎能夠票刺威除法，派部隊担威館印门24小時？我想不出仰先例能證們博計所措述的一采列命人吃驚的件是印信的。於香信號不好，我未能時去核我所懷疑的大素。不過，其後的閑三裡，隨书知情人不劉將自關三寸算和熙來的信息發到我的信箱，我開始相信，報導体的人部分门否都是印信的。'
const GOOD_TRAD =
  '博訊的報導發出的時候，我在台灣的山區。仍對王立軍的避難抱著懷疑態度：如此戲劇性的描寫，似乎是從好萊塢的動作大片裡來的。我覺得其中有太多無法解釋的疑點：是什麼因素，令一個全國聞名的公安局長到美國領事館去尋求庇護？中國當局怎麼能夠無視國際法，派出部隊把美國領事館包圍了24小時？'
const GOOD_SIMP =
  '光绪三年灾荒达到顶峰之后，粮食普遍歉收、绝收，各地粮价普遍高涨，饥民遍野，饿殍载道。这是逃到邻近北京和天津的山西饥民状况，而远在江西南昌也有山西难民的身影。皇后与里长于是开会讨论。'

describe('broken PDF text layer', () => {
  it('a single line of symbols marks the page as broken', () => {
    expect(textLayerBroken(SYMBOLS)).toBe(true)
  })
  it('simplified characters mixed into traditional text mark the page as broken', () => {
    expect(mixedScript(SWAPPED)).toBe(true)
    expect(textLayerBroken(SWAPPED)).toBe(true)
  })
  it('normal traditional and simplified pages are fine', () => {
    expect(textLayerBroken(GOOD_TRAD)).toBe(false)
    expect(textLayerBroken(GOOD_SIMP)).toBe(false)
    expect(textLayerBroken('The Early Years of the Republic — Chapter 3: “Reform”, pp. 12–15.')).toBe(false)
  })
})

describe('a short run of garbage inside a long paragraph', () => {
  it('marks the page as broken', () => {
    const para =
      '即使周永康可以退休，他的權力基礎也被削弱了，因為他失去了安插自己的親信接替自己的機會。周永康 ׹ϖ૵ੜЃޢᔘ̙႕˘࣎͡Ă؎࠷α̌ܫᏐ׎ 退休後還不滿一個月，習近平領導下的新班子就展開了對他的親信、四川省委副書記李春城的調查。'
    expect(textLayerBroken(para)).toBe(true)
  })
  it('a foreign name with accents is fine', () => {
    expect(textLayerBroken('法國記者弗朗索瓦（François Müller）在巴黎接受採訪時說，這件事情發生得非常突然，誰也沒有想到。')).toBe(false)
  })
})
