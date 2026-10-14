// foliate-js 用到的较新 API，旧版 iOS（< 17.4）需要补上
type GroupFn = <T, K extends PropertyKey>(items: Iterable<T>, key: (item: T, index: number) => K) => unknown

const obj = Object as unknown as { groupBy?: GroupFn }
if (!obj.groupBy) {
  obj.groupBy = (items, keyFn) => {
    const out: Record<PropertyKey, unknown[]> = Object.create(null)
    let i = 0
    for (const item of items) {
      const key = keyFn(item, i++)
      ;(out[key] ??= []).push(item)
    }
    return out
  }
}

const map = Map as unknown as { groupBy?: GroupFn }
if (!map.groupBy) {
  map.groupBy = (items, keyFn) => {
    const out = new Map<unknown, unknown[]>()
    let i = 0
    for (const item of items) {
      const key = keyFn(item, i++)
      const list = out.get(key)
      if (list) list.push(item)
      else out.set(key, [item])
    }
    return out
  }
}

export {}
