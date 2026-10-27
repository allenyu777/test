import { beforeEach, describe, expect, it, vi } from 'vitest'

// 识别引擎出错时：不要因为偶尔出错就一直改用 Tesseract（它认繁体字很差）
vi.mock('../src/ocr/tesseract', () => ({
  recognizeTesseract: vi.fn(async () => [{ text: 'TESSERACT', para: 0, x0: 0, y0: 0, x1: 10, y1: 10 }]),
  releaseTesseract: vi.fn(async () => {}),
}))

let plan: ('ok' | 'failed' | 'unsupported')[] = []
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  postMessage(msg: { id: number }) {
    const next = plan.shift() ?? 'ok'
    setTimeout(() => {
      const data =
        next === 'ok'
          ? { id: msg.id, type: 'result', lines: [[{ text: '派出部隊把美國領事館包圍了', x: 0, y: 0, w: 300, h: 20 }]] }
          : { id: msg.id, type: 'error', kind: next, message: next }
      this.onmessage?.({ data } as MessageEvent)
    }, 0)
  }
  terminate() {}
}

describe('local OCR engine errors', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('createImageBitmap', async () => ({}))
  })
  const canvas = () => document.createElement('canvas')
  const text = (r: { lines?: { text: string }[] }) => r.lines?.map(l => l.text).join('')

  it('an occasional failure is retried with PaddleOCR, not a permanent switch to Tesseract', async () => {
    const { recognizeCanvas } = await import('../src/ocr/engines')
    plan = ['failed', 'failed']
    await expect(recognizeCanvas(canvas(), 'local', 'chi_tra')).rejects.toThrow()
    await expect(recognizeCanvas(canvas(), 'local', 'chi_tra')).rejects.toThrow()
    plan = ['ok']
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('派出部隊把美國領事館包圍了')
    // 后面的页面照常用 PaddleOCR
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('派出部隊把美國領事館包圍了')
  })
  it('three failures in a row: only that page uses Tesseract', async () => {
    const { recognizeCanvas } = await import('../src/ocr/engines')
    plan = ['failed', 'failed', 'failed']
    await expect(recognizeCanvas(canvas(), 'local', 'chi_tra')).rejects.toThrow()
    await expect(recognizeCanvas(canvas(), 'local', 'chi_tra')).rejects.toThrow()
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('TESSERACT')
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('派出部隊把美國領事館包圍了')
  })
  it('an unsupported device switches to Tesseract', async () => {
    const { recognizeCanvas } = await import('../src/ocr/engines')
    plan = ['unsupported']
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('TESSERACT')
    expect(text(await recognizeCanvas(canvas(), 'local', 'chi_tra'))).toBe('TESSERACT')
  })
})
