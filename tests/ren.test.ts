import { describe, expect, it } from 'vitest'
import { fixRu } from '../src/ocr/ren'

describe('入 recognized as 人', () => {
  it('fixes fixed phrases', () => {
    expect(fixRu('光绪三年进人大灾之年，粮价陷人混乱')).toBe('光绪三年进入大灾之年，粮价陷入混乱')
    expect(fixRu('各地收人锐减，人不敷出')).toBe('各地收入锐减，入不敷出')
    expect(fixRu('大量饥民涌人省城，政府加人赈济')).toBe('大量饥民涌入省城，政府加入赈济')
    expect(fixRu('深人研究，列人计划，纳人体系')).toBe('深入研究，列入计划，纳入体系')
    expect(fixRu('外敌人侵，清军人关')).toBe('外敌入侵，清军入关')
    expect(fixRu('人冬以后，天气骤冷')).toBe('入冬以后，天气骤冷')
  })
  it('leaves correct 人 alone', () => {
    for (const t of [
      '引进人才，先进人物',
      '参加人数众多，增加人口',
      '夜深人静',
      '陷人于不义',
      '引人注目，出人意料',
      '敌人侵犯边境，敌人侵略',
      '家人境况不佳',
      '与人关系密切，人关心',
      '老人冬天怕冷',
      '个人党性',
      '有人场外等候',
      '接收人员，不输人',
      '步人后尘',
    ])
      expect(fixRu(t)).toBe(t)
  })
  it('keeps the length', () => {
    const t = '进人收人深人人侵'
    expect(fixRu(t)).toHaveLength(t.length)
  })
})
