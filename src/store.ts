// 极简状态容器 + Preact hook
import { useLayoutEffect, useReducer, useRef } from 'preact/hooks'

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(fn: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const subs = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
      subs.forEach(fn => fn())
    },
    subscribe(fn) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}

/** 订阅 store 的一部分；selector 应返回原始值或稳定引用 */
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const value = selector(store.get())
  const valueRef = useRef(value)
  valueRef.current = value
  useLayoutEffect(() => {
    const check = () => {
      const next = selectorRef.current(store.get())
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next
        force(0)
      }
    }
    const unsubscribe = store.subscribe(check)
    // 渲染之后、订阅之前 store 可能已经变了（例如书架数据刚好读完），补检查一次
    check()
    return unsubscribe
  }, [store])
  return value
}
